import { api, ok, paged, readBody, readQuery } from "@/lib/http/handler";
import { listPool, updatePool } from "@/lib/services/pool";
import { PoolQuerySchema, PoolUpdateSchema } from "@/lib/validators/schemas";

type P = { id: string };

/** GET /api/leagues/:id/pool?q=&type=&status=all|available|taken|banned&minPoints=&maxPoints=&sort=&page=&pageSize= */
export const GET = api<P>(async ({ req, params, ctx }) => paged(await listPool(ctx, params.id, readQuery(req, PoolQuerySchema))));

/** PUT /api/leagues/:id/pool (commissioner, before the draft): `{ changes: [{ pokemonId, points?, banned? }] }`. All or nothing. */
export const PUT = api<P>(async ({ req, params, ctx }) => ok(await updatePool(ctx, params.id, await readBody(req, PoolUpdateSchema))));
