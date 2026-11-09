import { api, created, readBody } from "@/lib/http/handler";
import { logIn, signUp } from "@/lib/services/users";
import { SignupSchema } from "@/lib/validators/schemas";
import { setSessionCookie } from "../session-cookie";

/** POST /api/auth/signup: creates the account and signs it in (`201 { data: { token, user } }`). */
export const POST = api(
    async ({ req, ctx }) => {
        const body = await readBody(req, SignupSchema);
        await signUp(ctx, body);
        const result = await logIn(ctx, body.email, body.password);
        return setSessionCookie(created(result), result.token);
    },
    { public: true },
);
