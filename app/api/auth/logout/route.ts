import { api, noContent } from "@/lib/http/handler";
import { clearSessionCookie } from "../session-cookie";

/** POST /api/auth/logout: clears the session cookie (a Bearer token simply expires). */
export const POST = api(async () => clearSessionCookie(noContent()), { public: true });
