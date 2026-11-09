import { api, ok, readBody } from "@/lib/http/handler";
import { completeSeason } from "@/lib/services/season";
import { EmptySchema } from "@/lib/validators/schemas";

/** POST /api/leagues/:id/complete (commissioner): ends the season once every match is decided, and pays out. */
export const POST = api<{ id: string }>(async ({ req, params, ctx }) => {
    await readBody(req, EmptySchema);
    return ok(await completeSeason(ctx, params.id));
});
