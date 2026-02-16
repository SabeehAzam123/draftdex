import { NextRequest, NextResponse } from "next/server";
import { connectMongo } from "@/lib/db/mongo";
import { User } from "@/models/User";
import { getAuthOrError } from "@/lib/auth/middleware";
import { requireRole } from "@/lib/auth/rbac";
import { errorJson } from "@/lib/errors/errorModel";
import { ErrorCodes } from "@/lib/errors/codes";
import { UpdateUserSchema } from "@/lib/validators/userSchemas";
import mongoose from "mongoose";

function isValidObjectId(id: string) {
    return mongoose.Types.ObjectId.isValid(id);
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    await connectMongo();

    const auth = await getAuthOrError(req);
    if (!auth.ok) return auth.res;

    if (!requireRole(auth.user.role, ["Admin"])) {
        return errorJson(403, "Forbidden", ErrorCodes.RBAC_FORBIDDEN);
    }

    const { id } = await params; // ✅ FIX
    if (!isValidObjectId(id)) {
        return errorJson(404, "User not found", ErrorCodes.USER_NOT_FOUND);
    }

    let body: unknown;
    try {
        body = await req.json();
    } catch {
        return errorJson(400, "Invalid JSON body", ErrorCodes.BAD_REQUEST);
    }

    const parsed = UpdateUserSchema.safeParse(body);
    if (!parsed.success) {
        return errorJson(422, "Validation error", ErrorCodes.VALIDATION_ERROR);
    }

    const update: any = {};
    if (parsed.data.email) update.email = parsed.data.email.toLowerCase();
    if (parsed.data.role) update.role = parsed.data.role;

    if (update.email) {
        const exists = await User.findOne({ email: update.email, _id: { $ne: id } }).lean();
        if (exists) {
            return errorJson(409, "Email already exists", ErrorCodes.USER_EMAIL_EXISTS);
        }
    }

    const updated = await User.findByIdAndUpdate(id, update, { new: true })
        .select({ email: 1, role: 1, updatedAt: 1 })
        .lean();

    if (!updated) {
        return errorJson(404, "User not found", ErrorCodes.USER_NOT_FOUND);
    }

    return NextResponse.json({
        data: { id: String(updated._id), email: updated.email, role: updated.role, updatedAt: updated.updatedAt },
    });
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    await connectMongo();

    const auth = await getAuthOrError(req);
    if (!auth.ok) return auth.res;

    if (!requireRole(auth.user.role, ["Admin"])) {
        return errorJson(403, "Forbidden", ErrorCodes.RBAC_FORBIDDEN);
    }

    const { id } = await params; // ✅ FIX
    if (!isValidObjectId(id)) {
        return errorJson(404, "User not found", ErrorCodes.USER_NOT_FOUND);
    }

    const deleted = await User.findByIdAndDelete(id).lean();
    if (!deleted) {
        return errorJson(404, "User not found", ErrorCodes.USER_NOT_FOUND);
    }

    return new NextResponse(null, { status: 204 });
}
