import { beforeAll, describe, expect, it } from "vitest";
import type { Db } from "@/lib/db/client";
import { ctxOf, expectError, expectLedgerBalanced, makeUser, seasonLeague, setupDb } from "@/test/helpers";
import { getLeague } from "./leagues";
import { balanceOf, leagueAccount, userAccount } from "./ledger";
import { completeSeason, confirmResult, disputeResult, getMatch, getSchedule, getStandings, reportResult, resolveResult } from "./season";

let db: Db;
beforeAll(async () => {
    db = await setupDb();
});

const REPLAY = "https://replay.pokemonshowdown.com/gen9ou-2101234567";

/** A 2-coach season (one match) with handy contexts. */
async function duel() {
    const s = await seasonLeague(db, { coaches: 2 });
    const schedule = await getSchedule(ctxOf(db, s.commissioner), s.league.id);
    const m = schedule.weeks[0]!.matches[0]!;
    const coachOf = (entryId: string) => s.coaches.find((c) => c.entryId === entryId)!.actor;
    return { ...s, m, home: ctxOf(db, coachOf(m.home.entryId)), away: ctxOf(db, coachOf(m.away.entryId)), comm: ctxOf(db, s.commissioner) };
}

describe("the schedule", () => {
    it("is created when the draft ends: every pair once", async () => {
        const s = await seasonLeague(db, { coaches: 4 });
        const schedule = await getSchedule(ctxOf(db, s.coaches[0]!.actor), s.league.id);
        expect(schedule.status).toBe("season");
        expect(schedule.weeks.map((w) => w.matches.length)).toEqual([2, 2, 2]);
        expect(schedule.openMatches).toBe(6);
        const pairs = schedule.weeks.flatMap((w) => w.matches).map((m) => [m.home.entryId, m.away.entryId].sort().join("|"));
        expect(new Set(pairs).size).toBe(6);
    });

    it("tells each coach what they can do", async () => {
        const { m, home, comm, league } = await duel();
        const mine = (await getSchedule(home, league.id)).weeks[0]!.matches[0]!;
        expect(mine.me).toEqual({ side: "home", canReport: true, canConfirm: false, canDispute: false, canResolve: false });
        expect((await getMatch(comm, league.id, m.id)).me).toMatchObject({ side: null, canReport: false, canResolve: true });
    });
});

describe("reporting a result", () => {
    it("records the score and replay, and waits for the opponent", async () => {
        const { m, home, away, league } = await duel();
        const reported = await reportResult(home, league.id, m.id, { homeWins: 2, awayWins: 1, replayUrl: REPLAY });
        expect(reported).toMatchObject({ status: "reported", homeWins: 2, awayWins: 1, winnerEntryId: m.home.entryId, replayUrl: REPLAY, reportedByEntryId: m.home.entryId });
        expect(home.events.map((e) => e.type)).toEqual(["result.reported"]);
        expect((await getMatch(away, league.id, m.id)).me).toMatchObject({ canConfirm: true, canDispute: true, canReport: false });
    });

    it("refuses impossible scores, bad replay links, outsiders and a second report", async () => {
        const { m, home, away, league } = await duel();
        await expectError(reportResult(home, league.id, m.id, { homeWins: 2, awayWins: 2 }), 422, "MATCH_SCORE_INVALID");
        await expectError(reportResult(home, league.id, m.id, { homeWins: 3, awayWins: 0 }), 422, "MATCH_SCORE_INVALID");
        await expectError(reportResult(home, league.id, m.id, { homeWins: 2, awayWins: 0, replayUrl: "https://evil.example/x" }), 422, "MATCH_REPLAY_INVALID");
        await expectError(reportResult(ctxOf(db, await makeUser(db)), league.id, m.id, { homeWins: 2, awayWins: 0 }), 403, "MATCH_NOT_PARTICIPANT");
        await reportResult(away, league.id, m.id, { homeWins: 0, awayWins: 2 });
        await expectError(reportResult(home, league.id, m.id, { homeWins: 2, awayWins: 0 }), 409, "MATCH_INVALID_STATE");
        await expectError(reportResult(home, league.id, "mt_missing", { homeWins: 2, awayWins: 0 }), 404, "MATCH_NOT_FOUND");
    });
});

