import { beforeAll, describe, expect, it } from "vitest";
import * as reset from "@/app/api/admin/reset/route";
import * as signup from "@/app/api/auth/signup/route";
import * as leagueById from "@/app/api/leagues/[id]/route";
import * as draft from "@/app/api/leagues/[id]/draft/route";
import * as picks from "@/app/api/leagues/[id]/draft/picks/route";
import * as skip from "@/app/api/leagues/[id]/draft/skip/route";
import * as approve from "@/app/api/leagues/[id]/entries/[entryId]/approve/route";
import * as reject from "@/app/api/leagues/[id]/entries/[entryId]/reject/route";
import * as withdraw from "@/app/api/leagues/[id]/entries/[entryId]/withdraw/route";
import * as entries from "@/app/api/leagues/[id]/entries/route";
import * as notifications from "@/app/api/leagues/[id]/notifications/route";
import * as openReg from "@/app/api/leagues/[id]/open-registration/route";
import * as cancel from "@/app/api/leagues/[id]/cancel/route";
import * as poolImport from "@/app/api/leagues/[id]/pool/import/route";
import * as pool from "@/app/api/leagues/[id]/pool/route";
import * as poolSummary from "@/app/api/leagues/[id]/pool/summary/route";
import * as startDraft from "@/app/api/leagues/[id]/start-draft/route";
import * as showdown from "@/app/api/leagues/[id]/teams/[entryId]/showdown/route";
import * as team from "@/app/api/leagues/[id]/teams/[entryId]/route";
import * as webhookTest from "@/app/api/leagues/[id]/webhook/test/route";
import * as webhook from "@/app/api/leagues/[id]/webhook/route";
import * as leagues from "@/app/api/leagues/route";
import * as pokemonById from "@/app/api/pokemon/[id]/route";
import * as pokemon from "@/app/api/pokemon/route";
import * as userById from "@/app/api/users/[id]/route";
import * as users from "@/app/api/users/route";
import { setupDb, makeUser } from "@/test/helpers";
import { signToken } from "@/lib/auth/jwt";
import { getDb } from "@/lib/db/client";
import { call } from "@/test/http";

beforeAll(async () => {
    await setupDb();
});

let n = 0;
async function newToken(name: string) {
    n++;
    const res = await call(signup.POST, { method: "POST", body: { email: `flow${n}@test.dev`, password: "Passw0rd!", displayName: name } });
    return { token: res.json.data.token as string, id: res.json.data.user.id as string };
}

