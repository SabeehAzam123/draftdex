import { api, created, readBody } from "@/lib/http/handler";
import { makePick } from "@/lib/services/draft";
import { PickSchema } from "@/lib/validators/schemas";

/** POST /api/leagues/:id/draft/picks: `{ pokemonId }` for the coach on the clock (or by the commissioner). Returns the board. */
export const POST = api<{ id: string }>(async ({ req, params, ctx }) => created(await makePick(ctx, params.id, await readBody(req, PickSchema))));