describe("confirming and disputing", () => {
    it("the opponent confirms, and the result counts", async () => {
        const { m, home, away, league } = await duel();
        await reportResult(home, league.id, m.id, { homeWins: 2, awayWins: 0 });
        await expectError(confirmResult(home, league.id, m.id), 409, "MATCH_CANNOT_CONFIRM_OWN");
        const confirmed = await confirmResult(away, league.id, m.id);
        expect(confirmed.status).toBe("confirmed");
        expect(confirmed.decidedAt).not.toBeNull();
        await expectError(disputeResult(away, league.id, m.id, { reason: "too late" }), 409, "MATCH_INVALID_STATE");
    });

    it("a dispute waits for the commissioner, who has the final word", async () => {
        const { m, home, away, comm, league } = await duel();
        await reportResult(home, league.id, m.id, { homeWins: 2, awayWins: 1 });
        const disputed = await disputeResult(away, league.id, m.id, { reason: "I won game 3" });
        expect(disputed).toMatchObject({ status: "disputed", disputeReason: "I won game 3" });
        await expectError(confirmResult(away, league.id, m.id), 409, "MATCH_INVALID_STATE");
        await expectError(resolveResult(home, league.id, m.id, { homeWins: 2, awayWins: 1 }), 403, "RBAC_FORBIDDEN");
        const resolved = await resolveResult(comm, league.id, m.id, { homeWins: 1, awayWins: 2 });
        expect(resolved).toMatchObject({ status: "resolved", homeWins: 1, awayWins: 2, winnerEntryId: m.away.entryId });
        await expectError(resolveResult(comm, league.id, m.id, { homeWins: 2, awayWins: 0 }), 409, "MATCH_INVALID_STATE");
    });

    it("the commissioner can also settle an unplayed match", async () => {
        const { m, comm, league } = await duel();
        expect((await resolveResult(comm, league.id, m.id, { homeWins: 2, awayWins: 0 })).status).toBe("resolved");
    });
});

describe("standings", () => {
    it("rank by results and project the prize split", async () => {
        const s = await seasonLeague(db, { coaches: 3, entryFee: 100, prizeSplit: [60, 30, 10] });
        const comm = ctxOf(db, s.commissioner);
        const all = (await getSchedule(comm, s.league.id)).weeks.flatMap((w) => w.matches);
        // the first team in draft order wins everything 2-0
        const star = s.coaches[0]!.entryId;
        for (const m of all) {
            const starHome = m.home.entryId === star;
            const starAway = m.away.entryId === star;
            await resolveResult(comm, s.league.id, m.id, starHome || !starAway ? { homeWins: 2, awayWins: 0 } : { homeWins: 0, awayWins: 2 });
        }
        const table = await getStandings(comm, s.league.id);
        expect(table).toMatchObject({ final: false, prizePool: 300 });
        expect(table.rows[0]).toMatchObject({ entryId: star, rank: 1, wins: 2, losses: 0, played: 2, gameDiff: 4, prize: 180 });
        expect(table.rows.map((r) => r.prize)).toEqual([180, 90, 30]);
        expect(table.rows.reduce((n, r) => n + r.played, 0)).toBe(6);
    });
});

describe("completing the season", () => {
    it("needs every match decided", async () => {
        const { m, comm, league, home } = await duel();
        await expectError(completeSeason(home, league.id), 403, "RBAC_FORBIDDEN");
        await expectError(completeSeason(comm, league.id), 409, "SEASON_MATCHES_OPEN");
        await resolveResult(comm, league.id, m.id, { homeWins: 2, awayWins: 0 });
        expect((await completeSeason(comm, league.id)).final).toBe(true);
    });

    it("pays the pool out by place, empties it, and keeps the ledger balanced", async () => {
        // 2 coaches x 100 = 200; split 60/30/10 with no 3rd place → 1st gets 140, 2nd 60
        const { m, comm, league, coaches } = await duel();
        await resolveResult(comm, league.id, m.id, { homeWins: 2, awayWins: 1 });
        const result = await completeSeason(comm, league.id);
        expect(result.final).toBe(true);
        const winner = result.rows[0]!;
        expect(winner).toMatchObject({ entryId: m.home.entryId, prize: 140 });
        expect(result.rows[1]).toMatchObject({ prize: 60 });
        expect(await balanceOf(db, leagueAccount(league.id))).toBe(0);
        const winnerCoach = coaches.find((c) => c.entryId === winner.entryId)!.actor;
        expect(await balanceOf(db, userAccount(winnerCoach.id))).toBe(1000 - 100 + 140);
        expect((await getLeague(comm, league.id)).status).toBe("completed");
        expect(comm.events.at(-1)).toMatchObject({ type: "season.completed", title: expect.stringContaining(winner.teamName) });
        await expectLedgerBalanced(db);
        await expectError(completeSeason(comm, league.id), 409, "LEAGUE_INVALID_STATE");
        await expectError(reportResult(comm, league.id, m.id, { homeWins: 2, awayWins: 0 }), 409, "LEAGUE_INVALID_STATE");
    });
});
