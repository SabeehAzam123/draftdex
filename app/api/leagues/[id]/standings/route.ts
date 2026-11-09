import { api, ok } from "@/lib/http/handler";
import { getStandings } from "@/lib/services/season";

/** GET /api/leagues/:id/standings: the table, with projected prizes (or what was paid, once completed). */
export const GET = api<{ id: string }>(async ({ params, ctx }) => ok(await getStandings(ctx, params.id)));
