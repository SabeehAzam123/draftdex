import { and, desc, eq, isNull, lte } from "drizzle-orm";
import type { Db } from "@/lib/db/client";
import { draftSlots, entries, leaguePool, leagues, ledger, matches, notifications, picks, pokemon, trades, users } from "@/lib/db/schema";
import { makeCtx, type Actor } from "./context";
import { getDraftState, makePick, startDraft } from "./draft";
import { applyToLeague, approveEntry } from "./entries";
import { createLeague, openRegistration } from "./leagues";
import { seedPokemon } from "./pokemon";
import { completeSeason, confirmResult, getSchedule, reportResult, resolveResult } from "./season";
import { getTeam } from "./teams";
import { proposeTrade } from "./trades";
import { findActor, signUp } from "./users";

/** Local demo accounts only (printed by the seed and listed in the README). */
export const DEMO_ADMIN = { email: "admin@draftdex.test", password: "Admin123!", displayName: "League Admin" };
export const DEMO_COACH_PASSWORD = "Coach123!";
export const DEMO_COACHES = [
    { email: "coach1@draftdex.test", displayName: "Maya Torres", team: "Lakeside Lanterns" },
    { email: "coach2@draftdex.test", displayName: "Ben Okafor", team: "Copper Comets" },
    { email: "coach3@draftdex.test", displayName: "Lena Fischer", team: "Night Owls" },
    { email: "coach4@draftdex.test", displayName: "Omar Haddad", team: "Harbor Hawks" },
    { email: "coach5@draftdex.test", displayName: "Priya Nair", team: "Glacier Kings" },
    { email: "coach6@draftdex.test", displayName: "Sam Carter", team: "Static Foxes" },
    { email: "coach7@draftdex.test", displayName: "Yuki Tanaka", team: "Ember Bay" },
    { email: "coach8@draftdex.test", displayName: "Noah Brooks", team: "Mossback Rangers" },
] as const;

/** Deletes every row except the Pokémon species. */
export async function clearData(db: Db): Promise<void> {
    // Children before parents: the foreign keys are enforced
    await db.transaction(async (tx) => {
        for (const table of [notifications, trades, matches, picks, draftSlots, ledger, entries, leaguePool, leagues, users]) await tx.delete(table);
    });
}

export async function isEmpty(db: Db): Promise<boolean> {
    return !(await db.select({ id: users.id }).from(users).limit(1).get());
}

/** The pick a sensible coach makes: the priciest Pokémon they can afford, strongest first. */
async function autoChoose(db: Db, leagueId: string, cap: number): Promise<number> {
    const row = await db
        .select({ id: pokemon.id })
        .from(leaguePool)
        .innerJoin(pokemon, eq(pokemon.id, leaguePool.pokemonId))
        .leftJoin(picks, and(eq(picks.leagueId, leaguePool.leagueId), eq(picks.pokemonId, leaguePool.pokemonId)))
        .where(and(eq(leaguePool.leagueId, leagueId), eq(leaguePool.banned, false), isNull(picks.id), lte(leaguePool.points, cap)))
        .orderBy(desc(leaguePool.points), desc(pokemon.bst))
        .limit(1)
        .get();
    if (!row) throw new Error(`no affordable Pokémon left in ${leagueId}`);
    return row.id;
}

/** Makes `count` picks, each by the coach whose turn it is. */
export async function draftPicks(db: Db, leagueId: string, actorsByEntry: Map<string, Actor>, count: number, now: Date) {
    for (let i = 0; i < count; i++) {
        const anyone = [...actorsByEntry.values()][0]!;
        const state = await getDraftState(makeCtx(db, anyone, now), leagueId);
        if (!state.current) return;
        const team = state.teams.find((t) => t.entryId === state.current!.entryId)!;
        const pokemonId = await autoChoose(db, leagueId, team.maxForNextPick);
        await makePick(makeCtx(db, actorsByEntry.get(team.entryId)!, now), leagueId, { pokemonId });
    }
}

export type SeedSummary = { admin: string; coaches: string[]; leagues: { name: string; status: string }[] };

