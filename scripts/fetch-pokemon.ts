/**
 * Refreshes data/pokemon.json from PokéAPI (https://pokeapi.co) in one GraphQL query.
 *
 *   npm run pokemon:fetch
 *
 * The JSON is committed, so the app never needs the network at runtime. Run this only to pick up new species.
 * Default forms only (one entry per species). Plain, erasable TypeScript: Node 22.18+ runs it directly too.
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ENDPOINT = "https://graphql.pokeapi.co/v1beta2";
const OUT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "data", "pokemon.json");

const QUERY = `query {
  pokemonspecies(order_by: {id: asc}) {
    id name is_legendary is_mythical generation_id
    pokemonspeciesnames(where: {language_id: {_eq: 9}}) { name }
    pokemons(where: {is_default: {_eq: true}}) {
      pokemontypes(order_by: {slot: asc}) { type { name } }
      pokemonstats { base_stat stat { name } }
    }
  }
}`;

type ApiSpecies = {
    id: number;
    name: string;
    is_legendary: boolean;
    is_mythical: boolean;
    generation_id: number;
    pokemonspeciesnames: { name: string }[];
    pokemons: {
        pokemontypes: { type: { name: string } }[];
        pokemonstats: { base_stat: number; stat: { name: string } }[];
    }[];
};

const STAT_KEYS: Record<string, string> = {
    hp: "hp",
    attack: "atk",
    defense: "def",
    "special-attack": "spa",
    "special-defense": "spd",
    speed: "spe",
};

async function main() {
    const res = await fetch(ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: QUERY }),
    });
    if (!res.ok) throw new Error(`PokéAPI answered ${res.status} ${res.statusText}`);
    const body = (await res.json()) as { data?: { pokemonspecies: ApiSpecies[] }; errors?: unknown };
    if (!body.data) throw new Error(`PokéAPI returned no data: ${JSON.stringify(body.errors)}`);

    const records = body.data.pokemonspecies.map((s) => {
        const form = s.pokemons[0];
        if (!form) throw new Error(`species ${s.id} (${s.name}) has no default form`);
        const stats: Record<string, number> = {};
        for (const st of form.pokemonstats) {
            const key = STAT_KEYS[st.stat.name];
            if (key) stats[key] = st.base_stat;
        }
        const bst = Object.values(stats).reduce((a, b) => a + b, 0);
        return {
            id: s.id,
            slug: s.name,
            name: s.pokemonspeciesnames[0]?.name ?? s.name,
            types: form.pokemontypes.map((t) => t.type.name),
            stats,
            bst,
            generation: s.generation_id,
            isLegendary: s.is_legendary,
            isMythical: s.is_mythical,
        };
    });

    mkdirSync(dirname(OUT), { recursive: true });
    // One species per line: small diffs when PokéAPI changes a value
    writeFileSync(OUT, "[\n" + records.map((r) => "  " + JSON.stringify(r)).join(",\n") + "\n]\n", "utf8");
    console.log(`Wrote ${records.length} species to ${OUT}`);
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
