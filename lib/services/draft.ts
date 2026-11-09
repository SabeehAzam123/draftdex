import { and, asc, desc, eq, inArray, isNull, lte, max, min, sql } from "drizzle-orm";
import type { z } from "zod";
import type { DbOrTx } from "@/lib/db/client";
import { draftSlots, entries, leaguePool, leagues, picks, pokemon, users, type LeagueSettings, type LeagueStatus } from "@/lib/db/schema";
import { addSeconds, maxAffordable, poolFeasibility, shuffle, snakeSlots } from "@/lib/domain/draft";
import { conflict, forbidden, invalid, isUniqueViolation, notFound } from "@/lib/errors/app-error";
import { ErrorCodes } from "@/lib/errors/codes";
import type { PickSchema, StartDraftSchema } from "@/lib/validators/schemas";
import { newId, nowIso, requireActor, withTx, type Ctx, type DomainEvent } from "./context";
import { canManage, getLeagueRow, requireManager, requireStatus, type LeagueRow } from "./leagues";
import { toPokemonDto, type PokemonDto } from "./pokemon";

type SlotRow = typeof draftSlots.$inferSelect;

export type DraftState = {
    leagueId: string;
    leagueName: string;
    status: LeagueStatus;
    settings: LeagueSettings;
    serverTime: string;
    /** The cheapest cost in the pool: every coach keeps enough budget to fill their roster at this price. */
    minCost: number;
    totalRounds: number;
    order: { entryId: string; teamName: string; coach: { id: string; displayName: string } }[];
    current: { slotNo: number; round: number; kind: SlotRow["kind"]; entryId: string; teamName: string; deadline: string | null } | null;
    upcoming: { slotNo: number; round: number; kind: SlotRow["kind"]; entryId: string; teamName: string }[];
    picks: {
        slotNo: number;
        round: number;
        entryId: string;
        teamName: string;
        points: number;
        pickedBy: "coach" | "commissioner" | "timer";
        pokemon: PokemonDto;
        createdAt: string;
    }[];
    skipped: { slotNo: number; round: number; entryId: string; teamName: string; status: SlotRow["status"] }[];
    teams: {
        entryId: string;
        teamName: string;
        coach: { id: string; displayName: string };
        spent: number;
        budgetLeft: number;
        picksMade: number;
        openSlots: number;
        /** The most this team may spend on its next pick (0 when it has no open slots). */
        maxForNextPick: number;
    }[];
    me: { entryId: string | null; isMyTurn: boolean; canManage: boolean };
};

// ---- Small queries ----

async function currentSlot(db: DbOrTx, leagueId: string): Promise<SlotRow | undefined> {
    return db
        .select()
        .from(draftSlots)
        .where(and(eq(draftSlots.leagueId, leagueId), eq(draftSlots.status, "open")))
        .orderBy(asc(draftSlots.slotNo))
        .limit(1)
        .get();
}

async function minCostOf(db: DbOrTx, leagueId: string): Promise<number> {
    const [row] = await db
        .select({ v: min(leaguePool.points) })
        .from(leaguePool)
        .where(and(eq(leaguePool.leagueId, leagueId), eq(leaguePool.banned, false)));
    return Number(row?.v ?? 1);
}

async function spentBy(db: DbOrTx, leagueId: string, entryId: string): Promise<number> {
    const [row] = await db
        .select({ v: sql<number>`coalesce(sum(${picks.points}), 0)` })
        .from(picks)
        .where(and(eq(picks.leagueId, leagueId), eq(picks.entryId, entryId)));
    return Number(row?.v ?? 0);
}

async function openSlotsOf(db: DbOrTx, leagueId: string, entryId: string): Promise<number> {
    const [row] = await db
        .select({ v: sql<number>`count(*)` })
        .from(draftSlots)
        .where(and(eq(draftSlots.leagueId, leagueId), eq(draftSlots.entryId, entryId), eq(draftSlots.status, "open")));
    return Number(row?.v ?? 0);
}

async function teamName(db: DbOrTx, entryId: string): Promise<string> {
    const row = await db.select({ n: entries.teamName }).from(entries).where(eq(entries.id, entryId)).get();
    return row?.n ?? "(unknown team)";
}

