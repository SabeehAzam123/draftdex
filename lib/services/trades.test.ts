import { and, eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import type { Db } from "@/lib/db/client";
import { picks } from "@/lib/db/schema";
import { ctxOf, expectError, makeUser, seasonLeague, setupDb } from "@/test/helpers";
import { listPool } from "./pool";
import { getTeam } from "./teams";
import { actOnTrade, listTrades, proposeTrade } from "./trades";
import { PoolQuerySchema } from "@/lib/validators/schemas";

let db: Db;
beforeAll(async () => {
    db = await setupDb();
});

/** A 2-coach season: A drafted slots 1, 4, 5; B drafted 2, 3, 6 (snake). */
async function setup() {
    const s = await seasonLeague(db, { coaches: 2 });
    const [A, B] = s.coaches as [(typeof s.coaches)[0], (typeof s.coaches)[0]];
    const rosterIds = async (entryId: string) => (await getTeam(ctxOf(db, A.actor), s.league.id, entryId)).roster.map((r) => r.pokemon.id);
    return { ...s, A, B, a: ctxOf(db, A.actor), b: ctxOf(db, B.actor), comm: ctxOf(db, s.commissioner), aIds: await rosterIds(A.entryId), bIds: await rosterIds(B.entryId), rosterIds };
}

describe("proposing a trade", () => {
    it("creates a proposal the other coach can accept", async () => {
        const { a, b, A, B, aIds, bIds, league } = await setup();
        const t = await proposeTrade(a, league.id, { toEntryId: B.entryId, give: [aIds[0]!], get: [bIds[0]!], note: "Swap?" });
        expect(t).toMatchObject({ status: "proposed", from: { entryId: A.entryId }, to: { entryId: B.entryId }, note: "Swap?" });
        expect(t.give).toEqual([expect.objectContaining({ id: aIds[0], points: 1 })]);
        expect(t.me).toEqual({ canAccept: false, canDecline: false, canCancel: true, canApprove: false, canReject: false });
        const forB = (await listTrades(b, league.id))[0]!;
        expect(forB.me).toMatchObject({ canAccept: true, canDecline: true, canCancel: false });
    });

    it("refuses uneven swaps, Pokémon a side doesn't own, outsiders and trading with yourself", async () => {
        const { a, A, B, aIds, bIds, league } = await setup();
        await expectError(proposeTrade(a, league.id, { toEntryId: B.entryId, give: [aIds[0]!, aIds[1]!], get: [bIds[0]!] }), 422, "TRADE_INVALID");
        await expectError(proposeTrade(a, league.id, { toEntryId: B.entryId, give: [bIds[0]!], get: [bIds[1]!] }), 422, "TRADE_INVALID");
        await expectError(proposeTrade(a, league.id, { toEntryId: B.entryId, give: [aIds[0]!], get: [aIds[1]!] }), 422, "TRADE_INVALID");
        await expectError(proposeTrade(a, league.id, { toEntryId: A.entryId, give: [aIds[0]!], get: [aIds[1]!] }), 422, "TRADE_INVALID");
        await expectError(proposeTrade(a, league.id, { toEntryId: B.entryId, give: [aIds[0]!, aIds[0]!], get: [bIds[0]!, bIds[1]!] }), 422, "TRADE_INVALID");
        await expectError(proposeTrade(ctxOf(db, await makeUser(db)), league.id, { toEntryId: B.entryId, give: [1], get: [bIds[0]!] }), 403, "RBAC_FORBIDDEN");
    });

    it("refuses a swap that would put a team over budget", async () => {
        const { a, B, aIds, bIds, league } = await setup();
        // make one of B's picks cost 99: A would end up at 99 + 1 + 1 > 100
        await db.transaction((tx) => tx.update(picks).set({ points: 99 }).where(and(eq(picks.leagueId, league.id), eq(picks.pokemonId, bIds[0]!))));
        await expectError(proposeTrade(a, league.id, { toEntryId: B.entryId, give: [aIds[0]!], get: [bIds[0]!] }), 422, "TRADE_OVER_BUDGET");
    });
});

describe("the trade's life", () => {
    it("accepted, then approved: the Pokémon change hands and the draft history stays", async () => {
        const { a, b, comm, A, B, aIds, bIds, league, rosterIds } = await setup();
        const t = await proposeTrade(a, league.id, { toEntryId: B.entryId, give: [aIds[0]!], get: [bIds[0]!] });
        await expectError(actOnTrade(a, league.id, t.id, "accept"), 403, "RBAC_FORBIDDEN");
        await expectError(actOnTrade(comm, league.id, t.id, "approve"), 409, "TRADE_INVALID_STATE");
        expect((await actOnTrade(b, league.id, t.id, "accept")).status).toBe("accepted");
        await expectError(actOnTrade(b, league.id, t.id, "approve"), 403, "RBAC_FORBIDDEN");
        const approved = await actOnTrade(comm, league.id, t.id, "approve");
        expect(approved.status).toBe("approved");
        expect(comm.events.map((e) => e.type)).toEqual(["trade.approved"]);

        expect(await rosterIds(A.entryId)).toContain(bIds[0]);
        expect(await rosterIds(A.entryId)).not.toContain(aIds[0]);
        expect(await rosterIds(B.entryId)).toContain(aIds[0]);
        const teamA = await getTeam(a, league.id, A.entryId);
        expect(teamA.roster.find((r) => r.pokemon.id === bIds[0])).toMatchObject({ viaTrade: true });
        // The tier list shows the new owner; the draft record keeps the drafter
        const pool = await listPool(a, league.id, PoolQuerySchema.parse({ status: "taken", pageSize: 200 }));
        expect(pool.data.find((r) => r.pokemon.id === bIds[0])?.takenBy?.entryId).toBe(A.entryId);
        const drafted = await db.select().from(picks).where(and(eq(picks.leagueId, league.id), eq(picks.pokemonId, bIds[0]!))).get();
        expect(drafted).toMatchObject({ entryId: B.entryId, ownerEntryId: A.entryId });
    });

    it("trading a Pokémon back to its drafter clears the override", async () => {
        const { a, b, comm, B, aIds, bIds, league } = await setup();
        const there = await proposeTrade(a, league.id, { toEntryId: B.entryId, give: [aIds[0]!], get: [bIds[0]!] });
        await actOnTrade(b, league.id, there.id, "accept");
        await actOnTrade(comm, league.id, there.id, "approve");
        const back = await proposeTrade(a, league.id, { toEntryId: B.entryId, give: [bIds[0]!], get: [aIds[0]!] });
        await actOnTrade(b, league.id, back.id, "accept");
        await actOnTrade(comm, league.id, back.id, "approve");
        const rows = await db.select().from(picks).where(eq(picks.leagueId, league.id));
        expect(rows.every((r) => r.ownerEntryId === null)).toBe(true);
    });

    it("a trade whose Pokémon moved meanwhile is stale and can't be approved", async () => {
        const { a, b, comm, B, aIds, bIds, league } = await setup();
        const first = await proposeTrade(a, league.id, { toEntryId: B.entryId, give: [aIds[0]!], get: [bIds[0]!] });
        const second = await proposeTrade(a, league.id, { toEntryId: B.entryId, give: [aIds[0]!], get: [bIds[1]!] });
        for (const t of [first, second]) await actOnTrade(b, league.id, t.id, "accept");
        await actOnTrade(comm, league.id, first.id, "approve");
        await expectError(actOnTrade(comm, league.id, second.id, "approve"), 409, "TRADE_STALE");
        expect((await actOnTrade(comm, league.id, second.id, "reject")).status).toBe("rejected");
    });

    it("can be declined by the receiver or cancelled by the proposer, then it's over", async () => {
        const { a, b, B, aIds, bIds, league } = await setup();
        const t1 = await proposeTrade(a, league.id, { toEntryId: B.entryId, give: [aIds[0]!], get: [bIds[0]!] });
        await expectError(actOnTrade(b, league.id, t1.id, "cancel"), 403, "RBAC_FORBIDDEN");
        expect((await actOnTrade(b, league.id, t1.id, "decline")).status).toBe("declined");
        await expectError(actOnTrade(b, league.id, t1.id, "accept"), 409, "TRADE_INVALID_STATE");
        const t2 = await proposeTrade(a, league.id, { toEntryId: B.entryId, give: [aIds[1]!], get: [bIds[1]!] });
        expect((await actOnTrade(a, league.id, t2.id, "cancel")).status).toBe("cancelled");
        await expectError(actOnTrade(a, league.id, "tr_missing", "cancel"), 404, "TRADE_NOT_FOUND");
    });
});
