import { api, ok, readBody } from "@/lib/http/handler";
import { setWebhook } from "@/lib/services/leagues";
import { WebhookSchema } from "@/lib/validators/schemas";

/** PUT /api/leagues/:id/webhook (commissioner): `{ url }` to set, `{ url: null }` to remove. Never returned in full. */
export const PUT = api<{ id: string }>(async ({ req, params, ctx }) => {
    const body = await readBody(req, WebhookSchema);
    return ok(await setWebhook(ctx, params.id, body.url));
});
