import mongoose, { Schema, Model } from "mongoose";

export type Role = "Admin" | "Staff";

export type UserDoc = mongoose.Document & {
    email: string;
    passwordHash: string;
    role: Role;
    createdAt: Date;
    updatedAt: Date;
};

const UserSchema = new Schema<UserDoc>(
    {
        email: { type: String, required: true, unique: true, lowercase: true, trim: true, index: true },
        passwordHash: { type: String, required: true },
        role: { type: String, required: true, enum: ["Admin", "Staff"] },
    },
    { timestamps: true }
);

export const User: Model<UserDoc> = mongoose.models.User || mongoose.model<UserDoc>("User", UserSchema);
