import { beforeAll, describe, expect, it } from "vitest";
import type { Db } from "@/lib/db/client";
import { ctxOf, expectError, leagueWithCoaches, makeUser, setupDb } from "@/test/helpers";
import { makePick } from "./draft";
import { getShowdownExport, getTeam } from "./teams";

let db: Db;
beforeAll(async () => {
    db = await setupDb();
});

describe("getTeam", () => {
    it("shows the roster in pick order with the budget used", async () => {
        const { league, coaches } = await leagueWithCoaches(db, { coaches: 2, draft: true });
        const [a, b] = coaches;
        await makePick(ctxOf(db, a!.actor), league.id, { pokemonId: 445 }); // Garchomp, 20
        await makePick(ctxOf(db, b!.actor), league.id, { pokemonId: 25 });
        await makePick(ctxOf(db, b!.actor), league.id, { pokemonId: 26 });
        await makePick(ctxOf(db, a!.actor), league.id, { pokemonId: 29 }); // Nidoran♀

        const team = await getTeam(ctxOf(db, b!.actor), league.id, a!.entryId);
        expect(team).toMatchObject({
            entryId: a!.entryId,
            status: "approved",
            coach: { id: a!.actor.id },
            league: { id: league.id, status: "drafting", budget: 100, rosterSize: 10 },
            spent: 20 + team.roster[1]!.points,
            budgetLeft: 100 - 20 - team.roster[1]!.points,
        });
        expect(team.roster.map((r) => [r.slotNo, r.round, r.pokemon.name])).toEqual([
            [1, 1, "Garchomp"],
            [4, 2, "Nidoran♀"],
        ]);
    });

    it("answers 404 for an entry that isn't in the league", async () => {
        const one = await leagueWithCoaches(db, { coaches: 1 });
        const two = await leagueWithCoaches(db, { coaches: 1 });
        await expectError(getTeam(ctxOf(db, one.coaches[0]!.actor), two.league.id, one.coaches[0]!.entryId), 404, "ENTRY_NOT_FOUND");
        await expectError(getTeam(ctxOf(db, null), one.league.id, one.coaches[0]!.entryId), 401, "AUTH_MISSING_TOKEN");
    });
});

describe("getShowdownExport", () => {
    it("writes the roster as Showdown import text, with Showdown's spellings", async () => {
        const { league, coaches } = await leagueWithCoaches(db, { coaches: 2, draft: true });
        await makePick(ctxOf(db, coaches[0]!.actor), league.id, { pokemonId: 445 });
        await makePick(ctxOf(db, coaches[1]!.actor), league.id, { pokemonId: 25 });
        await makePick(ctxOf(db, coaches[1]!.actor), league.id, { pokemonId: 26 });
        await makePick(ctxOf(db, coaches[0]!.actor), league.id, { pokemonId: 29 });
        const text = await getShowdownExport(ctxOf(db, await makeUser(db)), league.id, coaches[0]!.entryId);
        expect(text).toBe("Garchomp\n\nNidoran-F\n");
    });

    it("is empty before any pick", async () => {
        const { league, coaches } = await leagueWithCoaches(db, { coaches: 2 });
        expect(await getShowdownExport(ctxOf(db, coaches[0]!.actor), league.id, coaches[0]!.entryId)).toBe("");
    });
});
