import { api, ok, readBody } from "@/lib/http/handler";
import { skipCurrentPick } from "@/lib/services/draft";
import { EmptySchema } from "@/lib/validators/schemas";

/** POST /api/leagues/:id/draft/skip (commissioner): as if the current pick's timer ran out. */
export const POST = api<{ id: string }>(async ({ req, params, ctx }) => {
    await readBody(req, EmptySchema);
    return ok(await skipCurrentPick(ctx, params.id));
});
