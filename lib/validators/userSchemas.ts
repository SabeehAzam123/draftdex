import { z } from "zod";

export const RoleSchema = z.enum(["Admin", "Staff"]);

export const LoginSchema = z.object({
    email: z.string().email(),
    password: z.string().min(1),
});

export const CreateUserSchema = z.object({
    email: z.string().email(),
    password: z.string().min(6),
    role: RoleSchema,
});

export const UpdateUserSchema = z.object({
    email: z.string().email().optional(),
    role: RoleSchema.optional(),
});

export const UsersQuerySchema = z.object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(50).default(10),
    role: RoleSchema.optional(),
    q: z.string().trim().min(1).max(200).optional(),
});
