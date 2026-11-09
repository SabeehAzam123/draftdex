import { api, ok } from "@/lib/http/handler";
import { poolSummary } from "@/lib/services/pool";

/** GET /api/leagues/:id/pool/summary: how many Pokémon at each cost, and how many banned. */
export const GET = api<{ id: string }>(async ({ params, ctx }) => ok(await poolSummary(ctx, params.id)));
