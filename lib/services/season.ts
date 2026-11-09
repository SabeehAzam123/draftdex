import { and, asc, eq, inArray } from "drizzle-orm";
import type { z } from "zod";
import type { DbOrTx } from "@/lib/db/client";
import { entries, leagues, ledger, matches, users, FINAL_MATCH_STATUSES, type LeagueStatus, type MatchStatus } from "@/lib/db/schema";
import { checkScore, computeStandings, isReplayUrl, roundRobin, splitPrize } from "@/lib/domain/season";
import { AppError, conflict, notFound } from "@/lib/errors/app-error";
import { ErrorCodes } from "@/lib/errors/codes";
import type { DisputeSchema, ReportResultSchema, ResolveSchema } from "@/lib/validators/schemas";
import { newId, nowIso, requireActor, withTx, type Actor, type Ctx } from "./context";
import { canManage, getLeagueRow, requireManager, requireStatus, type LeagueRow } from "./leagues";
import { balanceOf, leagueAccount, transfer, userAccount } from "./ledger";

export type TeamRef = { entryId: string; teamName: string; coach: { id: string; displayName: string } };

export type MatchDto = {
    id: string;
    week: number;
    status: MatchStatus;
    home: TeamRef;
    away: TeamRef;
    homeWins: number | null;
    awayWins: number | null;
    winnerEntryId: string | null;
    replayUrl: string | null;
    reportedByEntryId: string | null;
    reportedAt: string | null;
    disputeReason: string | null;
    decidedAt: string | null;
    me: { side: "home" | "away" | null; canReport: boolean; canConfirm: boolean; canDispute: boolean; canResolve: boolean };
};

type MatchRow = typeof matches.$inferSelect;

async function teamRefs(db: DbOrTx, leagueId: string): Promise<Map<string, TeamRef>> {
    const rows = await db
        .select({ entryId: entries.id, teamName: entries.teamName, coachId: users.id, coachName: users.displayName })
        .from(entries)
        .innerJoin(users, eq(users.id, entries.userId))
        .where(and(eq(entries.leagueId, leagueId), eq(entries.status, "approved")));
    return new Map(rows.map((r) => [r.entryId, { entryId: r.entryId, teamName: r.teamName, coach: { id: r.coachId, displayName: r.coachName } }]));
}

async function myEntryId(db: DbOrTx, leagueId: string, userId: string): Promise<string | null> {
    const row = await db
        .select({ id: entries.id })
        .from(entries)
        .where(and(eq(entries.leagueId, leagueId), eq(entries.userId, userId), eq(entries.status, "approved")))
        .get();
    return row?.id ?? null;
}

const isFinal = (s: MatchStatus) => FINAL_MATCH_STATUSES.includes(s);

function toDto(m: MatchRow, refs: Map<string, TeamRef>, league: LeagueRow, actor: Actor | null, mine: string | null): MatchDto {
    const ref = (id: string): TeamRef => refs.get(id) ?? { entryId: id, teamName: "(unknown team)", coach: { id: "", displayName: "" } };
    const side = mine === m.homeEntryId ? "home" : mine === m.awayEntryId ? "away" : null;
    const live = league.status === "season";
    const winner = m.homeWins === null || m.awayWins === null ? null : m.homeWins > m.awayWins ? m.homeEntryId : m.awayEntryId;
    return {
        id: m.id,
        week: m.week,
        status: m.status,
        home: ref(m.homeEntryId),
        away: ref(m.awayEntryId),
        homeWins: m.homeWins,
        awayWins: m.awayWins,
        winnerEntryId: winner,
        replayUrl: m.replayUrl,
        reportedByEntryId: m.reportedByEntryId,
        reportedAt: m.reportedAt,
        disputeReason: m.disputeReason,
        decidedAt: m.decidedAt,
        me: {
            side,
            canReport: live && !!side && m.status === "scheduled",
            canConfirm: live && !!side && m.status === "reported" && m.reportedByEntryId !== mine,
            canDispute: live && !!side && m.status === "reported" && m.reportedByEntryId !== mine,
            canResolve: live && canManage(league, actor) && !isFinal(m.status),
        },
    };
}

// ---- Schedule ----

