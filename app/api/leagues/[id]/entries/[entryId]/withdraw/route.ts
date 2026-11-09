import { api, ok, readBody } from "@/lib/http/handler";
import { withdrawEntry } from "@/lib/services/entries";
import { EmptySchema } from "@/lib/validators/schemas";

/** POST /api/leagues/:id/entries/:entryId/withdraw (the entry's coach, before the draft): refunds the fee. */
export const POST = api<{ id: string; entryId: string }>(async ({ req, params, ctx }) => {
    await readBody(req, EmptySchema);
    return ok(await withdrawEntry(ctx, params.id, params.entryId));
});