/** The most this entry may spend on the pick it's making now. */
async function budgetCap(db: DbOrTx, league: LeagueRow, entryId: string): Promise<number> {
    return maxAffordable({
        budget: league.settings.budget,
        spent: await spentBy(db, league.id, entryId),
        openSlots: await openSlotsOf(db, league.id, entryId),
        minCost: await minCostOf(db, league.id),
    });
}

// ---- Starting ----

export async function startDraft(ctx: Ctx, leagueId: string, input: z.infer<typeof StartDraftSchema>): Promise<DraftState> {
    await withTx(ctx, async (tx, events) => {
        const league = await getLeagueRow(tx, leagueId);
        requireManager(ctx, league);
        requireStatus(league, ["registration"], "start the draft");

        const all = await tx.select().from(entries).where(eq(entries.leagueId, leagueId));
        const approved = all.filter((e) => e.status === "approved");
        const pending = all.filter((e) => e.status === "pending").length;
        if (pending > 0) {
            throw conflict(ErrorCodes.ENTRY_PENDING_EXISTS, `Approve or reject the ${pending} pending application(s) first`);
        }
        if (approved.length < 2) {
            throw conflict(ErrorCodes.LEAGUE_NOT_ENOUGH_COACHES, `A draft needs at least 2 approved coaches; this league has ${approved.length}`);
        }

        const draftable = await tx
            .select({ points: leaguePool.points })
            .from(leaguePool)
            .where(and(eq(leaguePool.leagueId, leagueId), eq(leaguePool.banned, false)));
        const feasible = poolFeasibility({
            draftablePoints: draftable.map((d) => d.points),
            coaches: approved.length,
            rosterSize: league.settings.rosterSize,
            budget: league.settings.budget,
        });
        if (!feasible.ok) throw conflict(ErrorCodes.LEAGUE_POOL_INFEASIBLE, feasible.reason);

        const ids = approved.map((e) => e.id);
        let order: string[];
        if (input.order) {
            const same = input.order.length === ids.length && new Set(input.order).size === ids.length && input.order.every((id) => ids.includes(id));
            if (!same) {
                throw invalid(ErrorCodes.DRAFT_ORDER_INVALID, "The draft order must list every approved coach's entry exactly once");
            }
            order = input.order;
        } else {
            order = shuffle(ids);
        }

        const timer = league.settings.pickTimerSeconds;
        const at = nowIso(ctx);
        const slots = snakeSlots(order, league.settings.rosterSize).map((s, i) => ({
            leagueId,
            slotNo: s.slotNo,
            entryId: s.entryId,
            round: s.round,
            kind: "regular" as const,
            status: "open" as const,
            deadline: i === 0 && timer > 0 ? addSeconds(at, timer) : null,
        }));
        for (let i = 0; i < slots.length; i += 200) await tx.insert(draftSlots).values(slots.slice(i, i + 200));
        await tx.update(leagues).set({ status: "drafting", draftOrder: order }).where(eq(leagues.id, leagueId));

        const names = order.map((id) => approved.find((e) => e.id === id)!.teamName);
        events.push({
            leagueId,
            type: "draft.started",
            title: "The draft has started",
            text: `${league.name}: ${league.settings.rosterSize} rounds, ${league.settings.budget} points each.\nOrder: ${names.join(" → ")}`,
        });
    });
    return getDraftState(ctx, leagueId);
}

// ---- The clock ----

async function finishDraft(db: DbOrTx, league: LeagueRow, events: DomainEvent[]) {
    await db.update(leagues).set({ status: "season" }).where(eq(leagues.id, league.id));
    events.push({ leagueId: league.id, type: "draft.completed", title: "The draft is complete", text: `${league.name}: every roster is full. The season can begin.` });
}

/**
 * Ends a slot without a pick by the coach: a regular slot is skipped and the coach gets a makeup slot
 * at the end of the draft; a makeup slot is auto-picked (the cheapest Pokémon that fits the budget),
 * or forfeited if nothing fits.
 */
