import { and, asc, eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { expect } from "vitest";
import { getDb, type Db } from "@/lib/db/client";
import { runMigrations } from "@/lib/db/migrate";
import { leaguePool, users, type LeagueSettings } from "@/lib/db/schema";
import { makeCtx, type Actor, type Ctx } from "@/lib/services/context";
import { makePick, startDraft } from "@/lib/services/draft";
import { applyToLeague, approveEntry } from "@/lib/services/entries";
import { createLeague, openRegistration, type LeagueDto } from "@/lib/services/leagues";
import { ledgerTotal } from "@/lib/services/ledger";
import { seedPokemon } from "@/lib/services/pokemon";
import { findActor, signUp } from "@/lib/services/users";

export const TEST_PASSWORD = "Passw0rd!";

/** This test file's database (test/setup.ts gave it its own file), migrated and loaded with the species. */
export async function setupDb(): Promise<Db> {
    const db = getDb();
    await runMigrations(db);
    await seedPokemon(db);
    return db;
}

let counter = 0;

export async function makeUser(db: Db, opts: { role?: "admin" | "user"; name?: string } = {}): Promise<Actor> {
    counter++;
    const email = `user${counter}-${randomUUID().slice(0, 8)}@test.dev`;
    const u = await signUp(makeCtx(db, null), { email, password: TEST_PASSWORD, displayName: opts.name ?? `User ${counter}` });
    if (opts.role === "admin") await db.transaction((tx) => tx.update(users).set({ role: "admin" }).where(eq(users.id, u.id)));
    return (await findActor(db, u.id))!;
}

export const ctxOf = (db: Db, actor: Actor | null, now?: Date): Ctx => makeCtx(db, actor, now);

/** Asserts a promise fails with an AppError of this status and code. */
export async function expectError(promise: Promise<unknown>, status: number, code: string) {
    await expect(promise).rejects.toMatchObject({ status, code });
}

export async function expectLedgerBalanced(db: Db) {
    expect(await ledgerTotal(db)).toBe(0);
}

export type Coach = { actor: Actor; entryId: string };

/**
 * A league in registration with `coaches` approved coaches (entry order = creation order).
 * With `draft: true` the draft is started in that order.
 */
export async function leagueWithCoaches(
    db: Db,
    opts: { coaches: number; settings?: Partial<LeagueSettings>; draft?: boolean; now?: Date } = { coaches: 2 },
): Promise<{ commissioner: Actor; league: LeagueDto; coaches: Coach[] }> {
    const commissioner = await makeUser(db, { name: "Commissioner" });
    const cctx = ctxOf(db, commissioner, opts.now);
    const league = await createLeague(cctx, { name: `League ${randomUUID().slice(0, 6)}`, format: "singles", settings: opts.settings ?? {} });
    await openRegistration(cctx, league.id);
    const coaches: Coach[] = [];
    for (let i = 0; i < opts.coaches; i++) {
        const actor = await makeUser(db, { name: `Coach ${i + 1}` });
        const e = await applyToLeague(ctxOf(db, actor, opts.now), league.id, { teamName: `Team ${i + 1} ${randomUUID().slice(0, 4)}` });
        await approveEntry(cctx, league.id, e.id);
        coaches.push({ actor, entryId: e.id });
    }
    if (opts.draft) await startDraft(cctx, league.id, { order: coaches.map((c) => c.entryId) });
    return { commissioner, league, coaches };
}

/**
 * A league in its season: `coaches` coaches, 3-Pokémon rosters, drafted by the commissioner with
 * 1-point Pokémon in dex order (so budgets never get in the way). The schedule exists.
 */
export async function seasonLeague(db: Db, opts: { coaches: number; entryFee?: number; prizeSplit?: number[] }) {
    const setup = await leagueWithCoaches(db, {
        coaches: opts.coaches,
        settings: { rosterSize: 3, entryFee: opts.entryFee ?? 100, ...(opts.prizeSplit ? { prizeSplit: opts.prizeSplit } : {}) },
        draft: true,
    });
    const cheap = await db
        .select({ id: leaguePool.pokemonId })
        .from(leaguePool)
        .where(and(eq(leaguePool.leagueId, setup.league.id), eq(leaguePool.points, 1), eq(leaguePool.banned, false)))
        .orderBy(asc(leaguePool.pokemonId))
        .limit(opts.coaches * 3);
    const cctx = ctxOf(db, setup.commissioner);
    for (const { id } of cheap) await makePick(cctx, setup.league.id, { pokemonId: id });
    return { ...setup, drafted: cheap.map((c) => c.id) };
}
