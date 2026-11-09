import { api, ok, readBody } from "@/lib/http/handler";
import { resolveResult } from "@/lib/services/season";
import { ResolveSchema } from "@/lib/validators/schemas";

/** POST …/matches/:matchId/resolve (commissioner): the final result of any match that isn't final yet. */
export const POST = api<{ id: string; matchId: string }>(async ({ req, params, ctx }) =>
    ok(await resolveResult(ctx, params.id, params.matchId, await readBody(req, ResolveSchema))),
);
