import { api, created, paged, readBody, readQuery } from "@/lib/http/handler";
import { adminCreateUser, listUsers } from "@/lib/services/users";
import { AdminCreateUserSchema, UsersQuerySchema } from "@/lib/validators/schemas";

/** GET /api/users?page=&pageSize=&role=&q= (admin). */
export const GET = api(async ({ req, ctx }) => paged(await listUsers(ctx, readQuery(req, UsersQuerySchema))));

/** POST /api/users (admin). */
export const POST = api(async ({ req, ctx }) => created(await adminCreateUser(ctx, await readBody(req, AdminCreateUserSchema))));