async function expireSlot(db: DbOrTx, league: LeagueRow, slot: SlotRow, by: string, at: string, events: DomainEvent[]) {
    const team = await teamName(db, slot.entryId);
    if (slot.kind === "regular") {
        await db
            .update(draftSlots)
            .set({ status: "skipped" })
            .where(and(eq(draftSlots.leagueId, league.id), eq(draftSlots.slotNo, slot.slotNo)));
        const [last] = await db.select({ v: max(draftSlots.slotNo) }).from(draftSlots).where(eq(draftSlots.leagueId, league.id));
        await db.insert(draftSlots).values({
            leagueId: league.id,
            slotNo: Number(last?.v ?? slot.slotNo) + 1,
            entryId: slot.entryId,
            round: slot.round,
            kind: "makeup",
            status: "open",
            deadline: null,
        });
        events.push({
            leagueId: league.id,
            type: "pick.skipped",
            title: "Pick skipped",
            text: `**${team}** missed pick ${slot.slotNo} (round ${slot.round}) and will make it up at the end of the draft.`,
        });
        return;
    }

    const cap = await budgetCap(db, league, slot.entryId);
    const choice = await db
        .select({ id: pokemon.id, name: pokemon.name, points: leaguePool.points })
        .from(leaguePool)
        .innerJoin(pokemon, eq(pokemon.id, leaguePool.pokemonId))
        .leftJoin(picks, and(eq(picks.leagueId, leaguePool.leagueId), eq(picks.pokemonId, leaguePool.pokemonId)))
        .where(and(eq(leaguePool.leagueId, league.id), eq(leaguePool.banned, false), isNull(picks.id), lte(leaguePool.points, cap)))
        .orderBy(asc(leaguePool.points), asc(pokemon.id))
        .limit(1)
        .get();
    const where = and(eq(draftSlots.leagueId, league.id), eq(draftSlots.slotNo, slot.slotNo));
    if (!choice) {
        await db.update(draftSlots).set({ status: "forfeited" }).where(where);
        return;
    }
    await db.insert(picks).values({
        id: newId("pk"),
        leagueId: league.id,
        entryId: slot.entryId,
        pokemonId: choice.id,
        points: choice.points,
        slotNo: slot.slotNo,
        pickedBy: by,
        createdAt: at,
    });
    await db.update(draftSlots).set({ status: "auto" }).where(where);
    events.push({
        leagueId: league.id,
        type: "pick.auto",
        title: "Auto-pick",
        text: `**${team}** ran out of time on a makeup pick and got **${choice.name}** (${choice.points} pts).`,
    });
}

/**
 * The draft timer, evaluated lazily: every read or write of the draft first settles any slots whose
 * deadline has passed, in order. No background job, so it also works on serverless hosting.
 * Each next deadline counts from the previous one, so a long gap settles several slots at once.
 */
export async function advanceClock(db: DbOrTx, leagueId: string, now: string, events: DomainEvent[]): Promise<void> {
    const league = await getLeagueRow(db, leagueId);
    const timer = league.settings.pickTimerSeconds;
    if (league.status !== "drafting" || timer <= 0) return;
    // Every pass settles one slot; regular slots can add one makeup each, so this bounds the loop
    for (let guard = 0; guard < 1000; guard++) {
        const cur = await currentSlot(db, leagueId);
        if (!cur) return finishDraft(db, league, events);
        if (!cur.deadline) {
            await db
                .update(draftSlots)
                .set({ deadline: addSeconds(now, timer) })
                .where(and(eq(draftSlots.leagueId, leagueId), eq(draftSlots.slotNo, cur.slotNo)));
            return;
        }
        if (cur.deadline > now) return;
        await expireSlot(db, league, cur, "timer", cur.deadline, events);
        const next = await currentSlot(db, leagueId);
        if (!next) return finishDraft(db, league, events);
        await db
            .update(draftSlots)
            .set({ deadline: addSeconds(cur.deadline, timer) })
            .where(and(eq(draftSlots.leagueId, leagueId), eq(draftSlots.slotNo, next.slotNo)));
    }
    throw new Error(`draft clock for ${leagueId} did not settle`);
}

/** After a slot is used: start the next slot's clock, or finish the draft. */
async function moveOn(db: DbOrTx, league: LeagueRow, at: string, events: DomainEvent[]) {
    const next = await currentSlot(db, league.id);
    if (!next) return finishDraft(db, league, events);
    const timer = league.settings.pickTimerSeconds;
    if (timer > 0) {
        await db
            .update(draftSlots)
            .set({ deadline: addSeconds(at, timer) })
            .where(and(eq(draftSlots.leagueId, league.id), eq(draftSlots.slotNo, next.slotNo)));
    }
}

// ---- Picking ----

