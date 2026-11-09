import { api, ok, readBody } from "@/lib/http/handler";
import { cancelLeague } from "@/lib/services/leagues";
import { EmptySchema } from "@/lib/validators/schemas";

/** POST /api/leagues/:id/cancel (commissioner, before the draft): refunds every entry fee. */
export const POST = api<{ id: string }>(async ({ req, params, ctx }) => {
    await readBody(req, EmptySchema);
    return ok(await cancelLeague(ctx, params.id));
});
