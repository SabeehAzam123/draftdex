import { and, asc, count, eq, like, or, sql, type SQL } from "drizzle-orm";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { z } from "zod";
import type { Db, DbOrTx } from "@/lib/db/client";
import { pokemon, type PokemonStats } from "@/lib/db/schema";
import { notFound } from "@/lib/errors/app-error";
import { ErrorCodes } from "@/lib/errors/codes";
import type { PokemonQuerySchema } from "@/lib/validators/schemas";

export type PokemonDto = {
    id: number;
    slug: string;
    name: string;
    types: string[];
    stats: PokemonStats;
    bst: number;
    generation: number;
    isLegendary: boolean;
    isMythical: boolean;
    spriteUrl: string;
};

/** Official artwork is heavier; the classic sprites load fast in long lists. Hot-linked from PokéAPI's sprite repo. */
export const spriteUrl = (id: number) => `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/${id}.png`;

export type PokemonRow = typeof pokemon.$inferSelect;
export const toPokemonDto = (p: PokemonRow): PokemonDto => ({ ...p, spriteUrl: spriteUrl(p.id) });

/** Filters shared by the Pokémon list and a league's pool. */
export function pokemonFilters(f: { q?: string; type?: string; generation?: number }): SQL[] {
    const out: SQL[] = [];
    if (f.q) {
        const byName = like(pokemon.name, `%${f.q}%`);
        out.push(/^\d+$/.test(f.q) ? or(byName, eq(pokemon.id, Number(f.q)))! : byName);
    }
    // types is a JSON array: match the quoted type name
    if (f.type) out.push(like(pokemon.types, `%"${f.type}"%`));
    if (f.generation) out.push(eq(pokemon.generation, f.generation));
    return out;
}

export async function listPokemon(db: DbOrTx, q: z.infer<typeof PokemonQuerySchema>) {
    const where = and(...pokemonFilters(q));
    const [{ total } = { total: 0 }] = await db.select({ total: count() }).from(pokemon).where(where);
    const rows = await db
        .select()
        .from(pokemon)
        .where(where)
        .orderBy(asc(pokemon.id))
        .limit(q.pageSize)
        .offset((q.page - 1) * q.pageSize);
    return { data: rows.map(toPokemonDto), page: q.page, pageSize: q.pageSize, total };
}

export async function getPokemon(db: DbOrTx, id: number): Promise<PokemonDto> {
    const row = await db.select().from(pokemon).where(eq(pokemon.id, id)).get();
    if (!row) throw notFound(ErrorCodes.POKEMON_NOT_FOUND, `No Pokémon #${id}`);
    return toPokemonDto(row);
}

/** data/pokemon.json, written by `npm run pokemon:fetch`. */
export function loadPokemonData(): PokemonRow[] {
    const file = resolve(process.cwd(), "data", "pokemon.json");
    return JSON.parse(readFileSync(file, "utf8")) as PokemonRow[];
}

/** Loads the species into an empty table. Returns how many were inserted (0 if already there). */
export async function seedPokemon(db: Db): Promise<number> {
    const [existing] = await db.select({ n: sql<number>`count(*)` }).from(pokemon);
    if (Number(existing?.n ?? 0) > 0) return 0;
    const rows = loadPokemonData();
    await db.transaction(async (tx) => {
        for (let i = 0; i < rows.length; i += 200) await tx.insert(pokemon).values(rows.slice(i, i + 200));
    });
    return rows.length;
}
