import { beforeAll, describe, expect, it } from "vitest";
import * as complete from "@/app/api/leagues/[id]/complete/route";
import * as confirm from "@/app/api/leagues/[id]/matches/[matchId]/confirm/route";
import * as dispute from "@/app/api/leagues/[id]/matches/[matchId]/dispute/route";
import * as report from "@/app/api/leagues/[id]/matches/[matchId]/report/route";
import * as resolve from "@/app/api/leagues/[id]/matches/[matchId]/resolve/route";
import * as match from "@/app/api/leagues/[id]/matches/[matchId]/route";
import * as schedule from "@/app/api/leagues/[id]/schedule/route";
import * as standings from "@/app/api/leagues/[id]/standings/route";
import * as tradeAction from "@/app/api/leagues/[id]/trades/[tradeId]/[action]/route";
import * as trades from "@/app/api/leagues/[id]/trades/route";
import * as team from "@/app/api/leagues/[id]/teams/[entryId]/route";
import * as wallet from "@/app/api/me/wallet/route";
import { signToken } from "@/lib/auth/jwt";
import { getDb } from "@/lib/db/client";
import { seasonLeague, setupDb } from "@/test/helpers";
import { call } from "@/test/http";

beforeAll(async () => {
    await setupDb();
});

describe("a season over HTTP", () => {
    it("results, a dispute, a trade, standings and the payout", async () => {
        const s = await seasonLeague(getDb(), { coaches: 2, entryFee: 100 });
        const p = { id: s.league.id };
        const tok = async (userId: string) => signToken(userId);
        const comm = await tok(s.commissioner.id);
        const [A, B] = s.coaches;
        const tokA = await tok(A!.actor.id);
        const tokB = await tok(B!.actor.id);

        const sched = await call(schedule.GET, { token: tokA, params: p });
        expect(sched.status).toBe(200);
        const m = sched.json.data.weeks[0].matches[0];
        const home = m.home.entryId === A!.entryId ? tokA : tokB;
        const away = home === tokA ? tokB : tokA;
        const mp = { ...p, matchId: m.id };

        // Report with a bad replay link, then properly
        const badReplay = await call(report.POST, { method: "POST", token: home, params: mp, body: { homeWins: 2, awayWins: 0, replayUrl: "https://evil.example/x" } });
        expect(badReplay).toMatchObject({ status: 422, json: { code: "MATCH_REPLAY_INVALID" } });
        const reported = await call(report.POST, {
            method: "POST",
            token: home,
            params: mp,
            body: { homeWins: 2, awayWins: 1, replayUrl: "https://replay.pokemonshowdown.com/gen9ou-2101234567" },
        });
        expect(reported.json.data).toMatchObject({ status: "reported", homeWins: 2, awayWins: 1 });
        expect((await call(confirm.POST, { method: "POST", token: home, params: mp })).json.code).toBe("MATCH_CANNOT_CONFIRM_OWN");

        // Dispute, and the commissioner decides
        const tooShort = await call(dispute.POST, { method: "POST", token: away, params: mp, body: { reason: "no" } });
        expect(tooShort).toMatchObject({ status: 422, json: { code: "VALIDATION_ERROR" } });
        expect((await call(dispute.POST, { method: "POST", token: away, params: mp, body: { reason: "Game 3 was mine" } })).json.data.status).toBe("disputed");
        expect((await call(resolve.POST, { method: "POST", token: home, params: mp, body: { homeWins: 2, awayWins: 1 } })).status).toBe(403);
        expect((await call(resolve.POST, { method: "POST", token: comm, params: mp, body: { homeWins: 1, awayWins: 2 } })).json.data).toMatchObject({
            status: "resolved",
            winnerEntryId: m.away.entryId,
        });
        expect((await call(match.GET, { token: away, params: mp })).json.data.me.canReport).toBe(false);

        // A 1-for-1 trade, accepted and approved
        const rosterOf = async (entryId: string, token: string) =>
            (await call(team.GET, { token, params: { ...p, entryId } })).json.data.roster.map((r: { pokemon: { id: number } }) => r.pokemon.id);
        const [aMon] = await rosterOf(A!.entryId, tokA);
        const [bMon] = await rosterOf(B!.entryId, tokB);
        const proposed = await call(trades.POST, { method: "POST", token: tokA, params: p, body: { toEntryId: B!.entryId, give: [aMon], get: [bMon] } });
        expect(proposed.status).toBe(201);
        const tp = { ...p, tradeId: proposed.json.data.id };
        expect((await call(tradeAction.POST, { method: "POST", token: tokA, params: { ...tp, action: "steal" } })).status).toBe(404);
        expect((await call(tradeAction.POST, { method: "POST", token: tokB, params: { ...tp, action: "accept" } })).json.data.status).toBe("accepted");
        expect((await call(tradeAction.POST, { method: "POST", token: comm, params: { ...tp, action: "approve" } })).json.data.status).toBe("approved");
        expect(await rosterOf(A!.entryId, tokA)).toContain(bMon);
        expect((await call(trades.GET, { token: tokB, params: p })).json.data).toHaveLength(1);

        // Standings, then the season ends and the winner is paid
        const table = await call(standings.GET, { token: tokA, params: p });
        expect(table.json.data).toMatchObject({ final: false, prizePool: 200 });
        expect(table.json.data.rows[0]).toMatchObject({ entryId: m.away.entryId, rank: 1, wins: 1, prize: 140 });
        const done = await call(complete.POST, { method: "POST", token: comm, params: p });
        expect(done.json.data).toMatchObject({ final: true, prizePool: 0 });
        const winnerToken = m.away.entryId === A!.entryId ? tokA : tokB;
        const history = (await call(wallet.GET, { token: winnerToken })).json.data.history;
        expect(history[0]).toMatchObject({ kind: "prize", amount: 140 });
    });
});
