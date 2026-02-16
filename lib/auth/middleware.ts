import { NextRequest } from "next/server";
import { errorJson } from "@/lib/errors/errorModel";
import { ErrorCodes } from "@/lib/errors/codes";
import { verifyToken } from "@/lib/auth/jwt";

export async function getAuthOrError(req: NextRequest) {
    const auth = req.headers.get("authorization") || "";
    const m = auth.match(/^Bearer\s+(.+)$/i);

    if (!m?.[1]) {
        return { ok: false as const, res: errorJson(401, "Missing token", ErrorCodes.AUTH_MISSING_TOKEN) };
    }

    try {
        const user = await verifyToken(m[1]);
        return { ok: true as const, user };
    } catch {
        return { ok: false as const, res: errorJson(401, "Invalid token", ErrorCodes.AUTH_INVALID_TOKEN) };
    }
}
