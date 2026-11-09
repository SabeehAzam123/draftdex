import { api, ok } from "@/lib/http/handler";
import { getSchedule } from "@/lib/services/season";

/** GET /api/leagues/:id/schedule: every match by week, with what the caller may do on each. */
export const GET = api<{ id: string }>(async ({ params, ctx }) => ok(await getSchedule(ctx, params.id)));