/** Called when the draft ends: a round robin in draft order. */
export async function createSchedule(db: DbOrTx, league: LeagueRow): Promise<number> {
    const order = league.draftOrder ?? [];
    const fixtures = roundRobin(order);
    if (fixtures.length === 0) return 0;
    await db.insert(matches).values(
        fixtures.map((f) => ({ id: newId("mt"), leagueId: league.id, week: f.week, homeEntryId: f.home, awayEntryId: f.away, status: "scheduled" as const })),
    );
    return fixtures.length;
}

export type ScheduleDto = { leagueId: string; status: LeagueStatus; openMatches: number; weeks: { week: number; matches: MatchDto[] }[] };

export async function getSchedule(ctx: Ctx, leagueId: string): Promise<ScheduleDto> {
    const actor = requireActor(ctx);
    const league = await getLeagueRow(ctx.db, leagueId);
    const refs = await teamRefs(ctx.db, leagueId);
    const mine = await myEntryId(ctx.db, leagueId, actor.id);
    const rows = await ctx.db.select().from(matches).where(eq(matches.leagueId, leagueId)).orderBy(asc(matches.week), asc(matches.id));
    const weeks: ScheduleDto["weeks"] = [];
    for (const m of rows) {
        let w = weeks.find((x) => x.week === m.week);
        if (!w) weeks.push((w = { week: m.week, matches: [] }));
        w.matches.push(toDto(m, refs, league, actor, mine));
    }
    return { leagueId, status: league.status, openMatches: rows.filter((m) => !isFinal(m.status)).length, weeks };
}

async function loadMatch(db: DbOrTx, leagueId: string, matchId: string): Promise<MatchRow> {
    const m = await db
        .select()
        .from(matches)
        .where(and(eq(matches.id, matchId), eq(matches.leagueId, leagueId)))
        .get();
    if (!m) throw notFound(ErrorCodes.MATCH_NOT_FOUND, "Match not found in this league");
    return m;
}

export async function getMatch(ctx: Ctx, leagueId: string, matchId: string): Promise<MatchDto> {
    const actor = requireActor(ctx);
    const league = await getLeagueRow(ctx.db, leagueId);
    const m = await loadMatch(ctx.db, leagueId, matchId);
    return toDto(m, await teamRefs(ctx.db, leagueId), league, actor, await myEntryId(ctx.db, leagueId, actor.id));
}

function validScore(homeWins: number, awayWins: number) {
    const check = checkScore(homeWins, awayWins);
    if (!check.ok) throw new AppError(422, ErrorCodes.MATCH_SCORE_INVALID, check.reason);
}

/** A participant in the match, or a 403. */
async function requireParticipant(db: DbOrTx, m: MatchRow, actor: Actor): Promise<string> {
    const mine = await myEntryId(db, m.leagueId, actor.id);
    if (!mine || (mine !== m.homeEntryId && mine !== m.awayEntryId)) {
        throw new AppError(403, ErrorCodes.MATCH_NOT_PARTICIPANT, "Only the two coaches in this match can do that");
    }
    return mine;
}

const score = (m: { homeWins: number | null; awayWins: number | null }) => `${m.homeWins}–${m.awayWins}`;

// ---- Results ----

export async function reportResult(ctx: Ctx, leagueId: string, matchId: string, input: z.infer<typeof ReportResultSchema>): Promise<MatchDto> {
    const actor = requireActor(ctx);
    await withTx(ctx, async (tx, events) => {
        const league = await getLeagueRow(tx, leagueId);
        requireStatus(league, ["season"], "report results");
        const m = await loadMatch(tx, leagueId, matchId);
        const mine = await requireParticipant(tx, m, actor);
        if (m.status !== "scheduled") throw conflict(ErrorCodes.MATCH_INVALID_STATE, `This match is already ${m.status}`);
        validScore(input.homeWins, input.awayWins);
        const replay = input.replayUrl?.trim() || null;
        if (replay && !isReplayUrl(replay)) {
            throw new AppError(422, ErrorCodes.MATCH_REPLAY_INVALID, "Use a Pokémon Showdown replay link, like https://replay.pokemonshowdown.com/gen9ou-1234567890");
        }
        await tx
            .update(matches)
            .set({ status: "reported", homeWins: input.homeWins, awayWins: input.awayWins, replayUrl: replay, reportedByEntryId: mine, reportedAt: nowIso(ctx) })
            .where(eq(matches.id, matchId));
        const refs = await teamRefs(tx, leagueId);
        const other = mine === m.homeEntryId ? m.awayEntryId : m.homeEntryId;
        events.push({
            leagueId,
            type: "result.reported",
            title: `Week ${m.week} result reported`,
            text: `**${refs.get(m.homeEntryId)?.teamName}** ${input.homeWins}–${input.awayWins} **${refs.get(m.awayEntryId)?.teamName}**. ${refs.get(other)?.teamName}: confirm or dispute.${replay ? `\n${replay}` : ""}`,
        });
    });
    return getMatch(ctx, leagueId, matchId);
}

