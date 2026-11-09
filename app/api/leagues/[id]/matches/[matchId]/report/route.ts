import { api, ok, readBody } from "@/lib/http/handler";
import { reportResult } from "@/lib/services/season";
import { ReportResultSchema } from "@/lib/validators/schemas";

/** POST …/matches/:matchId/report (a coach in the match): `{ homeWins, awayWins, replayUrl? }`, best of three. */
export const POST = api<{ id: string; matchId: string }>(async ({ req, params, ctx }) =>
    ok(await reportResult(ctx, params.id, params.matchId, await readBody(req, ReportResultSchema))),
);
