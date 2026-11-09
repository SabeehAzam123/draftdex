import { api, ok, readBody } from "@/lib/http/handler";
import { getMe, updateMe } from "@/lib/services/users";
import { UpdateMeSchema } from "@/lib/validators/schemas";

/** GET /api/me: the signed-in user with their credit balance. */
export const GET = api(async ({ ctx }) => ok(await getMe(ctx)));

/** PATCH /api/me: change your display name or UI ("new" / "classic"). */
export const PATCH = api(async ({ req, ctx }) => ok(await updateMe(ctx, await readBody(req, UpdateMeSchema))));
