import { and, eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import type { Db } from "@/lib/db/client";
import { leaguePool } from "@/lib/db/schema";
import { ctxOf, expectError, expectLedgerBalanced, leagueWithCoaches, makeUser, setupDb } from "@/test/helpers";
import { applyToLeague } from "./entries";
import {
    cancelLeague,
    createLeague,
    DEFAULT_SETTINGS,
    getLeague,
    listLeagues,
    openRegistration,
    setWebhook,
    updateLeague,
} from "./leagues";
import { balanceOf, leagueAccount, userAccount } from "./ledger";

let db: Db;
beforeAll(async () => {
    db = await setupDb();
});

const GARCHOMP = 445; // base stat total 600
const MEWTWO = 150; // legendary
const MAGIKARP = 129; // base stat total 200

describe("createLeague", () => {
    it("starts in setup with default settings and the caller as commissioner", async () => {
        const me = await makeUser(db, { name: "Commish" });
        const league = await createLeague(ctxOf(db, me), { name: "Test League", format: "singles", settings: {} });
        expect(league).toMatchObject({
            name: "Test League",
            status: "setup",
            settings: DEFAULT_SETTINGS,
            commissioner: { id: me.id, displayName: "Commish" },
            counts: { approved: 0, pending: 0 },
            prizePool: 0,
            webhook: { configured: false, masked: null },
            me: { canManage: true, entry: null },
        });
    });

    it("builds the default tier list: a cost for every species, legendaries banned", async () => {
        const me = await makeUser(db);
        const league = await createLeague(ctxOf(db, me), { name: "Tiers", format: "singles", settings: {} });
        const rows = await db.select().from(leaguePool).where(eq(leaguePool.leagueId, league.id));
        expect(rows).toHaveLength(1025);
        const row = (id: number) => rows.find((r) => r.pokemonId === id)!;
        expect(row(GARCHOMP)).toMatchObject({ points: 20, banned: false });
        expect(row(MAGIKARP)).toMatchObject({ points: 1, banned: false });
        expect(row(MEWTWO)).toMatchObject({ banned: true });
    });

    it("merges given settings over the defaults and validates the result", async () => {
        const me = await makeUser(db);
        const league = await createLeague(ctxOf(db, me), { name: "Custom", format: "doubles", settings: { budget: 120, pickTimerSeconds: 60 } });
        expect(league.settings).toEqual({ ...DEFAULT_SETTINGS, budget: 120, pickTimerSeconds: 60 });
        await expect(
            createLeague(ctxOf(db, me), { name: "Bad", format: "singles", settings: { prizeSplit: [50, 30] } }),
        ).rejects.toMatchObject({ status: 422, code: "VALIDATION_ERROR", details: [{ path: "settings.prizeSplit", message: "The split must add up to 100" }] });
    });

    it("needs a signed-in user", async () => {
        await expectError(createLeague(ctxOf(db, null), { name: "Nope", format: "singles", settings: {} }), 401, "AUTH_MISSING_TOKEN");
    });
});

describe("updateLeague", () => {
    it("lets the commissioner and admins change it, nobody else", async () => {
        const { commissioner, league } = await leagueWithCoaches(db, { coaches: 0 });
        const admin = await makeUser(db, { role: "admin" });
        const other = await makeUser(db);
        expect(await updateLeague(ctxOf(db, commissioner), league.id, { name: "Renamed" })).toMatchObject({ name: "Renamed" });
        expect(await updateLeague(ctxOf(db, admin), league.id, { settings: { budget: 90 } })).toMatchObject({ settings: { budget: 90 } });
        await expectError(updateLeague(ctxOf(db, other), league.id, { name: "Hijack" }), 403, "RBAC_FORBIDDEN");
    });

    it("locks the entry fee once someone has paid it, and the coach limit below the applicants", async () => {
        const { commissioner, league } = await leagueWithCoaches(db, { coaches: 3 });
        const ctx = ctxOf(db, commissioner);
        await expectError(updateLeague(ctx, league.id, { settings: { entryFee: 10 } }), 409, "LEAGUE_SETTING_LOCKED");
        await expectError(updateLeague(ctx, league.id, { settings: { maxCoaches: 2 } }), 409, "LEAGUE_SETTING_LOCKED");
        expect(await updateLeague(ctx, league.id, { settings: { maxCoaches: 3, rosterSize: 6 } })).toMatchObject({
            settings: { maxCoaches: 3, rosterSize: 6 },
        });
    });

    it("can't change once the draft has started", async () => {
        const { commissioner, league } = await leagueWithCoaches(db, { coaches: 2, draft: true });
        await expectError(updateLeague(ctxOf(db, commissioner), league.id, { name: "Late" }), 409, "LEAGUE_INVALID_STATE");
    });

    it("answers 404 for an unknown league", async () => {
        const me = await makeUser(db);
        await expectError(updateLeague(ctxOf(db, me), "lg_missing", { name: "X" }), 404, "LEAGUE_NOT_FOUND");
        await expectError(getLeague(ctxOf(db, me), "lg_missing"), 404, "LEAGUE_NOT_FOUND");
    });
});

describe("status changes", () => {
    it("opens registration only from setup", async () => {
        const me = await makeUser(db);
        const league = await createLeague(ctxOf(db, me), { name: "Open me", format: "singles", settings: {} });
        expect(await openRegistration(ctxOf(db, me), league.id)).toMatchObject({ status: "registration" });
        await expect(openRegistration(ctxOf(db, me), league.id)).rejects.toMatchObject({
            status: 409,
            code: "LEAGUE_INVALID_STATE",
            message: "You can't open registration while the league is open for registration",
        });
    });

    it("cancels with a refund for every coach who paid, leaving the ledger balanced", async () => {
        const { commissioner, league, coaches } = await leagueWithCoaches(db, { coaches: 2, settings: { entryFee: 75 } });
        const pending = await makeUser(db);
        await applyToLeague(ctxOf(db, pending), league.id, { teamName: "Pending Team" });
        expect(await balanceOf(db, leagueAccount(league.id))).toBe(225);

        const cancelled = await cancelLeague(ctxOf(db, commissioner), league.id);
        expect(cancelled).toMatchObject({ status: "cancelled", prizePool: 0, counts: { approved: 0, pending: 0 } });
        for (const id of [coaches[0]!.actor.id, coaches[1]!.actor.id, pending.id]) {
            expect(await balanceOf(db, userAccount(id))).toBe(1000);
        }
        await expectLedgerBalanced(db);
        await expectError(cancelLeague(ctxOf(db, commissioner), league.id), 409, "LEAGUE_INVALID_STATE");
    });
});

describe("league view", () => {
    it("shows the viewer's own entry and the prize pool", async () => {
        const { league, coaches } = await leagueWithCoaches(db, { coaches: 2, settings: { entryFee: 40 } });
        const view = await getLeague(ctxOf(db, coaches[0]!.actor), league.id);
        expect(view).toMatchObject({
            prizePool: 80,
            counts: { approved: 2, pending: 0 },
            webhook: null, // coaches don't see the webhook
            me: { canManage: false, entry: { id: coaches[0]!.entryId, status: "approved" } },
        });
    });

    it("lists leagues by status and the viewer's own", async () => {
        const { league, coaches } = await leagueWithCoaches(db, { coaches: 1 });
        const mine = await listLeagues(ctxOf(db, coaches[0]!.actor), { page: 1, pageSize: 50, mine: true });
        expect(mine.data.map((l) => l.id)).toEqual([league.id]);
        const open = await listLeagues(ctxOf(db, coaches[0]!.actor), { page: 1, pageSize: 50, status: "registration" });
        expect(open.data.every((l) => l.status === "registration")).toBe(true);
        expect(open.data.some((l) => l.id === league.id)).toBe(true);
        const paged = await listLeagues(ctxOf(db, coaches[0]!.actor), { page: 1, pageSize: 1 });
        expect(paged.data).toHaveLength(1);
        expect(paged.total).toBeGreaterThan(1);
    });
});

describe("setWebhook", () => {
    it("stores an allowed URL and only ever shows it masked", async () => {
        const me = await makeUser(db);
        const league = await createLeague(ctxOf(db, me), { name: "Hooked", format: "singles", settings: {} });
        const saved = await setWebhook(ctxOf(db, me), league.id, "https://discord.com/api/webhooks/42/very-secret");
        expect(saved.webhook).toEqual({ configured: true, masked: "https://discord.com/api/webhooks/****" });
        expect(JSON.stringify(saved)).not.toContain("very-secret");
        expect(await setWebhook(ctxOf(db, me), league.id, null)).toMatchObject({ webhook: { configured: false, masked: null } });
    });

    it("refuses hosts that aren't allowed, and non-commissioners", async () => {
        const me = await makeUser(db);
        const other = await makeUser(db);
        const league = await createLeague(ctxOf(db, me), { name: "Guarded", format: "singles", settings: {} });
        await expectError(setWebhook(ctxOf(db, me), league.id, "https://169.254.169.254/latest"), 422, "WEBHOOK_URL_NOT_ALLOWED");
        await expectError(setWebhook(ctxOf(db, other), league.id, "https://discord.com/api/webhooks/1/x"), 403, "RBAC_FORBIDDEN");
    });
});

describe("tier lists are per league", () => {
    it("a change in one league's tier list leaves another league's alone", async () => {
        const me = await makeUser(db);
        const a = await createLeague(ctxOf(db, me), { name: "A", format: "singles", settings: {} });
        const b = await createLeague(ctxOf(db, me), { name: "B", format: "singles", settings: {} });
        await db.update(leaguePool).set({ points: 7 }).where(and(eq(leaguePool.leagueId, a.id), eq(leaguePool.pokemonId, GARCHOMP)));
        const inB = await db.select().from(leaguePool).where(and(eq(leaguePool.leagueId, b.id), eq(leaguePool.pokemonId, GARCHOMP))).get();
        expect(inB?.points).toBe(20);
    });
});
