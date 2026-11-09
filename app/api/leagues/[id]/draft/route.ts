import { api, ok } from "@/lib/http/handler";
import { getDraftState } from "@/lib/services/draft";

/** GET /api/leagues/:id/draft: the board. Also settles any picks whose timer ran out. */
export const GET = api<{ id: string }>(async ({ params, ctx }) => ok(await getDraftState(ctx, params.id)));
