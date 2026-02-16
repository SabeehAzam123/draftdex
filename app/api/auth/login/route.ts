import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { connectMongo } from "@/lib/db/mongo";
import { User } from "@/models/User";
import { LoginSchema } from "@/lib/validators/userSchemas";
import { errorJson } from "@/lib/errors/errorModel";
import { ErrorCodes } from "@/lib/errors/codes";
import { signToken } from "@/lib/auth/jwt";

export async function POST(req: NextRequest) {
    await connectMongo();

    let body: unknown;
    try {
        body = await req.json();
    } catch {
        return errorJson(400, "Invalid JSON body", ErrorCodes.BAD_REQUEST);
    }

    const parsed = LoginSchema.safeParse(body);
    if (!parsed.success) {
        return errorJson(422, "Validation error", ErrorCodes.VALIDATION_ERROR);
    }

    const { email, password } = parsed.data;

    const user = await User.findOne({ email: email.toLowerCase() }).lean();
    if (!user) {
        return errorJson(401, "Invalid credentials", ErrorCodes.AUTH_INVALID_CREDENTIALS);
    }

    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) {
        return errorJson(401, "Invalid credentials", ErrorCodes.AUTH_INVALID_CREDENTIALS);
    }

    const token = await signToken({ sub: String(user._id), role: user.role, email: user.email });

    return NextResponse.json({
        data: {
            token,
            user: { id: String(user._id), email: user.email, role: user.role },
        },
    });
}