export async function seedDemo(db: Db, now: Date = new Date()): Promise<SeedSummary> {
    await seedPokemon(db);
    const anon = makeCtx(db, null, now);

    const adminUser = await signUp(anon, DEMO_ADMIN);
    await db.transaction((tx) => tx.update(users).set({ role: "admin" }).where(eq(users.id, adminUser.id)));
    const coaches: Actor[] = [];
    for (const c of DEMO_COACHES) {
        const u = await signUp(anon, { email: c.email, password: DEMO_COACH_PASSWORD, displayName: c.displayName });
        coaches.push((await findActor(db, u.id))!);
    }
    const as = (i: number) => makeCtx(db, coaches[i]!, now);
    const team = (i: number) => ({ teamName: DEMO_COACHES[i]!.team });

    // 1. Being set up
    await createLeague(as(0), {
        name: "Weekend Cup",
        format: "singles",
        settings: { entryFee: 50, maxCoaches: 6, pickTimerSeconds: 90 },
    });

    // 2. Registration open: three approved, one waiting
    const sunday = await createLeague(as(1), { name: "Sunday Singles S1", format: "singles", settings: { entryFee: 100 } });
    await openRegistration(as(1), sunday.id);
    for (const i of [0, 2, 3]) {
        const e = await applyToLeague(as(i), sunday.id, team(i));
        await approveEntry(as(1), sunday.id, e.id);
    }
    await applyToLeague(as(4), sunday.id, team(4));

    // 3. Mid-draft: six coaches, round 3 under way
    const office = await createLeague(as(2), {
        name: "Office League S3",
        format: "singles",
        settings: { budget: 80, rosterSize: 8, maxCoaches: 6, entryFee: 0 },
    });
    await openRegistration(as(2), office.id);
    const officeActors = new Map<string, Actor>();
    for (const i of [0, 1, 2, 3, 4, 5]) {
        const e = await applyToLeague(as(i), office.id, team(i));
        await approveEntry(as(2), office.id, e.id);
        officeActors.set(e.id, coaches[i]!);
    }
    await startDraft(as(2), office.id, { order: [...officeActors.keys()] });
    await draftPicks(db, office.id, officeActors, 14, now);

    // 4. In its season: a confirmed result, one waiting for confirmation, and a trade offer
    const friends = await createLeague(as(3), {
        name: "Friends Doubles S2",
        format: "doubles",
        settings: { budget: 60, rosterSize: 6, maxCoaches: 4, entryFee: 200, prizeSplit: [70, 30] },
    });
    await openRegistration(as(3), friends.id);
    const friendsActors = new Map<string, Actor>();
    for (const i of [3, 4, 5, 6]) {
        const e = await applyToLeague(as(i), friends.id, team(i));
        await approveEntry(as(3), friends.id, e.id);
        friendsActors.set(e.id, coaches[i]!);
    }
    await startDraft(as(3), friends.id, {});
    await draftPicks(db, friends.id, friendsActors, 4 * 6, now);
    const ctxOfEntry = (entryId: string) => makeCtx(db, friendsActors.get(entryId)!, now);
    const week1 = (await getSchedule(as(3), friends.id)).weeks[0]!.matches;
    const [first, second] = week1;
    if (first) {
        await reportResult(ctxOfEntry(first.home.entryId), friends.id, first.id, {
            homeWins: 2,
            awayWins: 1,
            replayUrl: "https://replay.pokemonshowdown.com/gen9doublesou-2100000001",
        });
        await confirmResult(ctxOfEntry(first.away.entryId), friends.id, first.id);
    }
    if (second) await reportResult(ctxOfEntry(second.away.entryId), friends.id, second.id, { homeWins: 0, awayWins: 2 });
    // A 1-for-1 offer between two teams' cheapest Pokémon (skipped if the budgets wouldn't allow it)
    const [a, b] = [...friendsActors.keys()];
    const cheapest = async (entryId: string) => (await getTeam(ctxOfEntry(entryId), friends.id, entryId)).roster.sort((x, y) => x.points - y.points)[0]!;
    const [give, get] = [await cheapest(a!), await cheapest(b!)];
    await proposeTrade(ctxOfEntry(a!), friends.id, { toEntryId: b!, give: [give.pokemon.id], get: [get.pokemon.id], note: "Fair swap?" }).catch(() => undefined);

    // 5. Completed: every match decided and the prize pool paid out
    const pilot = await createLeague(as(7), {
        name: "Pilot League S0",
        format: "singles",
        settings: { budget: 60, rosterSize: 3, maxCoaches: 4, entryFee: 50, prizeSplit: [60, 30, 10] },
    });
    await openRegistration(as(7), pilot.id);
    const pilotActors = new Map<string, Actor>();
    for (const i of [4, 5, 6, 7]) {
        const e = await applyToLeague(as(i), pilot.id, team(i));
        await approveEntry(as(7), pilot.id, e.id);
        pilotActors.set(e.id, coaches[i]!);
    }
    await startDraft(as(7), pilot.id, { order: [...pilotActors.keys()] });
    await draftPicks(db, pilot.id, pilotActors, 4 * 3, now);
    for (const week of (await getSchedule(as(7), pilot.id)).weeks) {
        for (const m of week.matches) {
            await resolveResult(as(7), pilot.id, m.id, week.week % 2 ? { homeWins: 2, awayWins: 1 } : { homeWins: 0, awayWins: 2 });
        }
    }
    await completeSeason(as(7), pilot.id);

    const all = await db.select({ name: leagues.name, status: leagues.status }).from(leagues);
    return { admin: DEMO_ADMIN.email, coaches: DEMO_COACHES.map((c) => c.email), leagues: all };
}
