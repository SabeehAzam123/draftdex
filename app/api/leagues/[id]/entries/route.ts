import { api, created, ok, readBody } from "@/lib/http/handler";
import { applyToLeague, listEntries } from "@/lib/services/entries";
import { ApplySchema } from "@/lib/validators/schemas";

type P = { id: string };

/** GET /api/leagues/:id/entries */
export const GET = api<P>(async ({ params, ctx }) => ok(await listEntries(ctx, params.id)));

/** POST /api/leagues/:id/entries: apply with `{ teamName }`; the entry fee is charged now. */
export const POST = api<P>(async ({ req, params, ctx }) => created(await applyToLeague(ctx, params.id, await readBody(req, ApplySchema))));
