import { jwtVerify, SignJWT } from "jose";
import { getConfig } from "@/lib/config";

export type TokenClaims = { sub: string };

const secret = () => new TextEncoder().encode(getConfig().jwtSecret);

/**
 * The token carries only the user's id. Role and email are read from the database on each request,
 * so a role change or a deleted account takes effect at once.
 */
export async function signToken(userId: string): Promise<string> {
    return new SignJWT({})
        .setProtectedHeader({ alg: "HS256" })
        .setSubject(userId)
        .setIssuedAt()
        .setExpirationTime(getConfig().jwtExpiresIn)
        .sign(secret());
}

/** Returns the user id, or throws if the token is invalid or expired. */
export async function verifyToken(token: string): Promise<string> {
    const { payload } = await jwtVerify(token, secret(), { algorithms: ["HS256"] });
    if (typeof payload.sub !== "string" || !payload.sub) throw new Error("token has no subject");
    return payload.sub;
}
