import { api, ok, readIntParam } from "@/lib/http/handler";
import { getPokemon } from "@/lib/services/pokemon";

/** GET /api/pokemon/:id (national dex number). */
export const GET = api<{ id: string }>(async ({ params, ctx }) => ok(await getPokemon(ctx.db, readIntParam(params.id, "The Pokémon id"))), {
    public: true,
});
