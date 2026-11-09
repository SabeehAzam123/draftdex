import { api, ok, readBody } from "@/lib/http/handler";
import { sendTestNotification } from "@/lib/services/notify";
import { EmptySchema } from "@/lib/validators/schemas";

/** POST /api/leagues/:id/webhook/test (commissioner): sends a test message now and returns the outcome. */
export const POST = api<{ id: string }>(async ({ req, params, ctx }) => {
    await readBody(req, EmptySchema);
    return ok(await sendTestNotification(ctx, params.id));
});
