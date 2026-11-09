import { api, noContent, ok, readBody } from "@/lib/http/handler";
import { adminDeleteUser, adminUpdateUser } from "@/lib/services/users";
import { AdminUpdateUserSchema } from "@/lib/validators/schemas";

type P = { id: string };

/** PATCH /api/users/:id (admin): display name and role. */
export const PATCH = api<P>(async ({ req, params, ctx }) => ok(await adminUpdateUser(ctx, params.id, await readBody(req, AdminUpdateUserSchema))));

/** DELETE /api/users/:id (admin): only users with no leagues or entries. */
export const DELETE = api<P>(async ({ params, ctx }) => {
    await adminDeleteUser(ctx, params.id);
    return noContent();
});
