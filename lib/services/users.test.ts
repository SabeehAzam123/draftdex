import { beforeAll, describe, expect, it } from "vitest";
import type { Db } from "@/lib/db/client";
import { verifyToken } from "@/lib/auth/jwt";
import { SIGNUP_BONUS } from "@/lib/config";
import { ctxOf, expectError, expectLedgerBalanced, leagueWithCoaches, makeUser, setupDb, TEST_PASSWORD } from "@/test/helpers";
import {
    adminCreateUser,
    adminDeleteUser,
    adminUpdateUser,
    findActor,
    getMe,
    getWallet,
    listUsers,
    logIn,
    signUp,
    updateMe,
} from "./users";

let db: Db;
beforeAll(async () => {
    db = await setupDb();
});

describe("signUp", () => {
    it("creates a normal user with the welcome credits, and keeps the ledger balanced", async () => {
        const u = await signUp(ctxOf(db, null), { email: "new.coach@test.dev", password: TEST_PASSWORD, displayName: "New Coach" });
        expect(u).toMatchObject({ email: "new.coach@test.dev", role: "user", uiVariant: "new" });
        expect(u.id).toMatch(/^us_[0-9a-f]{16}$/);
        expect(u).not.toHaveProperty("passwordHash");
        const wallet = await getWallet(ctxOf(db, (await findActor(db, u.id))!));
        expect(wallet.balance).toBe(SIGNUP_BONUS);
        expect(wallet.history).toEqual([expect.objectContaining({ amount: SIGNUP_BONUS, kind: "signup_bonus" })]);
        await expectLedgerBalanced(db);
    });

    it("refuses a second account with the same email", async () => {
        await signUp(ctxOf(db, null), { email: "twice@test.dev", password: TEST_PASSWORD, displayName: "Twice" });
        await expectError(
            signUp(ctxOf(db, null), { email: "twice@test.dev", password: TEST_PASSWORD, displayName: "Again" }),
            409,
            "USER_EMAIL_EXISTS",
        );
    });
});

describe("logIn", () => {
    it("returns a token for the user and the user", async () => {
        await signUp(ctxOf(db, null), { email: "login@test.dev", password: TEST_PASSWORD, displayName: "Login" });
        const { token, user } = await logIn(ctxOf(db, null), "LOGIN@test.dev", TEST_PASSWORD);
        expect(await verifyToken(token)).toBe(user.id);
    });

    it("gives the same answer for a wrong password and an unknown email", async () => {
        const same = { status: 401, code: "AUTH_INVALID_CREDENTIALS", message: "Wrong email or password" };
        await expect(logIn(ctxOf(db, null), "login@test.dev", "wrong-password1")).rejects.toMatchObject(same);
        await expect(logIn(ctxOf(db, null), "nobody@test.dev", TEST_PASSWORD)).rejects.toMatchObject(same);
    });
});

describe("me", () => {
    it("returns the profile with the balance and updates name and UI", async () => {
        const me = await makeUser(db);
        expect(await getMe(ctxOf(db, me))).toMatchObject({ id: me.id, balance: SIGNUP_BONUS });
        const updated = await updateMe(ctxOf(db, me), { displayName: "Renamed", uiVariant: "classic" });
        expect(updated).toMatchObject({ displayName: "Renamed", uiVariant: "classic" });
    });

    it("needs a signed-in user", async () => {
        await expectError(getMe(ctxOf(db, null)), 401, "AUTH_MISSING_TOKEN");
        await expectError(getWallet(ctxOf(db, null)), 401, "AUTH_MISSING_TOKEN");
    });
});

describe("admin user management", () => {
    it("lists, searches, filters and pages users", async () => {
        const admin = await makeUser(db, { role: "admin" });
        await makeUser(db, { name: "Findable Person" });
        const all = await listUsers(ctxOf(db, admin), { page: 1, pageSize: 2 });
        expect(all.data).toHaveLength(2);
        expect(all.total).toBeGreaterThan(2);
        const found = await listUsers(ctxOf(db, admin), { page: 1, pageSize: 10, q: "Findable" });
        expect(found.data.map((u) => u.displayName)).toEqual(["Findable Person"]);
        const admins = await listUsers(ctxOf(db, admin), { page: 1, pageSize: 50, role: "admin" });
        expect(admins.data.every((u) => u.role === "admin")).toBe(true);
    });

    it("is admin-only", async () => {
        const user = await makeUser(db);
        await expectError(listUsers(ctxOf(db, user), { page: 1, pageSize: 10 }), 403, "RBAC_FORBIDDEN");
        await expectError(adminDeleteUser(ctxOf(db, user), user.id), 403, "RBAC_FORBIDDEN");
    });

    it("creates, updates and deletes a user", async () => {
        const admin = await makeUser(db, { role: "admin" });
        const u = await adminCreateUser(ctxOf(db, admin), { email: "made@test.dev", password: TEST_PASSWORD, displayName: "Made", role: "admin" });
        expect(u.role).toBe("admin");
        expect(await adminUpdateUser(ctxOf(db, admin), u.id, { role: "user" })).toMatchObject({ role: "user" });
        await adminDeleteUser(ctxOf(db, admin), u.id);
        expect(await findActor(db, u.id)).toBeNull();
        await expectError(adminDeleteUser(ctxOf(db, admin), u.id), 404, "USER_NOT_FOUND");
        await expectError(adminUpdateUser(ctxOf(db, admin), "us_missing", { role: "user" }), 404, "USER_NOT_FOUND");
    });

    it("won't let an admin demote or delete themselves", async () => {
        const admin = await makeUser(db, { role: "admin" });
        await expectError(adminUpdateUser(ctxOf(db, admin), admin.id, { role: "user" }), 409, "USER_CANNOT_CHANGE_SELF");
        await expectError(adminDeleteUser(ctxOf(db, admin), admin.id), 409, "USER_CANNOT_CHANGE_SELF");
        // renaming yourself is fine
        expect(await adminUpdateUser(ctxOf(db, admin), admin.id, { displayName: "Still Admin" })).toMatchObject({ role: "admin" });
    });

    it("won't delete someone who runs or plays in a league", async () => {
        const admin = await makeUser(db, { role: "admin" });
        const { commissioner, coaches } = await leagueWithCoaches(db, { coaches: 2 });
        await expectError(adminDeleteUser(ctxOf(db, admin), commissioner.id), 409, "USER_HAS_ACTIVITY");
        await expectError(adminDeleteUser(ctxOf(db, admin), coaches[0]!.actor.id), 409, "USER_HAS_ACTIVITY");
    });
});
