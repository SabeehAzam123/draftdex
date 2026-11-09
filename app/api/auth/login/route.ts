import { api, ok, readBody } from "@/lib/http/handler";
import { logIn } from "@/lib/services/users";
import { LoginSchema } from "@/lib/validators/schemas";
import { setSessionCookie } from "../session-cookie";

/** POST /api/auth/login: `{ data: { token, user } }` plus the session cookie for the browser. */
export const POST = api(
    async ({ req, ctx }) => {
        const body = await readBody(req, LoginSchema);
        const result = await logIn(ctx, body.email, body.password);
        return setSessionCookie(ok(result), result.token);
    },
    { public: true },
);