export async function makePick(ctx: Ctx, leagueId: string, input: z.infer<typeof PickSchema>): Promise<DraftState> {
    const actor = requireActor(ctx);
    try {
        await withTx(ctx, async (tx, events) => {
            const at = nowIso(ctx);
            await advanceClock(tx, leagueId, at, events);
            const league = await getLeagueRow(tx, leagueId);
            requireStatus(league, ["drafting"], "make a pick");
            const slot = (await currentSlot(tx, leagueId))!;
            const entry = (await tx.select().from(entries).where(eq(entries.id, slot.entryId)).get())!;

            const isCoach = entry.userId === actor.id;
            const manager = canManage(league, actor);
            if (!isCoach && !manager) {
                const mine = await tx
                    .select({ id: entries.id })
                    .from(entries)
                    .where(and(eq(entries.leagueId, leagueId), eq(entries.userId, actor.id), eq(entries.status, "approved")))
                    .get();
                if (mine) throw conflict(ErrorCodes.DRAFT_NOT_YOUR_TURN, `It's ${entry.teamName}'s turn`);
                throw forbidden("You're not a coach in this league");
            }

            const row = await tx
                .select({ points: leaguePool.points, banned: leaguePool.banned, name: pokemon.name })
                .from(leaguePool)
                .innerJoin(pokemon, eq(pokemon.id, leaguePool.pokemonId))
                .where(and(eq(leaguePool.leagueId, leagueId), eq(leaguePool.pokemonId, input.pokemonId)))
                .get();
            if (!row) throw notFound(ErrorCodes.DRAFT_NOT_IN_POOL, `Pokémon #${input.pokemonId} isn't in this league's pool`);
            if (row.banned) throw conflict(ErrorCodes.DRAFT_POKEMON_BANNED, `${row.name} is banned in this league`);
            const taken = await tx
                .select({ team: entries.teamName })
                .from(picks)
                .innerJoin(entries, eq(entries.id, picks.entryId))
                .where(and(eq(picks.leagueId, leagueId), eq(picks.pokemonId, input.pokemonId)))
                .get();
            if (taken) throw conflict(ErrorCodes.DRAFT_POKEMON_TAKEN, `${row.name} was already drafted by ${taken.team}`);

            const cap = await budgetCap(tx, league, entry.id);
            if (row.points > cap) {
                throw invalid(
                    ErrorCodes.DRAFT_OVER_BUDGET,
                    `${row.name} costs ${row.points} points; ${entry.teamName} can spend at most ${cap} on this pick and still fill its roster`,
                );
            }

            await tx.insert(picks).values({
                id: newId("pk"),
                leagueId,
                entryId: entry.id,
                pokemonId: input.pokemonId,
                points: row.points,
                slotNo: slot.slotNo,
                pickedBy: actor.id,
                createdAt: at,
            });
            await tx
                .update(draftSlots)
                .set({ status: "picked" })
                .where(and(eq(draftSlots.leagueId, leagueId), eq(draftSlots.slotNo, slot.slotNo)));
            events.push({
                leagueId,
                type: "pick.made",
                title: `Pick ${slot.slotNo} (round ${slot.round})`,
                text: `**${entry.teamName}** drafted **${row.name}** for ${row.points} pts${isCoach ? "" : " (picked by the commissioner)"}.`,
            });
            await moveOn(tx, league, at, events);
        });
    } catch (err) {
        // Two coaches picking the same Pokémon at the same moment: the unique index lets one through
        if (isUniqueViolation(err)) throw conflict(ErrorCodes.DRAFT_POKEMON_TAKEN, "That Pokémon was just drafted by someone else");
        throw err;
    }
    return getDraftState(ctx, leagueId);
}

/** The commissioner moves the draft on, as if the current slot's timer ran out. */
export async function skipCurrentPick(ctx: Ctx, leagueId: string): Promise<DraftState> {
    const actor = requireActor(ctx);
    await withTx(ctx, async (tx, events) => {
        const at = nowIso(ctx);
        await advanceClock(tx, leagueId, at, events);
        const league = await getLeagueRow(tx, leagueId);
        requireManager(ctx, league);
        requireStatus(league, ["drafting"], "skip a pick");
        const slot = (await currentSlot(tx, leagueId))!;
        await expireSlot(tx, league, slot, actor.id, at, events);
        await moveOn(tx, league, at, events);
    });
    return getDraftState(ctx, leagueId);
}

// ---- Reading ----

