import { and, desc, eq, inArray, sql } from "drizzle-orm";
import type { z } from "zod";
import type { DbOrTx } from "@/lib/db/client";
import { entries, picks, pokemon, trades, users, type TradeStatus } from "@/lib/db/schema";
import { AppError, conflict, forbidden, notFound } from "@/lib/errors/app-error";
import { ErrorCodes } from "@/lib/errors/codes";
import type { ProposeTradeSchema } from "@/lib/validators/schemas";
import { newId, nowIso, requireActor, withTx, type Actor, type Ctx } from "./context";
import { canManage, getLeagueRow, requireManager, requireStatus, type LeagueRow } from "./leagues";
import type { TeamRef } from "./season";

export type TradeMon = { id: number; name: string; points: number };

export type TradeDto = {
    id: string;
    status: TradeStatus;
    from: TeamRef;
    to: TeamRef;
    give: TradeMon[];
    get: TradeMon[];
    note: string | null;
    createdAt: string;
    updatedAt: string;
    me: { canAccept: boolean; canDecline: boolean; canCancel: boolean; canApprove: boolean; canReject: boolean };
};

type TradeRow = typeof trades.$inferSelect;

/** Who owns a pick now: the trade's new owner, else the drafter. */
const owner = sql<string>`coalesce(${picks.ownerEntryId}, ${picks.entryId})`;

/** An entry's current roster: pokemon id → points. */
async function rosterOf(db: DbOrTx, leagueId: string, entryId: string): Promise<Map<number, number>> {
    const rows = await db
        .select({ pokemonId: picks.pokemonId, points: picks.points })
        .from(picks)
        .where(and(eq(picks.leagueId, leagueId), sql`${owner} = ${entryId}`));
    return new Map(rows.map((r) => [r.pokemonId, r.points]));
}

async function approvedEntry(db: DbOrTx, leagueId: string, entryId: string) {
    const e = await db
        .select()
        .from(entries)
        .where(and(eq(entries.id, entryId), eq(entries.leagueId, leagueId), eq(entries.status, "approved")))
        .get();
    return e ?? null;
}

async function myEntry(db: DbOrTx, leagueId: string, userId: string) {
    return (
        (await db
            .select()
            .from(entries)
            .where(and(eq(entries.leagueId, leagueId), eq(entries.userId, userId), eq(entries.status, "approved")))
            .get()) ?? null
    );
}

/**
 * The swap is possible now: each side still owns what it gives, and neither team ends up over
 * the league's budget. Checked when proposing and again when the commissioner approves.
 */
async function checkSwap(db: DbOrTx, league: LeagueRow, t: { fromEntryId: string; toEntryId: string; give: number[]; get: number[] }, staleCode: "TRADE_INVALID" | "TRADE_STALE") {
    const fromRoster = await rosterOf(db, league.id, t.fromEntryId);
    const toRoster = await rosterOf(db, league.id, t.toEntryId);
    const names = await db.select({ id: pokemon.id, name: pokemon.name }).from(pokemon).where(inArray(pokemon.id, [...t.give, ...t.get]));
    const nameOf = (id: number) => names.find((n) => n.id === id)?.name ?? `#${id}`;
    const status = staleCode === "TRADE_STALE" ? 409 : 422;
    const missingGive = t.give.filter((id) => !fromRoster.has(id));
    if (missingGive.length) {
        throw new AppError(status, ErrorCodes[staleCode], `The proposing team doesn't own ${missingGive.map(nameOf).join(", ")}${staleCode === "TRADE_STALE" ? " any more" : ""}`);
    }
    const missingGet = t.get.filter((id) => !toRoster.has(id));
    if (missingGet.length) {
        throw new AppError(status, ErrorCodes[staleCode], `The other team doesn't own ${missingGet.map(nameOf).join(", ")}${staleCode === "TRADE_STALE" ? " any more" : ""}`);
    }
    const sum = (m: Map<number, number>) => [...m.values()].reduce((s, x) => s + x, 0);
    const pts = (m: Map<number, number>, ids: number[]) => ids.reduce((s, id) => s + (m.get(id) ?? 0), 0);
    const fromAfter = sum(fromRoster) - pts(fromRoster, t.give) + pts(toRoster, t.get);
    const toAfter = sum(toRoster) - pts(toRoster, t.get) + pts(fromRoster, t.give);
    const budget = league.settings.budget;
    if (fromAfter > budget || toAfter > budget) {
        const which = fromAfter > budget ? `the proposing team would spend ${fromAfter}` : `the other team would spend ${toAfter}`;
        throw new AppError(422, ErrorCodes.TRADE_OVER_BUDGET, `After this trade ${which} points, over the budget of ${budget}`);
    }
}

