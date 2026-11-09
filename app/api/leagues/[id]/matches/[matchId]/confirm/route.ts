import { api, ok, readBody } from "@/lib/http/handler";
import { confirmResult } from "@/lib/services/season";
import { EmptySchema } from "@/lib/validators/schemas";

/** POST …/matches/:matchId/confirm (the opponent of whoever reported). */
export const POST = api<{ id: string; matchId: string }>(async ({ req, params, ctx }) => {
    await readBody(req, EmptySchema);
    return ok(await confirmResult(ctx, params.id, params.matchId));
});