export async function getDraftState(ctx: Ctx, leagueId: string): Promise<DraftState> {
    const actor = requireActor(ctx);
    return withTx(ctx, async (tx, events) => {
        const now = nowIso(ctx);
        await advanceClock(tx, leagueId, now, events);
        const league = await getLeagueRow(tx, leagueId);

        const teamRows = await tx
            .select({ entryId: entries.id, teamName: entries.teamName, userId: entries.userId, coachName: users.displayName })
            .from(entries)
            .innerJoin(users, eq(users.id, entries.userId))
            .where(and(eq(entries.leagueId, leagueId), eq(entries.status, "approved")));
        const nameOf = (id: string) => teamRows.find((t) => t.entryId === id)?.teamName ?? "(unknown team)";
        const slots = await tx.select().from(draftSlots).where(eq(draftSlots.leagueId, leagueId)).orderBy(asc(draftSlots.slotNo));
        const pickRows = await tx
            .select({ pick: picks, p: pokemon })
            .from(picks)
            .innerJoin(pokemon, eq(pokemon.id, picks.pokemonId))
            .where(eq(picks.leagueId, leagueId))
            .orderBy(desc(picks.slotNo));
        const minCost = await minCostOf(tx, leagueId);

        const open = slots.filter((s) => s.status === "open");
        const cur = open[0];
        const order = (league.draftOrder ?? []).map((id) => {
            const t = teamRows.find((r) => r.entryId === id);
            return { entryId: id, teamName: t?.teamName ?? "(unknown team)", coach: { id: t?.userId ?? "", displayName: t?.coachName ?? "" } };
        });
        const teams = teamRows.map((t) => {
            const mine = pickRows.filter((r) => r.pick.entryId === t.entryId);
            const spent = mine.reduce((s, r) => s + r.pick.points, 0);
            const openSlots = open.filter((s) => s.entryId === t.entryId).length;
            return {
                entryId: t.entryId,
                teamName: t.teamName,
                coach: { id: t.userId, displayName: t.coachName },
                spent,
                budgetLeft: league.settings.budget - spent,
                picksMade: mine.length,
                openSlots,
                maxForNextPick: openSlots > 0 ? maxAffordable({ budget: league.settings.budget, spent, openSlots, minCost }) : 0,
            };
        });
        const myEntry = teamRows.find((t) => t.userId === actor.id)?.entryId ?? null;

        return {
            leagueId,
            leagueName: league.name,
            status: league.status,
            settings: league.settings,
            serverTime: now,
            minCost,
            totalRounds: league.settings.rosterSize,
            order,
            current: cur
                ? { slotNo: cur.slotNo, round: cur.round, kind: cur.kind, entryId: cur.entryId, teamName: nameOf(cur.entryId), deadline: cur.deadline }
                : null,
            upcoming: open.slice(1, 11).map((s) => ({ slotNo: s.slotNo, round: s.round, kind: s.kind, entryId: s.entryId, teamName: nameOf(s.entryId) })),
            picks: pickRows.map(({ pick, p }) => {
                const owner = teamRows.find((t) => t.entryId === pick.entryId);
                return {
                    slotNo: pick.slotNo,
                    round: slots.find((s) => s.slotNo === pick.slotNo)?.round ?? 0,
                    entryId: pick.entryId,
                    teamName: nameOf(pick.entryId),
                    points: pick.points,
                    pickedBy: pick.pickedBy === "timer" ? "timer" : pick.pickedBy === owner?.userId ? "coach" : "commissioner",
                    pokemon: toPokemonDto(p),
                    createdAt: pick.createdAt,
                };
            }),
            skipped: slots
                .filter((s) => s.status === "skipped" || s.status === "forfeited")
                .map((s) => ({ slotNo: s.slotNo, round: s.round, entryId: s.entryId, teamName: nameOf(s.entryId), status: s.status })),
            teams,
            me: { entryId: myEntry, isMyTurn: !!cur && cur.entryId === myEntry, canManage: canManage(league, actor) },
        };
    });
}

/** Entry ids of a league's approved coaches (for tests and the seed). */
export async function approvedEntryIds(db: DbOrTx, leagueId: string): Promise<string[]> {
    const rows = await db
        .select({ id: entries.id })
        .from(entries)
        .where(and(eq(entries.leagueId, leagueId), inArray(entries.status, ["approved"])))
        .orderBy(asc(entries.createdAt));
    return rows.map((r) => r.id);
}