async function toDtos(db: DbOrTx, league: LeagueRow, rows: TradeRow[], actor: Actor | null): Promise<TradeDto[]> {
    if (rows.length === 0) return [];
    const teamRows = await db
        .select({ entryId: entries.id, teamName: entries.teamName, coachId: users.id, coachName: users.displayName })
        .from(entries)
        .innerJoin(users, eq(users.id, entries.userId))
        .where(eq(entries.leagueId, league.id));
    const ref = (id: string): TeamRef => {
        const t = teamRows.find((r) => r.entryId === id);
        return { entryId: id, teamName: t?.teamName ?? "(unknown team)", coach: { id: t?.coachId ?? "", displayName: t?.coachName ?? "" } };
    };
    const ids = [...new Set(rows.flatMap((r) => [...r.give, ...r.get]))];
    const mons = await db
        .select({ id: pokemon.id, name: pokemon.name, points: picks.points })
        .from(pokemon)
        .leftJoin(picks, and(eq(picks.pokemonId, pokemon.id), eq(picks.leagueId, league.id)))
        .where(inArray(pokemon.id, ids));
    const mon = (id: number): TradeMon => {
        const m = mons.find((x) => x.id === id);
        return { id, name: m?.name ?? `#${id}`, points: m?.points ?? 0 };
    };
    const manage = canManage(league, actor);
    const live = league.status === "season";
    return rows.map((r) => {
        const from = ref(r.fromEntryId);
        const to = ref(r.toEntryId);
        const isFrom = !!actor && from.coach.id === actor.id;
        const isTo = !!actor && to.coach.id === actor.id;
        return {
            id: r.id,
            status: r.status,
            from,
            to,
            give: r.give.map(mon),
            get: r.get.map(mon),
            note: r.note,
            createdAt: r.createdAt,
            updatedAt: r.updatedAt,
            me: {
                canAccept: live && isTo && r.status === "proposed",
                canDecline: live && isTo && (r.status === "proposed" || r.status === "accepted"),
                canCancel: live && isFrom && (r.status === "proposed" || r.status === "accepted"),
                canApprove: live && manage && r.status === "accepted",
                canReject: live && manage && r.status === "accepted",
            },
        };
    });
}

async function loadTrade(db: DbOrTx, leagueId: string, tradeId: string): Promise<TradeRow> {
    const t = await db
        .select()
        .from(trades)
        .where(and(eq(trades.id, tradeId), eq(trades.leagueId, leagueId)))
        .get();
    if (!t) throw notFound(ErrorCodes.TRADE_NOT_FOUND, "Trade not found in this league");
    return t;
}

async function getTrade(ctx: Ctx, leagueId: string, tradeId: string): Promise<TradeDto> {
    const league = await getLeagueRow(ctx.db, leagueId);
    const [dto] = await toDtos(ctx.db, league, [await loadTrade(ctx.db, leagueId, tradeId)], ctx.actor);
    return dto!;
}

export async function listTrades(ctx: Ctx, leagueId: string): Promise<TradeDto[]> {
    requireActor(ctx);
    const league = await getLeagueRow(ctx.db, leagueId);
    const rows = await ctx.db.select().from(trades).where(eq(trades.leagueId, leagueId)).orderBy(desc(trades.createdAt), desc(trades.id));
    return toDtos(ctx.db, league, rows, ctx.actor);
}

