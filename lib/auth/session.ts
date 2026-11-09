import type { DbOrTx } from "@/lib/db/client";
import type { Actor } from "@/lib/services/context";
import { findActor } from "@/lib/services/users";
import { verifyToken } from "./jwt";

/** The browser's session: an httpOnly, SameSite=Lax cookie holding the JWT (scripts can't read it). */
export const SESSION_COOKIE = "draftdex_session";

export type SessionRead = { actor: Actor | null; invalid: boolean };

/**
 * Who is calling. API clients send `Authorization: Bearer <jwt>`; the browser sends the cookie.
 * `invalid` means a token was sent but didn't check out (bad, expired, or the account is gone).
 */
export async function readSession(db: DbOrTx, authorization: string | null, cookie: string | undefined): Promise<SessionRead> {
    let token: string | undefined;
    if (authorization) {
        const m = /^Bearer\s+(\S+)$/i.exec(authorization);
        if (!m) return { actor: null, invalid: true };
        token = m[1];
    } else {
        token = cookie;
    }
    if (!token) return { actor: null, invalid: false };
    try {
        const actor = await findActor(db, await verifyToken(token));
        return actor ? { actor, invalid: false } : { actor: null, invalid: true };
    } catch {
        return { actor: null, invalid: true };
    }
}
