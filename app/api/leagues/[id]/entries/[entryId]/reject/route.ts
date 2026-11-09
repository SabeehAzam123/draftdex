import { api, ok, readBody } from "@/lib/http/handler";
import { rejectEntry } from "@/lib/services/entries";
import { EmptySchema } from "@/lib/validators/schemas";

/** POST /api/leagues/:id/entries/:entryId/reject (commissioner): refunds the fee. */
export const POST = api<{ id: string; entryId: string }>(async ({ req, params, ctx }) => {
    await readBody(req, EmptySchema);
    return ok(await rejectEntry(ctx, params.id, params.entryId));
});