export async function proposeTrade(ctx: Ctx, leagueId: string, input: z.infer<typeof ProposeTradeSchema>): Promise<TradeDto> {
    const actor = requireActor(ctx);
    const id = newId("tr");
    await ctx.db.transaction(async (tx) => {
        const league = await getLeagueRow(tx, leagueId);
        requireStatus(league, ["season"], "trade");
        const from = await myEntry(tx, leagueId, actor.id);
        if (!from) throw forbidden("Only coaches in this league can propose trades");
        const to = await approvedEntry(tx, leagueId, input.toEntryId);
        if (!to || to.id === from.id) throw new AppError(422, ErrorCodes.TRADE_INVALID, "Trade with another coach in this league");
        if (input.give.length !== input.get.length) {
            throw new AppError(422, ErrorCodes.TRADE_INVALID, "A trade swaps the same number of Pokémon each way");
        }
        if (new Set(input.give).size !== input.give.length || new Set(input.get).size !== input.get.length) {
            throw new AppError(422, ErrorCodes.TRADE_INVALID, "The same Pokémon is listed twice");
        }
        await checkSwap(tx, league, { fromEntryId: from.id, toEntryId: to.id, give: input.give, get: input.get }, "TRADE_INVALID");
        const at = nowIso(ctx);
        await tx.insert(trades).values({
            id,
            leagueId,
            fromEntryId: from.id,
            toEntryId: to.id,
            give: input.give,
            get: input.get,
            note: input.note || null,
            status: "proposed",
            createdAt: at,
            updatedAt: at,
        });
    });
    return getTrade(ctx, leagueId, id);
}

type Move = { from: TradeStatus[]; to: TradeStatus; who: "to" | "from" | "commissioner"; verb: string };

const MOVES = {
    accept: { from: ["proposed"], to: "accepted", who: "to", verb: "accept" },
    decline: { from: ["proposed", "accepted"], to: "declined", who: "to", verb: "decline" },
    cancel: { from: ["proposed", "accepted"], to: "cancelled", who: "from", verb: "cancel" },
    reject: { from: ["accepted"], to: "rejected", who: "commissioner", verb: "reject" },
    approve: { from: ["accepted"], to: "approved", who: "commissioner", verb: "approve" },
} satisfies Record<string, Move>;

export type TradeAction = keyof typeof MOVES;

/** Moves a trade on. Approving re-checks it and then swaps the Pokémon. */
export async function actOnTrade(ctx: Ctx, leagueId: string, tradeId: string, action: TradeAction): Promise<TradeDto> {
    const actor = requireActor(ctx);
    const move: Move = MOVES[action];
    await withTx(ctx, async (tx, events) => {
        const league = await getLeagueRow(tx, leagueId);
        requireStatus(league, ["season"], `${move.verb} a trade`);
        const t = await loadTrade(tx, leagueId, tradeId);
        if (move.who === "commissioner") requireManager(ctx, league);
        else {
            const coach = await tx.select({ userId: entries.userId }).from(entries).where(eq(entries.id, move.who === "to" ? t.toEntryId : t.fromEntryId)).get();
            if (coach?.userId !== actor.id) {
                throw forbidden(move.who === "to" ? "Only the coach receiving the offer can do that" : "Only the coach who proposed it can do that");
            }
        }
        if (!move.from.includes(t.status)) throw conflict(ErrorCodes.TRADE_INVALID_STATE, `This trade is ${t.status}; you can't ${move.verb} it`);

        if (action === "approve") {
            await checkSwap(tx, league, t, "TRADE_STALE");
            const setOwner = async (ids: number[], newOwner: string) => {
                for (const pokemonId of ids) {
                    const pick = await tx.select().from(picks).where(and(eq(picks.leagueId, leagueId), eq(picks.pokemonId, pokemonId))).get();
                    // Back to the team that drafted it: no override needed
                    const value = pick!.entryId === newOwner ? null : newOwner;
                    await tx.update(picks).set({ ownerEntryId: value }).where(eq(picks.id, pick!.id));
                }
            };
            await setOwner(t.give, t.toEntryId);
            await setOwner(t.get, t.fromEntryId);
            const [dto] = await toDtos(tx, league, [t], actor);
            events.push({
                leagueId,
                type: "trade.approved",
                title: "Trade approved",
                text: `**${dto!.from.teamName}** send ${dto!.give.map((m) => m.name).join(", ")} to **${dto!.to.teamName}** for ${dto!.get.map((m) => m.name).join(", ")}.`,
            });
        }
        await tx.update(trades).set({ status: move.to, updatedAt: nowIso(ctx) }).where(eq(trades.id, tradeId));
    });
    return getTrade(ctx, leagueId, tradeId);
}