/** The opponent of whoever reported: confirm or dispute. The reporter can't confirm their own report. */
async function respond(tx: DbOrTx, leagueId: string, matchId: string, actor: Actor) {
    const league = await getLeagueRow(tx, leagueId);
    requireStatus(league, ["season"], "answer a reported result");
    const m = await loadMatch(tx, leagueId, matchId);
    const mine = await requireParticipant(tx, m, actor);
    if (m.status !== "reported") throw conflict(ErrorCodes.MATCH_INVALID_STATE, `This match is ${m.status}, not waiting for an answer`);
    if (m.reportedByEntryId === mine) throw conflict(ErrorCodes.MATCH_CANNOT_CONFIRM_OWN, "Your opponent has to confirm or dispute the result you reported");
    return { m, refs: await teamRefs(tx, leagueId) };
}

export async function confirmResult(ctx: Ctx, leagueId: string, matchId: string): Promise<MatchDto> {
    const actor = requireActor(ctx);
    await withTx(ctx, async (tx, events) => {
        const { m, refs } = await respond(tx, leagueId, matchId, actor);
        await tx.update(matches).set({ status: "confirmed", decidedAt: nowIso(ctx) }).where(eq(matches.id, matchId));
        events.push({
            leagueId,
            type: "result.confirmed",
            title: `Week ${m.week} result confirmed`,
            text: `**${refs.get(m.homeEntryId)?.teamName}** ${score(m)} **${refs.get(m.awayEntryId)?.teamName}**`,
        });
    });
    return getMatch(ctx, leagueId, matchId);
}

export async function disputeResult(ctx: Ctx, leagueId: string, matchId: string, input: z.infer<typeof DisputeSchema>): Promise<MatchDto> {
    const actor = requireActor(ctx);
    await withTx(ctx, async (tx, events) => {
        const { m, refs } = await respond(tx, leagueId, matchId, actor);
        await tx.update(matches).set({ status: "disputed", disputeReason: input.reason }).where(eq(matches.id, matchId));
        events.push({
            leagueId,
            type: "result.disputed",
            title: `Week ${m.week} result disputed`,
            text: `**${refs.get(m.homeEntryId)?.teamName}** vs **${refs.get(m.awayEntryId)?.teamName}**: "${input.reason}". The commissioner will decide.`,
        });
    });
    return getMatch(ctx, leagueId, matchId);
}

/** The commissioner's final word on a match: a dispute, a report nobody answered, or an unplayed match. */
export async function resolveResult(ctx: Ctx, leagueId: string, matchId: string, input: z.infer<typeof ResolveSchema>): Promise<MatchDto> {
    await withTx(ctx, async (tx, events) => {
        const league = await getLeagueRow(tx, leagueId);
        const actor = requireManager(ctx, league);
        requireStatus(league, ["season"], "resolve results");
        const m = await loadMatch(tx, leagueId, matchId);
        if (isFinal(m.status)) throw conflict(ErrorCodes.MATCH_INVALID_STATE, `This match is already ${m.status}`);
        validScore(input.homeWins, input.awayWins);
        await tx
            .update(matches)
            .set({ status: "resolved", homeWins: input.homeWins, awayWins: input.awayWins, decidedAt: nowIso(ctx), resolvedBy: actor.id })
            .where(eq(matches.id, matchId));
        const refs = await teamRefs(tx, leagueId);
        events.push({
            leagueId,
            type: "result.resolved",
            title: `Week ${m.week} result set by the commissioner`,
            text: `**${refs.get(m.homeEntryId)?.teamName}** ${input.homeWins}–${input.awayWins} **${refs.get(m.awayEntryId)?.teamName}**`,
        });
    });
    return getMatch(ctx, leagueId, matchId);
}

// ---- Standings and the end of the season ----

