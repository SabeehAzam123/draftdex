import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { connectMongo } from "@/lib/db/mongo";
import { User } from "@/models/User";
import { getAuthOrError } from "@/lib/auth/middleware";
import { requireRole } from "@/lib/auth/rbac";
import { errorJson } from "@/lib/errors/errorModel";
import { ErrorCodes } from "@/lib/errors/codes";
import { CreateUserSchema, UsersQuerySchema } from "@/lib/validators/userSchemas";

export async function GET(req: NextRequest) {
    await connectMongo();

    const auth = await getAuthOrError(req);
    if (!auth.ok) return auth.res;

    const url = new URL(req.url);
    const queryObj = {
        page: url.searchParams.get("page") ?? undefined,
        pageSize: url.searchParams.get("pageSize") ?? undefined,
        role: url.searchParams.get("role") ?? undefined,
        q: url.searchParams.get("q") ?? undefined,
    };

    const parsedQ = UsersQuerySchema.safeParse(queryObj);
    if (!parsedQ.success) {
        return errorJson(422, "Validation error", ErrorCodes.VALIDATION_ERROR);
    }

    const { page, pageSize, role, q } = parsedQ.data;

    const filter: any = {};
    if (role) filter.role = role;
    if (q) filter.email = { $regex: q, $options: "i" };

    const total = await User.countDocuments(filter);
    const data = await User.find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * pageSize)
        .limit(pageSize)
        .select({ email: 1, role: 1, createdAt: 1 })
        .lean();

    return NextResponse.json({
        data: data.map((u) => ({
            id: String(u._id),
            email: u.email,
            role: u.role,
            createdAt: u.createdAt,
        })),
        page,
        pageSize,
        total,
    });
}

export async function POST(req: NextRequest) {
    await connectMongo();

    const auth = await getAuthOrError(req);
    if (!auth.ok) return auth.res;

    if (!requireRole(auth.user.role, ["Admin"])) {
        return errorJson(403, "Forbidden", ErrorCodes.RBAC_FORBIDDEN);
    }

    let body: unknown;
    try {
        body = await req.json();
    } catch {
        return errorJson(400, "Invalid JSON body", ErrorCodes.BAD_REQUEST);
    }

    const parsed = CreateUserSchema.safeParse(body);
    if (!parsed.success) {
        return errorJson(422, "Validation error", ErrorCodes.VALIDATION_ERROR);
    }

    const { email, password, role } = parsed.data;
    const normEmail = email.toLowerCase();

    const exists = await User.findOne({ email: normEmail }).lean();
    if (exists) {
        return errorJson(409, "Email already exists", ErrorCodes.USER_EMAIL_EXISTS);
    }

    const passwordHash = await bcrypt.hash(password, 10);

    const created = await User.create({ email: normEmail, passwordHash, role });

    return NextResponse.json(
        {
            data: {
                id: String(created._id),
                email: created.email,
                role: created.role,
                createdAt: created.createdAt,
            },
        },
        { status: 201 }
    );
}
