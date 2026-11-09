import { api, ok, readBody } from "@/lib/http/handler";
import { approveEntry } from "@/lib/services/entries";
import { EmptySchema } from "@/lib/validators/schemas";

/** POST /api/leagues/:id/entries/:entryId/approve (commissioner). */
export const POST = api<{ id: string; entryId: string }>(async ({ req, params, ctx }) => {
    await readBody(req, EmptySchema);
    return ok(await approveEntry(ctx, params.id, params.entryId));
});
