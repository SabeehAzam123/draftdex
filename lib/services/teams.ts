import { and, asc, eq, sql } from "drizzle-orm";
import { draftSlots, picks, pokemon, users, type EntryStatus, type LeagueStatus } from "@/lib/db/schema";
import { toShowdownText } from "@/lib/domain/showdown";
import { requireActor, type Ctx } from "./context";
import { getEntryRow } from "./entries";
import { getLeagueRow } from "./leagues";
import { toPokemonDto, type PokemonDto } from "./pokemon";

export type TeamDto = {
    entryId: string;
    teamName: string;
    status: EntryStatus;
    coach: { id: string; displayName: string };
    league: { id: string; name: string; status: LeagueStatus; budget: number; rosterSize: number };
    /** What the team owns now, in draft order. `viaTrade`: drafted by another team and traded here. */
    roster: { pokemon: PokemonDto; points: number; slotNo: number; round: number; autoPicked: boolean; viaTrade: boolean }[];
    spent: number;
    budgetLeft: number;
};

export async function getTeam(ctx: Ctx, leagueId: string, entryId: string): Promise<TeamDto> {
    requireActor(ctx);
    const league = await getLeagueRow(ctx.db, leagueId);
    const entry = await getEntryRow(ctx.db, leagueId, entryId);
    const coach = await ctx.db.select({ id: users.id, displayName: users.displayName }).from(users).where(eq(users.id, entry.userId)).get();
    const rows = await ctx.db
        .select({ pick: picks, p: pokemon, round: draftSlots.round })
        .from(picks)
        .innerJoin(pokemon, eq(pokemon.id, picks.pokemonId))
        .innerJoin(draftSlots, and(eq(draftSlots.leagueId, picks.leagueId), eq(draftSlots.slotNo, picks.slotNo)))
        // Owned now: traded here, or drafted here and not traded away
        .where(and(eq(picks.leagueId, leagueId), sql`coalesce(${picks.ownerEntryId}, ${picks.entryId}) = ${entryId}`))
        .orderBy(asc(picks.slotNo));
    const spent = rows.reduce((s, r) => s + r.pick.points, 0);
    return {
        entryId: entry.id,
        teamName: entry.teamName,
        status: entry.status,
        coach: coach ?? { id: entry.userId, displayName: "(deleted)" },
        league: { id: league.id, name: league.name, status: league.status, budget: league.settings.budget, rosterSize: league.settings.rosterSize },
        roster: rows.map((r) => ({
            pokemon: toPokemonDto(r.p),
            points: r.pick.points,
            slotNo: r.pick.slotNo,
            round: r.round,
            autoPicked: r.pick.pickedBy === "timer",
            viaTrade: r.pick.entryId !== entryId,
        })),
        spent,
        budgetLeft: league.settings.budget - spent,
    };
}

/** The roster as Pokémon Showdown import text. */
export async function getShowdownExport(ctx: Ctx, leagueId: string, entryId: string): Promise<string> {
    const team = await getTeam(ctx, leagueId, entryId);
    return toShowdownText(team.roster.map((r) => r.pokemon.name));
}
