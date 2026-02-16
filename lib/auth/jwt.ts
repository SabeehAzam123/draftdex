import { SignJWT, jwtVerify } from "jose";

const secret = new TextEncoder().encode(process.env.JWT_SECRET || "");

export type JwtPayload = {
    sub: string; // userId
    role: "Admin" | "Staff";
    email: string;
};

export async function signToken(payload: JwtPayload) {
    const exp = process.env.JWT_EXPIRES_IN || "30m";
    return new SignJWT({ role: payload.role, email: payload.email })
        .setProtectedHeader({ alg: "HS256" })
        .setSubject(payload.sub)
        .setIssuedAt()
        .setExpirationTime(exp)
        .sign(secret);
}

export async function verifyToken(token: string) {
    const { payload } = await jwtVerify(token, secret);
    const sub = payload.sub;
    const role = payload.role;
    const email = payload.email;

    if (!sub || (role !== "Admin" && role !== "Staff") || typeof email !== "string") {
        throw new Error("Invalid token payload");
    }

    return { sub: String(sub), role: role as "Admin" | "Staff", email };
}
