import { api, ok, readBody } from "@/lib/http/handler";
import { startDraft } from "@/lib/services/draft";
import { StartDraftSchema } from "@/lib/validators/schemas";

/** POST /api/leagues/:id/start-draft (commissioner): `{ order?: entryId[] }`, random when left out. */
export const POST = api<{ id: string }>(async ({ req, params, ctx }) => ok(await startDraft(ctx, params.id, await readBody(req, StartDraftSchema))));
