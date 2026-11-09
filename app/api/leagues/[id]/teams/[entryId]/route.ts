import { api, ok } from "@/lib/http/handler";
import { getTeam } from "@/lib/services/teams";

/** GET /api/leagues/:id/teams/:entryId: roster and budget. */
export const GET = api<{ id: string; entryId: string }>(async ({ params, ctx }) => ok(await getTeam(ctx, params.id, params.entryId)));
