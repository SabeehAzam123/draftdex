import { api, ok } from "@/lib/http/handler";
import { listNotifications } from "@/lib/services/notify";

/** GET /api/leagues/:id/notifications (commissioner): the last 50 webhook deliveries. */
export const GET = api<{ id: string }>(async ({ params, ctx }) => ok(await listNotifications(ctx, params.id)));
