import { api, created, paged, readBody, readQuery } from "@/lib/http/handler";
import { createLeague, listLeagues } from "@/lib/services/leagues";
import { CreateLeagueSchema, LeaguesQuerySchema } from "@/lib/validators/schemas";

/** GET /api/leagues?status=&mine=true&page=&pageSize= */
export const GET = api(async ({ req, ctx }) => paged(await listLeagues(ctx, readQuery(req, LeaguesQuerySchema))));

/** POST /api/leagues: the caller becomes its commissioner. */
export const POST = api(async ({ req, ctx }) => created(await createLeague(ctx, await readBody(req, CreateLeagueSchema))));
