import { api, paged, readQuery } from "@/lib/http/handler";
import { listPokemon } from "@/lib/services/pokemon";
import { PokemonQuerySchema } from "@/lib/validators/schemas";

/** GET /api/pokemon?q=&type=&generation=&page=&pageSize= (public: it's PokéAPI's data). */
export const GET = api(async ({ req, ctx }) => paged(await listPokemon(ctx.db, readQuery(req, PokemonQuerySchema))), { public: true });
