import { api, ok, readBody } from "@/lib/http/handler";
import { openRegistration } from "@/lib/services/leagues";
import { EmptySchema } from "@/lib/validators/schemas";

/** POST /api/leagues/:id/open-registration (commissioner): setup → registration. */
export const POST = api<{ id: string }>(async ({ req, params, ctx }) => {
    await readBody(req, EmptySchema);
    return ok(await openRegistration(ctx, params.id));
});
