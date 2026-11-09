import { beforeAll, describe, expect, it } from "vitest";
import type { Db } from "@/lib/db/client";
import { PoolQuerySchema } from "@/lib/validators/schemas";
import { ctxOf, expectError, leagueWithCoaches, makeUser, setupDb } from "@/test/helpers";
import { makePick } from "./draft";
import { createLeague } from "./leagues";
import { importPoolCsv, listPool, poolSummary, updatePool } from "./pool";

let db: Db;
beforeAll(async () => {
    db = await setupDb();
});

const q = (over: Record<string, unknown> = {}) => PoolQuerySchema.parse(over);

async function newLeague() {
    const me = await makeUser(db);
    const league = await createLeague(ctxOf(db, me), { name: "Pool League", format: "singles", settings: {} });
    return { me, ctx: ctxOf(db, me), league };
}

describe("listPool", () => {
    it("searches by name or dex number and filters by type", async () => {
        const { ctx, league } = await newLeague();
        const byName = await listPool(ctx, league.id, q({ q: "garch" }));
        expect(byName.data.map((r) => r.pokemon.name)).toEqual(["Garchomp"]);
        expect(byName.data[0]).toMatchObject({ points: 20, banned: false, takenBy: null });
        const byDex = await listPool(ctx, league.id, q({ q: "25" }));
        expect(byDex.data.map((r) => r.pokemon.id)).toContain(25);
        const dragons = await listPool(ctx, league.id, q({ type: "dragon", pageSize: 200 }));
        expect(dragons.data.length).toBeGreaterThan(10);
        expect(dragons.data.every((r) => r.pokemon.types.includes("dragon"))).toBe(true);
    });

    it("filters by banned, points range, and sorts", async () => {
        const { ctx, league } = await newLeague();
        const banned = await listPool(ctx, league.id, q({ status: "banned", pageSize: 200 }));
        expect(banned.total).toBe(94); // every legendary and mythical
        expect(banned.data.every((r) => r.banned)).toBe(true);
        const mid = await listPool(ctx, league.id, q({ minPoints: 10, maxPoints: 12, pageSize: 200 }));
        expect(mid.data.every((r) => r.points >= 10 && r.points <= 12)).toBe(true);
        const byPoints = await listPool(ctx, league.id, q({ sort: "points", pageSize: 5 }));
        expect(byPoints.data[0]!.points).toBe(20);
        const byDex = await listPool(ctx, league.id, q({ sort: "dex", pageSize: 3 }));
        expect(byDex.data.map((r) => r.pokemon.id)).toEqual([1, 2, 3]);
        const byBst = await listPool(ctx, league.id, q({ sort: "bst", pageSize: 2 }));
        expect(byBst.data[0]!.pokemon.bst).toBeGreaterThanOrEqual(byBst.data[1]!.pokemon.bst);
    });

    it("shows who drafted what, and filters available and taken", async () => {
        const { league, coaches } = await leagueWithCoaches(db, { coaches: 2, draft: true });
        await makePick(ctxOf(db, coaches[0]!.actor), league.id, { pokemonId: 445 });
        const ctx = ctxOf(db, coaches[1]!.actor);
        const taken = await listPool(ctx, league.id, q({ status: "taken" }));
        expect(taken.total).toBe(1);
        expect(taken.data[0]).toMatchObject({ pokemon: { id: 445 }, takenBy: { entryId: coaches[0]!.entryId } });
        const available = await listPool(ctx, league.id, q({ status: "available", q: "Garchomp" }));
        expect(available.total).toBe(0);
    });

    it("answers 404 for an unknown league", async () => {
        const { ctx } = await newLeague();
        await expectError(listPool(ctx, "lg_missing", q()), 404, "LEAGUE_NOT_FOUND");
    });
});

describe("updatePool", () => {
    it("changes points and bans", async () => {
        const { ctx, league } = await newLeague();
        expect(await updatePool(ctx, league.id, { changes: [{ pokemonId: 445, points: 17 }, { pokemonId: 150, banned: false }] })).toEqual({
            updated: 2,
        });
        const rows = await listPool(ctx, league.id, q({ q: "Garchomp" }));
        expect(rows.data[0]!.points).toBe(17);
        const mewtwo = await listPool(ctx, league.id, q({ q: "Mewtwo" }));
        expect(mewtwo.data[0]!.banned).toBe(false);
    });

    it("changes nothing if any Pokémon is unknown", async () => {
        const { ctx, league } = await newLeague();
        await expect(updatePool(ctx, league.id, { changes: [{ pokemonId: 445, points: 3 }, { pokemonId: 99999, points: 3 }] })).rejects.toMatchObject({
            status: 422,
            code: "VALIDATION_ERROR",
            details: [{ path: "changes.pokemonId", message: "No Pokémon #99999" }],
        });
        expect((await listPool(ctx, league.id, q({ q: "Garchomp" }))).data[0]!.points).toBe(20);
    });

    it("is for the commissioner, and only before the draft", async () => {
        const { league } = await newLeague();
        await expectError(updatePool(ctxOf(db, await makeUser(db)), league.id, { changes: [{ pokemonId: 1, points: 2 }] }), 403, "RBAC_FORBIDDEN");
        const drafting = await leagueWithCoaches(db, { coaches: 2, draft: true });
        await expectError(
            updatePool(ctxOf(db, drafting.commissioner), drafting.league.id, { changes: [{ pokemonId: 1, points: 2 }] }),
            409,
            "LEAGUE_INVALID_STATE",
        );
    });
});

describe("importPoolCsv", () => {
    it("applies dex numbers and names (any case), and bans", async () => {
        const { ctx, league } = await newLeague();
        const result = await importPoolCsv(ctx, league.id, "dex,points\n445,15\npikachu,4\nMEWTWO,banned\n");
        expect(result).toEqual({ updated: 3 });
        expect((await listPool(ctx, league.id, q({ q: "Pikachu" }))).data[0]).toMatchObject({ points: 4, banned: false });
    });

    it("lists every bad line and changes nothing", async () => {
        const { ctx, league } = await newLeague();
        await expect(importPoolCsv(ctx, league.id, "445,3\nNotAPokemon,5\n25,99\n")).rejects.toMatchObject({
            status: 422,
            code: "POOL_IMPORT_INVALID",
            details: [
                { path: "line 2", message: 'Unknown Pokémon "NotAPokemon"' },
                { path: "line 3", message: "Points must be 1–20, got 99" },
            ],
        });
        expect((await listPool(ctx, league.id, q({ q: "Garchomp" }))).data[0]!.points).toBe(20);
        await expectError(importPoolCsv(ctx, league.id, "dex,points\n# nothing\n"), 422, "POOL_IMPORT_INVALID");
    });
});

describe("poolSummary", () => {
    it("counts Pokémon per cost and the banned ones", async () => {
        const { ctx, league } = await newLeague();
        const s = await poolSummary(ctx, league.id);
        expect(s.banned).toBe(94);
        expect(s.tiers.reduce((sum, t) => sum + t.n, 0)).toBe(1025 - 94);
        expect(s.tiers[0]!.points).toBe(20);
    });
});