export type StandingsDto = {
    leagueId: string;
    status: LeagueStatus;
    prizePool: number;
    /** true once the season is completed: `prize` is what was paid, not a projection */
    final: boolean;
    rows: (TeamRef & { rank: number; played: number; wins: number; losses: number; gamesWon: number; gamesLost: number; gameDiff: number; prize: number })[];
};

async function standingsRows(db: DbOrTx, leagueId: string) {
    const refs = await teamRefs(db, leagueId);
    const finals = await db
        .select()
        .from(matches)
        .where(and(eq(matches.leagueId, leagueId), inArray(matches.status, [...FINAL_MATCH_STATUSES])));
    const teams = [...refs.values()].map((r) => ({ entryId: r.entryId, teamName: r.teamName }));
    const table = computeStandings(
        teams,
        finals.map((m) => ({ home: m.homeEntryId, away: m.awayEntryId, homeWins: m.homeWins!, awayWins: m.awayWins! })),
    );
    return { refs, table };
}

export async function getStandings(ctx: Ctx, leagueId: string): Promise<StandingsDto> {
    requireActor(ctx);
    const league = await getLeagueRow(ctx.db, leagueId);
    const { refs, table } = await standingsRows(ctx.db, leagueId);
    const pool = await balanceOf(ctx.db, leagueAccount(leagueId));
    const final = league.status === "completed";
    let prizeOf: (rank: number, coachId: string) => number;
    if (final) {
        // What was actually paid, from the ledger
        const paid = await ctx.db
            .select({ account: ledger.account, amount: ledger.amount })
            .from(ledger)
            .where(and(eq(ledger.kind, "prize"), eq(ledger.ref, leagueId)));
        prizeOf = (_rank, coachId) => paid.filter((p) => p.account === userAccount(coachId)).reduce((s, p) => s + p.amount, 0);
    } else {
        const projected = splitPrize(pool, league.settings.prizeSplit, table.length);
        prizeOf = (rank) => projected[rank - 1] ?? 0;
    }
    return {
        leagueId,
        status: league.status,
        prizePool: pool,
        final,
        rows: table.map((r) => {
            const ref = refs.get(r.entryId)!;
            return { ...ref, ...r, prize: prizeOf(r.rank, ref.coach.id) };
        }),
    };
}

/** Ends the season once every match has a final result, and pays out the prize pool by the prize split. */
export async function completeSeason(ctx: Ctx, leagueId: string): Promise<StandingsDto> {
    await withTx(ctx, async (tx, events) => {
        const league = await getLeagueRow(tx, leagueId);
        requireManager(ctx, league);
        requireStatus(league, ["season"], "complete the season");
        const all = await tx.select({ status: matches.status }).from(matches).where(eq(matches.leagueId, leagueId));
        const open = all.filter((m) => !isFinal(m.status)).length;
        if (open > 0) throw conflict(ErrorCodes.SEASON_MATCHES_OPEN, `${open} match(es) still need a final result`);

        const { refs, table } = await standingsRows(tx, leagueId);
        const pool = await balanceOf(tx, leagueAccount(leagueId));
        const amounts = splitPrize(pool, league.settings.prizeSplit, table.length);
        const at = nowIso(ctx);
        const lines: string[] = [];
        for (let i = 0; i < amounts.length; i++) {
            const team = refs.get(table[i]!.entryId)!;
            if (amounts[i]! > 0) {
                await transfer(tx, {
                    from: leagueAccount(leagueId),
                    to: userAccount(team.coach.id),
                    amount: amounts[i]!,
                    kind: "prize",
                    ref: leagueId,
                    memo: `Prize: ${ordinal(i + 1)} in ${league.name}`,
                    at,
                });
            }
            lines.push(`${ordinal(i + 1)}: **${team.teamName}** (${amounts[i]} cr)`);
        }
        await tx.update(leagues).set({ status: "completed" }).where(eq(leagues.id, leagueId));
        const champion = refs.get(table[0]!.entryId)!;
        events.push({ leagueId, type: "season.completed", title: `${champion.teamName} win ${league.name}!`, text: lines.join("\n") || "No prize pool." });
    });
    return getStandings(ctx, leagueId);
}

function ordinal(n: number): string {
    return n === 1 ? "1st" : n === 2 ? "2nd" : n === 3 ? "3rd" : `${n}th`;
}
