import { api, ok } from "@/lib/http/handler";
import { getMatch } from "@/lib/services/season";

/** GET /api/leagues/:id/matches/:matchId */
export const GET = api<{ id: string; matchId: string }>(async ({ params, ctx }) => ok(await getMatch(ctx, params.id, params.matchId)));