describe("a league from creation to a finished draft, over HTTP", () => {
    it("works end to end and enforces each role's rights", async () => {
        const commish = await newToken("Commish");
        const ash = await newToken("Coach A");
        const bea = await newToken("Coach B");
        const outsider = await newToken("Outsider");

        // Create (settings merged over defaults)
        const createdRes = await call(leagues.POST, {
            method: "POST",
            token: commish.token,
            body: { name: "HTTP League", format: "singles", settings: { rosterSize: 3, entryFee: 50 } },
        });
        expect(createdRes.status).toBe(201);
        const league = createdRes.json.data;
        expect(league).toMatchObject({ status: "setup", settings: { rosterSize: 3, entryFee: 50, budget: 100 } });
        const p = { id: league.id };

        // Coaches can't change it; the commissioner can
        expect((await call(leagueById.PATCH, { method: "PATCH", token: ash.token, params: p, body: { name: "Mine now" } })).status).toBe(403);
        expect((await call(leagueById.PATCH, { method: "PATCH", token: commish.token, params: p, body: { settings: { budget: 120 } } })).json.data.settings.budget).toBe(120);

        // Tier list: import, then view
        const imported = await call(poolImport.POST, { method: "POST", token: commish.token, params: p, body: { csv: "445,15\nMewtwo,banned" } });
        expect(imported).toMatchObject({ status: 200, json: { data: { updated: 2 } } });
        const garchomp = await call(pool.GET, { token: ash.token, params: p, path: "/api/leagues/x/pool?q=garchomp" });
        expect(garchomp.json).toMatchObject({ page: 1, pageSize: 50, total: 1, data: [{ points: 15, pokemon: { name: "Garchomp" } }] });
        expect((await call(poolSummary.GET, { token: ash.token, params: p })).json.data.banned).toBe(94);

        // Registration
        expect((await call(entries.POST, { method: "POST", token: ash.token, params: p, body: { teamName: "Too Early" } })).json.code).toBe("LEAGUE_INVALID_STATE");
        expect((await call(openReg.POST, { method: "POST", token: commish.token, params: p })).json.data.status).toBe("registration");
        const ea = (await call(entries.POST, { method: "POST", token: ash.token, params: p, body: { teamName: "Alpha" } })).json.data;
        const eb = (await call(entries.POST, { method: "POST", token: bea.token, params: p, body: { teamName: "Bravo" } })).json.data;
        const eo = (await call(entries.POST, { method: "POST", token: outsider.token, params: p, body: { teamName: "Leaving" } })).json.data;
        expect(ea).toMatchObject({ status: "pending", teamName: "Alpha" });
        expect((await call(withdraw.POST, { method: "POST", token: outsider.token, params: { ...p, entryId: eo.id } })).json.data.status).toBe("withdrawn");
        expect((await call(approve.POST, { method: "POST", token: ash.token, params: { ...p, entryId: ea.id } })).status).toBe(403);
        for (const e of [ea, eb]) {
            expect((await call(approve.POST, { method: "POST", token: commish.token, params: { ...p, entryId: e.id } })).json.data.status).toBe("approved");
        }
        expect((await call(reject.POST, { method: "POST", token: commish.token, params: { ...p, entryId: ea.id } })).json.code).toBe("ENTRY_INVALID_STATE");
        const list = await call(entries.GET, { token: bea.token, params: p });
        expect(list.json.data.map((e: { status: string }) => e.status)).toEqual(["approved", "approved", "withdrawn"]);
        expect((await call(leagueById.GET, { token: commish.token, params: p })).json.data.prizePool).toBe(100);

        // Draft
        const started = await call(startDraft.POST, { method: "POST", token: commish.token, params: p, body: { order: [ea.id, eb.id] } });
        expect(started.json.data).toMatchObject({ status: "drafting", current: { slotNo: 1, entryId: ea.id } });
        const outOfTurn = await call(picks.POST, { method: "POST", token: bea.token, params: p, body: { pokemonId: 25 } });
        expect(outOfTurn).toMatchObject({ status: 409, json: { code: "DRAFT_NOT_YOUR_TURN" } });
        const pick = await call(picks.POST, { method: "POST", token: ash.token, params: p, body: { pokemonId: 445 } });
        expect(pick.status).toBe(201);
        expect(pick.json.data.picks[0]).toMatchObject({ points: 15, pokemon: { name: "Garchomp" } });
        expect((await call(picks.POST, { method: "POST", token: bea.token, params: p, body: { pokemonId: "445" } })).status).toBe(422);
        expect((await call(skip.POST, { method: "POST", token: bea.token, params: p })).status).toBe(403);
        await call(picks.POST, { method: "POST", token: bea.token, params: p, body: { pokemonId: 25 } });
        await call(picks.POST, { method: "POST", token: bea.token, params: p, body: { pokemonId: 26 } });
        await call(picks.POST, { method: "POST", token: ash.token, params: p, body: { pokemonId: 29 } });
        await call(picks.POST, { method: "POST", token: ash.token, params: p, body: { pokemonId: 1 } });
        const last = await call(picks.POST, { method: "POST", token: bea.token, params: p, body: { pokemonId: 4 } });
        expect(last.json.data).toMatchObject({ status: "season", current: null });
        expect((await call(draft.GET, { token: outsider.token, params: p })).json.data.picks).toHaveLength(6);

        // Team and Showdown export
        const roster = await call(team.GET, { token: bea.token, params: { ...p, entryId: ea.id } });
        expect(roster.json.data.roster.map((r: { pokemon: { name: string } }) => r.pokemon.name)).toEqual(["Garchomp", "Nidoran♀", "Bulbasaur"]);
        const text = await call(showdown.GET, { token: bea.token, params: { ...p, entryId: ea.id } });
        expect(text.headers.get("content-type")).toMatch(/^text\/plain/);
        expect(text.text).toBe("Garchomp\n\nNidoran-F\n\nBulbasaur\n");

        // Tier list is locked now
        expect((await call(pool.PUT, { method: "PUT", token: commish.token, params: p, body: { changes: [{ pokemonId: 1, points: 2 }] } })).json.code).toBe(
            "LEAGUE_INVALID_STATE",
        );
    });
});

