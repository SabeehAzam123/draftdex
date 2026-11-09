import { api, ok, readBody } from "@/lib/http/handler";
import { getLeague, updateLeague } from "@/lib/services/leagues";
import { UpdateLeagueSchema } from "@/lib/validators/schemas";

type P = { id: string };

/** GET /api/leagues/:id */
export const GET = api<P>(async ({ params, ctx }) => ok(await getLeague(ctx, params.id)));

/** PATCH /api/leagues/:id (commissioner, before the draft): name, format, settings (merged). */
export const PATCH = api<P>(async ({ req, params, ctx }) => ok(await updateLeague(ctx, params.id, await readBody(req, UpdateLeagueSchema))));
