import { and, eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import type { Db } from "@/lib/db/client";
import { draftSlots, leaguePool } from "@/lib/db/schema";
import { ctxOf, expectError, leagueWithCoaches, makeUser, setupDb } from "@/test/helpers";
import { approvedEntryIds, getDraftState, makePick, skipCurrentPick, startDraft } from "./draft";
import { applyToLeague } from "./entries";
import { getLeague, updateLeague } from "./leagues";
import { updatePool } from "./pool";

let db: Db;
beforeAll(async () => {
    db = await setupDb();
});

const GARCHOMP = 445; // 20 points
const PIKACHU = 25;
const MAGIKARP = 129; // 1 point
const MEWTWO = 150; // banned
const T0 = new Date("2026-11-09T10:00:00.000Z");
const at = (seconds: number) => new Date(T0.getTime() + seconds * 1000);

describe("startDraft", () => {
    it("builds a snake order over every round and opens the first slot", async () => {
        const { commissioner, league, coaches } = await leagueWithCoaches(db, { coaches: 3, settings: { rosterSize: 4 } });
        const order = [coaches[2]!.entryId, coaches[0]!.entryId, coaches[1]!.entryId];
        const ctx = ctxOf(db, commissioner);
        const state = await startDraft(ctx, league.id, { order });
        expect(state.status).toBe("drafting");
        expect(state.order.map((o) => o.entryId)).toEqual(order);
        expect(state.current).toMatchObject({ slotNo: 1, round: 1, entryId: order[0], deadline: null });
        expect(state.upcoming.slice(0, 5).map((s) => s.entryId)).toEqual([order[1], order[2], order[2], order[1], order[0]]);
        expect(state.teams.every((t) => t.openSlots === 4 && t.spent === 0)).toBe(true);
        expect(ctx.events.map((e) => e.type)).toEqual(["draft.started"]);
    });

    it("shuffles the order when none is given", async () => {
        const { commissioner, league, coaches } = await leagueWithCoaches(db, { coaches: 4 });
        const state = await startDraft(ctxOf(db, commissioner), league.id, {});
        expect([...state.order.map((o) => o.entryId)].sort()).toEqual(coaches.map((c) => c.entryId).sort());
    });

    it("needs two approved coaches and no pending ones", async () => {
        const one = await leagueWithCoaches(db, { coaches: 1 });
        await expectError(startDraft(ctxOf(db, one.commissioner), one.league.id, {}), 409, "LEAGUE_NOT_ENOUGH_COACHES");
        const two = await leagueWithCoaches(db, { coaches: 2 });
        await applyToLeague(ctxOf(db, await makeUser(db)), two.league.id, { teamName: "Waiting" });
        await expect(startDraft(ctxOf(db, two.commissioner), two.league.id, {})).rejects.toMatchObject({
            status: 409,
            code: "ENTRY_PENDING_EXISTS",
            message: "Approve or reject the 1 pending application(s) first",
        });
    });

    it("refuses an order that isn't exactly the approved coaches", async () => {
        const { commissioner, league, coaches } = await leagueWithCoaches(db, { coaches: 2 });
        const ctx = ctxOf(db, commissioner);
        await expectError(startDraft(ctx, league.id, { order: [coaches[0]!.entryId, coaches[0]!.entryId] }), 422, "DRAFT_ORDER_INVALID");
        await expectError(startDraft(ctx, league.id, { order: [coaches[0]!.entryId, "en_stranger"] }), 422, "DRAFT_ORDER_INVALID");
    });

    it("refuses a pool where a coach could get stuck", async () => {
        const { commissioner, league } = await leagueWithCoaches(db, { coaches: 2, settings: { budget: 30, rosterSize: 10 } });
        // make every 1-point Pokémon cost 3: ten of them (30) would no longer leave room... and there aren't enough 3s either
        await db.update(leaguePool).set({ points: 3 }).where(and(eq(leaguePool.leagueId, league.id), eq(leaguePool.points, 1)));
        await updateLeague(ctxOf(db, commissioner), league.id, { settings: { budget: 25 } });
        await expect(startDraft(ctxOf(db, commissioner), league.id, {})).rejects.toMatchObject({ status: 409, code: "LEAGUE_POOL_INFEASIBLE" });
    });

    it("is for the commissioner, during registration", async () => {
        const { league, coaches } = await leagueWithCoaches(db, { coaches: 2 });
        await expectError(startDraft(ctxOf(db, coaches[0]!.actor), league.id, {}), 403, "RBAC_FORBIDDEN");
        const started = await leagueWithCoaches(db, { coaches: 2, draft: true });
        await expectError(startDraft(ctxOf(db, started.commissioner), started.league.id, {}), 409, "LEAGUE_INVALID_STATE");
    });
});

describe("makePick", () => {
    it("records the pick, charges the points and passes the turn", async () => {
        const { league, coaches } = await leagueWithCoaches(db, { coaches: 2, draft: true });
        const ctx = ctxOf(db, coaches[0]!.actor);
        const state = await makePick(ctx, league.id, { pokemonId: GARCHOMP });
        expect(state.picks[0]).toMatchObject({ slotNo: 1, round: 1, entryId: coaches[0]!.entryId, points: 20, pickedBy: "coach", pokemon: { name: "Garchomp" } });
        expect(state.current).toMatchObject({ slotNo: 2, entryId: coaches[1]!.entryId });
        expect(state.teams.find((t) => t.entryId === coaches[0]!.entryId)).toMatchObject({ spent: 20, budgetLeft: 80, picksMade: 1, openSlots: 9 });
        expect(ctx.events).toEqual([expect.objectContaining({ type: "pick.made", text: expect.stringContaining("Garchomp") })]);
    });

    it("refuses picks out of turn, by outsiders, of banned, taken or unknown Pokémon", async () => {
        const { league, coaches } = await leagueWithCoaches(db, { coaches: 2, draft: true });
        const first = ctxOf(db, coaches[0]!.actor);
        const second = ctxOf(db, coaches[1]!.actor);
        await expect(makePick(second, league.id, { pokemonId: PIKACHU })).rejects.toMatchObject({
            status: 409,
            code: "DRAFT_NOT_YOUR_TURN",
            message: expect.stringMatching(/^It's .+'s turn$/),
        });
        await expectError(makePick(ctxOf(db, await makeUser(db)), league.id, { pokemonId: PIKACHU }), 403, "RBAC_FORBIDDEN");
        await expectError(makePick(first, league.id, { pokemonId: MEWTWO }), 409, "DRAFT_POKEMON_BANNED");
        await expectError(makePick(first, league.id, { pokemonId: 5000 }), 404, "DRAFT_NOT_IN_POOL");
        await makePick(first, league.id, { pokemonId: PIKACHU });
        await expect(makePick(second, league.id, { pokemonId: PIKACHU })).rejects.toMatchObject({
            status: 409,
            code: "DRAFT_POKEMON_TAKEN",
            message: expect.stringContaining("Pikachu was already drafted by"),
        });
    });

    it("keeps enough budget for the rest of the roster", async () => {
        // 3 rounds, 20 points: the first pick may cost at most 20 - 2 x 1 = 18
        const { commissioner, league, coaches } = await leagueWithCoaches(db, { coaches: 2, settings: { budget: 20, rosterSize: 3 } });
        await startDraft(ctxOf(db, commissioner), league.id, { order: coaches.map((c) => c.entryId) });
        await expect(makePick(ctxOf(db, coaches[0]!.actor), league.id, { pokemonId: GARCHOMP })).rejects.toMatchObject({
            status: 422,
            code: "DRAFT_OVER_BUDGET",
            message: expect.stringContaining("can spend at most 18 on this pick"),
        });
        const state = await getDraftState(ctxOf(db, coaches[0]!.actor), league.id);
        expect(state.teams.find((t) => t.entryId === coaches[0]!.entryId)!.maxForNextPick).toBe(18);
    });

    it("lets the commissioner pick for the coach whose turn it is", async () => {
        const { commissioner, league, coaches } = await leagueWithCoaches(db, { coaches: 2, draft: true });
        const state = await makePick(ctxOf(db, commissioner), league.id, { pokemonId: PIKACHU });
        expect(state.picks[0]).toMatchObject({ entryId: coaches[0]!.entryId, pickedBy: "commissioner" });
    });

    it("lets exactly one of two simultaneous picks of the same Pokémon through", async () => {
        const { commissioner, league } = await leagueWithCoaches(db, { coaches: 2, draft: true });
        const results = await Promise.allSettled([
            makePick(ctxOf(db, commissioner), league.id, { pokemonId: GARCHOMP }),
            makePick(ctxOf(db, commissioner), league.id, { pokemonId: GARCHOMP }),
        ]);
        expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
        const failed = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
        expect(failed.reason).toMatchObject({ status: 409, code: "DRAFT_POKEMON_TAKEN" });
        const state = await getDraftState(ctxOf(db, commissioner), league.id);
        expect(state.picks).toHaveLength(1);
    });

    it("completes the draft when the last slot is filled", async () => {
        const { league, coaches } = await leagueWithCoaches(db, { coaches: 2, settings: { rosterSize: 3 }, draft: true });
        const turn = [0, 1, 1, 0, 0, 1];
        const mons = [1, 4, 7, 10, 13, 16];
        let last;
        for (let i = 0; i < 6; i++) {
            last = ctxOf(db, coaches[turn[i]!]!.actor);
            await makePick(last, league.id, { pokemonId: mons[i]! });
        }
        expect(last!.events.map((e) => e.type)).toEqual(["pick.made", "draft.completed"]);
        const state = await getDraftState(ctxOf(db, coaches[0]!.actor), league.id);
        expect(state).toMatchObject({ status: "season", current: null });
        expect(state.picks).toHaveLength(6);
        await expectError(makePick(ctxOf(db, coaches[0]!.actor), league.id, { pokemonId: 19 }), 409, "LEAGUE_INVALID_STATE");
        expect((await getLeague(ctxOf(db, coaches[0]!.actor), league.id)).status).toBe("season");
    });
});

/** Makes picks in slot order: [actor index, Pokémon id] per pick. */
async function pickInOrder(coaches: { actor: Parameters<typeof ctxOf>[1] }[], leagueId: string, moves: [number, number][], now?: Date) {
    for (const [who, pokemonId] of moves) await makePick(ctxOf(db, coaches[who]!.actor, now), leagueId, { pokemonId });
}

describe("the draft timer", () => {
    // 2 coaches x 3 rounds: slots go A B B A A B, makeups after slot 6
    async function timedDraft(coaches = 2, rosterSize = 3) {
        const setup = await leagueWithCoaches(db, { coaches, settings: { pickTimerSeconds: 60, rosterSize }, now: T0 });
        await startDraft(ctxOf(db, setup.commissioner, T0), setup.league.id, { order: setup.coaches.map((c) => c.entryId) });
        return setup;
    }

    it("sets a deadline on the current slot", async () => {
        const { league, coaches } = await timedDraft();
        const state = await getDraftState(ctxOf(db, coaches[0]!.actor, at(10)), league.id);
        expect(state.current).toMatchObject({ slotNo: 1, deadline: "2026-11-09T10:01:00.000Z" });
    });

    it("skips a slot whose time ran out and gives the coach a makeup pick at the end", async () => {
        const { league, coaches } = await timedDraft();
        const ctx = ctxOf(db, coaches[1]!.actor, at(61));
        const state = await getDraftState(ctx, league.id);
        expect(state.skipped).toEqual([expect.objectContaining({ slotNo: 1, entryId: coaches[0]!.entryId, status: "skipped" })]);
        // the next deadline counts from the missed one, not from when someone looked
        expect(state.current).toMatchObject({ slotNo: 2, entryId: coaches[1]!.entryId, deadline: "2026-11-09T10:02:00.000Z" });
        expect(state.upcoming.at(-1)).toMatchObject({ slotNo: 7, kind: "makeup", entryId: coaches[0]!.entryId });
        expect(ctx.events.map((e) => e.type)).toEqual(["pick.skipped"]);
    });

    it("auto-picks the cheapest Pokémon that fits when a makeup slot runs out", async () => {
        // Coach A misses slot 1, then slots 2–6 are picked in time; A's makeup (slot 7) then runs out too
        const { league, coaches } = await timedDraft();
        await pickInOrder(coaches, league.id, [[1, PIKACHU], [1, 26], [0, 1], [0, 4], [1, 7]], at(70));
        const ctx = ctxOf(db, coaches[0]!.actor, at(70 + 61));
        const state = await getDraftState(ctx, league.id);
        expect(state.status).toBe("season");
        const auto = state.picks.find((p) => p.slotNo === 7)!;
        expect(auto).toMatchObject({ entryId: coaches[0]!.entryId, pickedBy: "timer", points: 1 });
        expect(ctx.events.map((e) => e.type)).toEqual(["pick.auto", "draft.completed"]);
    });

    it("settles several missed slots at once after a long gap", async () => {
        const { league, coaches } = await timedDraft();
        const state = await getDraftState(ctxOf(db, coaches[0]!.actor, at(60 * 60)), league.id);
        // 6 regular slots skipped, then 6 makeups auto-picked: the draft is over
        expect(state.status).toBe("season");
        expect(state.skipped).toHaveLength(6);
        expect(state.picks).toHaveLength(6);
        expect(state.picks.every((p) => p.pickedBy === "timer")).toBe(true);
        expect(state.teams.every((t) => t.picksMade === 3)).toBe(true);
    });

    it("restarts the clock for the next coach after a pick", async () => {
        const { league, coaches } = await timedDraft();
        const state = await makePick(ctxOf(db, coaches[0]!.actor, at(30)), league.id, { pokemonId: MAGIKARP });
        expect(state.current).toMatchObject({ slotNo: 2, deadline: "2026-11-09T10:01:30.000Z" });
    });

    it("announces nothing when the pick that ran the clock fails", async () => {
        const { league, coaches } = await timedDraft();
        // Coach 1's time is up: the clock moves to coach 2, so coach 1's late pick is refused and rolled back
        const late = ctxOf(db, coaches[0]!.actor, at(61));
        await expectError(makePick(late, league.id, { pokemonId: PIKACHU }), 409, "DRAFT_NOT_YOUR_TURN");
        expect(late.events).toEqual([]);
    });
});

describe("skipCurrentPick", () => {
    it("lets the commissioner move the draft on, with a makeup slot for the skipped coach", async () => {
        const { commissioner, league, coaches } = await leagueWithCoaches(db, { coaches: 2, settings: { rosterSize: 3 }, draft: true });
        const state = await skipCurrentPick(ctxOf(db, commissioner), league.id);
        expect(state.current).toMatchObject({ slotNo: 2, entryId: coaches[1]!.entryId });
        expect(state.upcoming.at(-1)).toMatchObject({ slotNo: 7, kind: "makeup", entryId: coaches[0]!.entryId });
        const slots = await db.select().from(draftSlots).where(eq(draftSlots.leagueId, league.id));
        expect(slots).toHaveLength(7);
    });

    it("auto-picks when skipping a makeup slot", async () => {
        const { commissioner, league, coaches } = await leagueWithCoaches(db, { coaches: 2, settings: { rosterSize: 3 }, draft: true });
        const cctx = ctxOf(db, commissioner);
        await skipCurrentPick(cctx, league.id);
        await pickInOrder(coaches, league.id, [[1, PIKACHU], [1, 26], [0, 1], [0, 4], [1, 7]]);
        const state = await skipCurrentPick(cctx, league.id);
        expect(state.status).toBe("season");
        expect(state.picks.find((p) => p.entryId === coaches[0]!.entryId)).toMatchObject({ pickedBy: "commissioner", points: 1 });
    });

    it("is for the commissioner", async () => {
        const { league, coaches } = await leagueWithCoaches(db, { coaches: 2, draft: true });
        await expectError(skipCurrentPick(ctxOf(db, coaches[0]!.actor), league.id), 403, "RBAC_FORBIDDEN");
    });
});

describe("getDraftState", () => {
    it("tells a coach when it's their turn", async () => {
        const { league, coaches } = await leagueWithCoaches(db, { coaches: 2, draft: true });
        expect((await getDraftState(ctxOf(db, coaches[0]!.actor), league.id)).me).toEqual({
            entryId: coaches[0]!.entryId,
            isMyTurn: true,
            canManage: false,
        });
        expect((await getDraftState(ctxOf(db, coaches[1]!.actor), league.id)).me.isMyTurn).toBe(false);
    });

    it("works before the draft (no order yet) and lists approved entries", async () => {
        const { league, coaches } = await leagueWithCoaches(db, { coaches: 2 });
        const state = await getDraftState(ctxOf(db, coaches[0]!.actor), league.id);
        expect(state).toMatchObject({ status: "registration", current: null, order: [], picks: [] });
        expect(await approvedEntryIds(db, league.id)).toEqual(coaches.map((c) => c.entryId));
    });

    it("uses the pool's cheapest cost for the budget rule", async () => {
        const { commissioner, league, coaches } = await leagueWithCoaches(db, { coaches: 2, settings: { budget: 40, rosterSize: 3 } });
        // ban every 1- and 3-point Pokémon: the cheapest left cost 5
        await db.update(leaguePool).set({ banned: true }).where(and(eq(leaguePool.leagueId, league.id), eq(leaguePool.points, 1)));
        await db.update(leaguePool).set({ banned: true }).where(and(eq(leaguePool.leagueId, league.id), eq(leaguePool.points, 3)));
        await updatePool(ctxOf(db, commissioner), league.id, { changes: [{ pokemonId: GARCHOMP, points: 20 }] });
        const state = await startDraft(ctxOf(db, commissioner), league.id, { order: coaches.map((c) => c.entryId) });
        expect(state.minCost).toBe(5);
        expect(state.teams[0]!.maxForNextPick).toBe(40 - 2 * 5);
    });
});
