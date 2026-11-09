import type { NextResponse } from "next/server";
import { SESSION_COOKIE } from "@/lib/auth/session";
import { getConfig } from "@/lib/config";

export function setSessionCookie(res: NextResponse, token: string): NextResponse {
    res.cookies.set(SESSION_COOKIE, token, {
        httpOnly: true,
        sameSite: "lax",
        secure: getConfig().env === "production",
        path: "/",
    });
    return res;
}

export function clearSessionCookie(res: NextResponse): NextResponse {
    res.cookies.set(SESSION_COOKIE, "", { httpOnly: true, sameSite: "lax", path: "/", maxAge: 0 });
    return res;
}
