import { api, ok, readBody } from "@/lib/http/handler";
import { disputeResult } from "@/lib/services/season";
import { DisputeSchema } from "@/lib/validators/schemas";

/** POST …/matches/:matchId/dispute (the opponent of whoever reported): `{ reason }`. */
export const POST = api<{ id: string; matchId: string }>(async ({ req, params, ctx }) =>
    ok(await disputeResult(ctx, params.id, params.matchId, await readBody(req, DisputeSchema))),
);