describe("webhook endpoints", () => {
    it("never return the full URL and are for the commissioner", async () => {
        const commish = await newToken("Hooker");
        const coach = await newToken("Watcher");
        const league = (await call(leagues.POST, { method: "POST", token: commish.token, body: { name: "Hook League" } })).json.data;
        const p = { id: league.id };
        const saved = await call(webhook.PUT, { method: "PUT", token: commish.token, params: p, body: { url: "https://discord.com/api/webhooks/9/top-secret" } });
        expect(saved.json.data.webhook).toEqual({ configured: true, masked: "https://discord.com/api/webhooks/****" });
        expect(saved.text).not.toContain("top-secret");
        expect((await call(leagueById.GET, { token: coach.token, params: p })).json.data.webhook).toBeNull();
        expect((await call(webhook.PUT, { method: "PUT", token: commish.token, params: p, body: { url: "http://10.0.0.1/x" } })).json.code).toBe(
            "WEBHOOK_URL_NOT_ALLOWED",
        );
        expect((await call(notifications.GET, { token: coach.token, params: p })).status).toBe(403);
        expect((await call(webhookTest.POST, { method: "POST", token: coach.token, params: p })).status).toBe(403);
        expect((await call(notifications.GET, { token: commish.token, params: p })).json.data).toEqual([]);
        expect((await call(cancel.POST, { method: "POST", token: commish.token, params: p })).json.data.status).toBe("cancelled");
    });
});

describe("Pokémon endpoints", () => {
    it("are public, paged and validated", async () => {
        const list = await call(pokemon.GET, { path: "/api/pokemon?type=dragon&pageSize=5" });
        expect(list.json).toMatchObject({ page: 1, pageSize: 5, data: expect.any(Array) });
        expect(list.json.total).toBeGreaterThan(5);
        expect(list.json.data[0].spriteUrl).toMatch(/^https:\/\/raw\.githubusercontent\.com\/PokeAPI\/sprites\//);
        expect((await call(pokemonById.GET, { params: { id: "25" } })).json.data.name).toBe("Pikachu");
        expect((await call(pokemonById.GET, { params: { id: "9999" } })).json.code).toBe("POKEMON_NOT_FOUND");
        expect((await call(pokemonById.GET, { params: { id: "abc" } })).status).toBe(422);
        expect((await call(pokemon.GET, { path: "/api/pokemon?pageSize=500" })).status).toBe(422);
    });
});

describe("admin endpoints", () => {
    it("are admin-only", async () => {
        const user = await newToken("Plain User");
        expect((await call(users.GET, { token: user.token })).status).toBe(403);
        expect((await call(reset.POST, { method: "POST", token: user.token })).status).toBe(403);
        expect((await call(userById.DELETE, { method: "DELETE", token: user.token, params: { id: user.id } })).status).toBe(403);
    });

    it("manage users and reset the demo data", async () => {
        const admin = await makeUser(getDb(), { role: "admin" });
        const token = await signToken(admin.id);
        const createdRes = await call(users.POST, {
            method: "POST",
            token,
            body: { email: "staff@test.dev", password: "Passw0rd!", displayName: "Staff", role: "user" },
        });
        expect(createdRes.status).toBe(201);
        const id = createdRes.json.data.id;
        expect((await call(users.GET, { token, path: "/api/users?q=staff@test" })).json.total).toBe(1);
        expect((await call(userById.PATCH, { method: "PATCH", token, params: { id }, body: { role: "admin" } })).json.data.role).toBe("admin");
        expect((await call(userById.DELETE, { method: "DELETE", token, params: { id } })).status).toBe(204);

        const res = await call(reset.POST, { method: "POST", token });
        expect(res.status).toBe(200);
        expect(res.json.data.leagues).toHaveLength(4);
        // the admin who reset was deleted with everything else, so their token no longer works
        expect((await call(users.GET, { token })).json.code).toBe("AUTH_INVALID_TOKEN");
    });
});
