import { and, asc, count, desc, eq, gte, isNotNull, isNull, lte, type SQL } from "drizzle-orm";
import type { z } from "zod";
import { entries, leaguePool, picks, pokemon } from "@/lib/db/schema";
import { parsePoolCsv } from "@/lib/domain/pool-csv";
import { invalid } from "@/lib/errors/app-error";
import { ErrorCodes } from "@/lib/errors/codes";
import type { PoolQuerySchema, PoolUpdateSchema } from "@/lib/validators/schemas";
import { requireActor, type Ctx } from "./context";
import { getLeagueRow, requireManager, requireStatus } from "./leagues";
import { pokemonFilters, toPokemonDto, type PokemonDto } from "./pokemon";

export type PoolRowDto = {
    pokemon: PokemonDto;
    points: number;
    banned: boolean;
    takenBy: { entryId: string; teamName: string } | null;
};

const SORTS = {
    points: [desc(leaguePool.points), asc(pokemon.id)],
    dex: [asc(pokemon.id)],
    name: [asc(pokemon.name)],
    bst: [desc(pokemon.bst), asc(pokemon.id)],
} as const;

export async function listPool(ctx: Ctx, leagueId: string, q: z.infer<typeof PoolQuerySchema>) {
    requireActor(ctx);
    await getLeagueRow(ctx.db, leagueId);
    const filters: SQL[] = [eq(leaguePool.leagueId, leagueId), ...pokemonFilters(q)];
    if (q.status === "banned") filters.push(eq(leaguePool.banned, true));
    if (q.status === "available") filters.push(eq(leaguePool.banned, false), isNull(picks.id));
    if (q.status === "taken") filters.push(isNotNull(picks.id));
    if (q.minPoints !== undefined) filters.push(gte(leaguePool.points, q.minPoints));
    if (q.maxPoints !== undefined) filters.push(lte(leaguePool.points, q.maxPoints));
    const where = and(...filters);

    const base = () =>
        ctx.db
            .select({ p: pokemon, points: leaguePool.points, banned: leaguePool.banned, entryId: picks.entryId, teamName: entries.teamName })
            .from(leaguePool)
            .innerJoin(pokemon, eq(pokemon.id, leaguePool.pokemonId))
            .leftJoin(picks, and(eq(picks.leagueId, leaguePool.leagueId), eq(picks.pokemonId, leaguePool.pokemonId)))
            .leftJoin(entries, eq(entries.id, picks.entryId));

    const [{ total } = { total: 0 }] = await ctx.db
        .select({ total: count() })
        .from(leaguePool)
        .innerJoin(pokemon, eq(pokemon.id, leaguePool.pokemonId))
        .leftJoin(picks, and(eq(picks.leagueId, leaguePool.leagueId), eq(picks.pokemonId, leaguePool.pokemonId)))
        .where(where);
    const rows = await base()
        .where(where)
        .orderBy(...SORTS[q.sort])
        .limit(q.pageSize)
        .offset((q.page - 1) * q.pageSize);

    const data: PoolRowDto[] = rows.map((r) => ({
        pokemon: toPokemonDto(r.p),
        points: r.points,
        banned: r.banned,
        takenBy: r.entryId ? { entryId: r.entryId, teamName: r.teamName ?? "" } : null,
    }));
    return { data, page: q.page, pageSize: q.pageSize, total };
}

/** How many Pokémon sit at each cost, and how many are banned (the tier list's shape). */
export async function poolSummary(ctx: Ctx, leagueId: string) {
    requireActor(ctx);
    await getLeagueRow(ctx.db, leagueId);
    const tiers = await ctx.db
        .select({ points: leaguePool.points, n: count() })
        .from(leaguePool)
        .where(and(eq(leaguePool.leagueId, leagueId), eq(leaguePool.banned, false)))
        .groupBy(leaguePool.points)
        .orderBy(desc(leaguePool.points));
    const [banned] = await ctx.db
        .select({ n: count() })
        .from(leaguePool)
        .where(and(eq(leaguePool.leagueId, leagueId), eq(leaguePool.banned, true)));
    return { tiers, banned: banned?.n ?? 0 };
}

async function applyChanges(
    ctx: Ctx,
    leagueId: string,
    changes: { pokemonId: number; points?: number; banned?: boolean }[],
): Promise<number> {
    return ctx.db.transaction(async (tx) => {
        const league = await getLeagueRow(tx, leagueId);
        requireManager(ctx, league);
        requireStatus(league, ["setup", "registration"], "change the tier list");
        let updated = 0;
        const missing: number[] = [];
        for (const c of changes) {
            const set: { points?: number; banned?: boolean } = {};
            if (c.points !== undefined) set.points = c.points;
            if (c.banned !== undefined) set.banned = c.banned;
            const res = await tx
                .update(leaguePool)
                .set(set)
                .where(and(eq(leaguePool.leagueId, leagueId), eq(leaguePool.pokemonId, c.pokemonId)));
            if (res.rowsAffected === 0) missing.push(c.pokemonId);
            updated += res.rowsAffected;
        }
        // Throwing inside the transaction rolls back every change in this request
        if (missing.length > 0) {
            throw invalid(
                ErrorCodes.VALIDATION_ERROR,
                "Some Pokémon aren't in this league's pool; nothing was changed",
                missing.map((id) => ({ path: "changes.pokemonId", message: `No Pokémon #${id}` })),
            );
        }
        return updated;
    });
}

export async function updatePool(ctx: Ctx, leagueId: string, input: z.infer<typeof PoolUpdateSchema>) {
    return { updated: await applyChanges(ctx, leagueId, input.changes) };
}

/** Imports `<dex or name>,<points|banned>` lines. Nothing changes unless every line is valid. */
export async function importPoolCsv(ctx: Ctx, leagueId: string, csv: string) {
    const { rows, errors } = parsePoolCsv(csv);
    const all = await ctx.db.select({ id: pokemon.id, name: pokemon.name, slug: pokemon.slug }).from(pokemon);
    const byKey = new Map<string, number>();
    for (const p of all) {
        byKey.set(String(p.id), p.id);
        byKey.set(p.name.toLowerCase(), p.id);
        byKey.set(p.slug, p.id);
    }
    const changes: { pokemonId: number; points?: number; banned?: boolean }[] = [];
    for (const r of rows) {
        const id = byKey.get(String(r.key).toLowerCase());
        if (!id) {
            errors.push({ line: r.line, message: `Unknown Pokémon "${r.key}"` });
            continue;
        }
        changes.push(r.banned ? { pokemonId: id, banned: true } : { pokemonId: id, points: r.points!, banned: false });
    }
    if (errors.length > 0) {
        errors.sort((a, b) => a.line - b.line);
        throw invalid(
            ErrorCodes.POOL_IMPORT_INVALID,
            `${errors.length} line(s) couldn't be read; nothing was changed`,
            errors.map((e) => ({ path: `line ${e.line}`, message: e.message })),
        );
    }
    if (changes.length === 0) throw invalid(ErrorCodes.POOL_IMPORT_INVALID, "The CSV has no Pokémon lines");
    return { updated: await applyChanges(ctx, leagueId, changes) };
}
