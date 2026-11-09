import { and, count, desc, eq, like, or, type SQL } from "drizzle-orm";
import type { z } from "zod";
import { signToken } from "@/lib/auth/jwt";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { SIGNUP_BONUS } from "@/lib/config";
import type { DbOrTx } from "@/lib/db/client";
import { entries, leagues, users, type UiVariant, type UserRole } from "@/lib/db/schema";
import { AppError, conflict, notFound, unauthorized } from "@/lib/errors/app-error";
import { ErrorCodes } from "@/lib/errors/codes";
import type {
    AdminCreateUserSchema,
    AdminUpdateUserSchema,
    SignupSchema,
    UpdateMeSchema,
    UsersQuerySchema,
} from "@/lib/validators/schemas";
import { newId, nowIso, requireActor, requireAdmin, type Actor, type Ctx } from "./context";
import { balanceOf, historyOf, SYSTEM_ACCOUNT, transfer, userAccount, type LedgerRow } from "./ledger";

export type UserDto = { id: string; email: string; displayName: string; role: UserRole; uiVariant: UiVariant; createdAt: string };

type UserRow = typeof users.$inferSelect;
const toDto = (u: UserRow): UserDto => ({
    id: u.id,
    email: u.email,
    displayName: u.displayName,
    role: u.role,
    uiVariant: u.uiVariant,
    createdAt: u.createdAt,
});

async function insertUser(
    db: DbOrTx,
    input: { email: string; password: string; displayName: string; role: UserRole },
    at: string,
): Promise<UserRow> {
    const existing = await db.select({ id: users.id }).from(users).where(eq(users.email, input.email)).get();
    if (existing) throw conflict(ErrorCodes.USER_EMAIL_EXISTS, "An account with this email already exists");
    const row: UserRow = {
        id: newId("us"),
        email: input.email,
        displayName: input.displayName,
        passwordHash: await hashPassword(input.password),
        role: input.role,
        uiVariant: "new",
        createdAt: at,
    };
    await db.insert(users).values(row);
    // Every account starts with credits for entry fees
    await transfer(db, {
        from: SYSTEM_ACCOUNT,
        to: userAccount(row.id),
        amount: SIGNUP_BONUS,
        kind: "signup_bonus",
        ref: row.id,
        memo: "Welcome credits",
        at,
    });
    return row;
}

/** Self-service sign-up: always a normal user. */
export async function signUp(ctx: Ctx, input: z.infer<typeof SignupSchema>): Promise<UserDto> {
    const row = await ctx.db.transaction((tx) => insertUser(tx, { ...input, role: "user" }, nowIso(ctx)));
    return toDto(row);
}

/** The same answer for an unknown email and a wrong password, so the API doesn't reveal which emails exist. */
export async function logIn(ctx: Ctx, email: string, password: string): Promise<{ token: string; user: UserDto }> {
    const row = await ctx.db.select().from(users).where(eq(users.email, email.toLowerCase())).get();
    const ok = row ? await verifyPassword(password, row.passwordHash) : false;
    if (!row || !ok) throw unauthorized(ErrorCodes.AUTH_INVALID_CREDENTIALS, "Wrong email or password");
    return { token: await signToken(row.id), user: toDto(row) };
}

export async function findActor(db: DbOrTx, userId: string): Promise<Actor | null> {
    const row = await db.select().from(users).where(eq(users.id, userId)).get();
    return row ? { id: row.id, email: row.email, displayName: row.displayName, role: row.role } : null;
}

export async function getMe(ctx: Ctx): Promise<UserDto & { balance: number }> {
    const actor = requireActor(ctx);
    const row = await ctx.db.select().from(users).where(eq(users.id, actor.id)).get();
    if (!row) throw unauthorized(ErrorCodes.AUTH_INVALID_TOKEN, "This account no longer exists");
    return { ...toDto(row), balance: await balanceOf(ctx.db, userAccount(actor.id)) };
}

export async function updateMe(ctx: Ctx, input: z.infer<typeof UpdateMeSchema>): Promise<UserDto> {
    const actor = requireActor(ctx);
    if (Object.keys(input).length > 0) {
        await ctx.db.transaction((tx) => tx.update(users).set(input).where(eq(users.id, actor.id)));
    }
    const row = await ctx.db.select().from(users).where(eq(users.id, actor.id)).get();
    return toDto(row!);
}

export async function getWallet(ctx: Ctx): Promise<{ balance: number; history: LedgerRow[] }> {
    const actor = requireActor(ctx);
    const account = userAccount(actor.id);
    return { balance: await balanceOf(ctx.db, account), history: await historyOf(ctx.db, account) };
}

// ---- Admin ----

export async function listUsers(ctx: Ctx, q: z.infer<typeof UsersQuerySchema>) {
    requireAdmin(ctx);
    const filters: SQL[] = [];
    if (q.role) filters.push(eq(users.role, q.role));
    if (q.q) filters.push(or(like(users.email, `%${q.q}%`), like(users.displayName, `%${q.q}%`))!);
    const where = filters.length ? and(...filters) : undefined;
    const [{ total } = { total: 0 }] = await ctx.db.select({ total: count() }).from(users).where(where);
    const rows = await ctx.db
        .select()
        .from(users)
        .where(where)
        .orderBy(desc(users.createdAt), users.email)
        .limit(q.pageSize)
        .offset((q.page - 1) * q.pageSize);
    return { data: rows.map(toDto), page: q.page, pageSize: q.pageSize, total };
}

export async function adminCreateUser(ctx: Ctx, input: z.infer<typeof AdminCreateUserSchema>): Promise<UserDto> {
    requireAdmin(ctx);
    const row = await ctx.db.transaction((tx) => insertUser(tx, input, nowIso(ctx)));
    return toDto(row);
}

export async function adminUpdateUser(ctx: Ctx, id: string, input: z.infer<typeof AdminUpdateUserSchema>): Promise<UserDto> {
    const admin = requireAdmin(ctx);
    const row = await ctx.db.select().from(users).where(eq(users.id, id)).get();
    if (!row) throw notFound(ErrorCodes.USER_NOT_FOUND, "User not found");
    if (id === admin.id && input.role && input.role !== row.role) {
        throw conflict(ErrorCodes.USER_CANNOT_CHANGE_SELF, "You can't change your own role");
    }
    if (Object.keys(input).length > 0) {
        await ctx.db.transaction((tx) => tx.update(users).set(input).where(eq(users.id, id)));
    }
    return toDto({ ...row, ...input });
}

export async function adminDeleteUser(ctx: Ctx, id: string): Promise<void> {
    const admin = requireAdmin(ctx);
    if (id === admin.id) throw conflict(ErrorCodes.USER_CANNOT_CHANGE_SELF, "You can't delete your own account");
    const row = await ctx.db.select({ id: users.id }).from(users).where(eq(users.id, id)).get();
    if (!row) throw notFound(ErrorCodes.USER_NOT_FOUND, "User not found");
    const [runs] = await ctx.db.select({ n: count() }).from(leagues).where(eq(leagues.commissionerId, id));
    const [plays] = await ctx.db.select({ n: count() }).from(entries).where(eq(entries.userId, id));
    if ((runs?.n ?? 0) > 0 || (plays?.n ?? 0) > 0) {
        throw new AppError(409, ErrorCodes.USER_HAS_ACTIVITY, "This user runs or plays in a league, so they can't be deleted");
    }
    await ctx.db.transaction((tx) => tx.delete(users).where(eq(users.id, id)));
}
