import { api, created, ok, readBody } from "@/lib/http/handler";
import { listTrades, proposeTrade } from "@/lib/services/trades";
import { ProposeTradeSchema } from "@/lib/validators/schemas";

type P = { id: string };

/** GET /api/leagues/:id/trades */
export const GET = api<P>(async ({ params, ctx }) => ok(await listTrades(ctx, params.id)));

/** POST /api/leagues/:id/trades (a coach): `{ toEntryId, give: [pokemonId], get: [pokemonId], note? }`, same count each way. */
export const POST = api<P>(async ({ req, params, ctx }) => created(await proposeTrade(ctx, params.id, await readBody(req, ProposeTradeSchema))));
