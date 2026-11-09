import { beforeAll, describe, expect, it, vi } from "vitest";
import * as health from "@/app/api/health/route";
import * as login from "@/app/api/auth/login/route";
import * as logout from "@/app/api/auth/logout/route";
import * as signup from "@/app/api/auth/signup/route";
import * as me from "@/app/api/me/route";
import * as wallet from "@/app/api/me/wallet/route";
import { signToken } from "@/lib/auth/jwt";
import { errorResponse } from "@/lib/http/handler";
import { setupDb } from "@/test/helpers";
import { call } from "@/test/http";

beforeAll(async () => {
    await setupDb();
});

const PASSWORD = "Passw0rd!";

async function signUpUser(email: string) {
    const res = await call(signup.POST, { method: "POST", body: { email, password: PASSWORD, displayName: "Api User" } });
    return res.json.data.token as string;
}

describe("POST /api/auth/signup", () => {
    it("creates the account, signs it in and sets an httpOnly session cookie", async () => {
        const res = await call(signup.POST, { method: "POST", body: { email: "Api.New@Test.dev", password: PASSWORD, displayName: "Api New" } });
        expect(res.status).toBe(201);
        expect(res.json.data.user).toMatchObject({ email: "api.new@test.dev", role: "user", displayName: "Api New" });
        expect(res.json.data.token).toMatch(/^ey/);
        const cookie = res.headers.get("set-cookie") ?? "";
        expect(cookie).toMatch(/^draftdex_session=ey/);
        expect(cookie).toMatch(/HttpOnly/i);
        expect(cookie).toMatch(/SameSite=lax/i);
    });

    it("explains every invalid field", async () => {
        const res = await call(signup.POST, { method: "POST", body: { email: "not-an-email", password: "short", displayName: "X" } });
        expect(res.status).toBe(422);
        expect(res.json).toMatchObject({ code: "VALIDATION_ERROR", traceId: expect.any(String) });
        const paths = res.json.details.map((d: { path: string }) => d.path);
        expect(paths).toEqual(expect.arrayContaining(["email", "password", "displayName"]));
    });

    it("refuses unknown fields, so a client can't set its own role", async () => {
        const res = await call(signup.POST, { method: "POST", body: { email: "role@test.dev", password: PASSWORD, displayName: "Sneaky", role: "admin" } });
        expect(res.status).toBe(422);
        expect(res.json.details).toEqual([expect.objectContaining({ message: expect.stringContaining("role") })]);
    });

    it("answers 409 for an email that's taken", async () => {
        await signUpUser("taken@test.dev");
        const res = await call(signup.POST, { method: "POST", body: { email: "taken@test.dev", password: PASSWORD, displayName: "Again" } });
        expect(res).toMatchObject({ status: 409, json: { code: "USER_EMAIL_EXISTS" } });
    });
});

describe("POST /api/auth/login", () => {
    it("returns a token and sets the cookie", async () => {
        await signUpUser("login.api@test.dev");
        const res = await call(login.POST, { method: "POST", body: { email: "login.api@test.dev", password: PASSWORD } });
        expect(res.status).toBe(200);
        expect(res.json.data).toMatchObject({ token: expect.any(String), user: { email: "login.api@test.dev" } });
        expect(res.headers.get("set-cookie")).toMatch(/^draftdex_session=/);
    });

    it("answers 401 for wrong credentials", async () => {
        const res = await call(login.POST, { method: "POST", body: { email: "login.api@test.dev", password: "Wrong1234" } });
        expect(res).toMatchObject({ status: 401, json: { code: "AUTH_INVALID_CREDENTIALS", message: "Wrong email or password" } });
    });
});

describe("authentication on protected endpoints", () => {
    it("accepts a Bearer token or the session cookie", async () => {
        const token = await signUpUser("both@test.dev");
        const viaHeader = await call(me.GET, { token });
        expect(viaHeader).toMatchObject({ status: 200, json: { data: { email: "both@test.dev", balance: 1000 } } });
        const viaCookie = await call(wallet.GET, { cookie: token });
        expect(viaCookie.status).toBe(200);
        expect(viaCookie.json.data.history).toHaveLength(1);
    });

    it("answers 401 with no token, and a different code for a bad one", async () => {
        expect((await call(me.GET)).json.code).toBe("AUTH_MISSING_TOKEN");
        for (const headers of [{ authorization: "Bearer not.a.jwt" }, { authorization: "Token abc" }]) {
            const res = await call(me.GET, { headers });
            expect(res).toMatchObject({ status: 401, json: { code: "AUTH_INVALID_TOKEN" } });
        }
        expect((await call(me.GET, { cookie: "garbage" })).json.code).toBe("AUTH_INVALID_TOKEN");
    });

    it("rejects a valid token for an account that no longer exists", async () => {
        const res = await call(me.GET, { token: await signToken("us_deleted") });
        expect(res).toMatchObject({ status: 401, json: { code: "AUTH_INVALID_TOKEN" } });
    });

    it("updates the profile with PATCH /api/me", async () => {
        const token = await signUpUser("patch@test.dev");
        const res = await call(me.PATCH, { method: "PATCH", token, body: { uiVariant: "classic" } });
        expect(res).toMatchObject({ status: 200, json: { data: { uiVariant: "classic" } } });
    });
});

describe("POST /api/auth/logout", () => {
    it("expires the cookie", async () => {
        const res = await call(logout.POST, { method: "POST" });
        expect(res.status).toBe(204);
        expect(res.headers.get("set-cookie")).toMatch(/draftdex_session=;.*Max-Age=0/i);
    });
});

describe("request and response rules", () => {
    it("needs JSON for writes", async () => {
        const res = await call(login.POST, { method: "POST", body: "email=a&password=b", contentType: "application/x-www-form-urlencoded" });
        expect(res).toMatchObject({ status: 415, json: { code: "UNSUPPORTED_MEDIA_TYPE" } });
    });

    it("answers 400 for a body that isn't JSON", async () => {
        const res = await call(login.POST, { method: "POST", body: "{not json" });
        expect(res).toMatchObject({ status: 400, json: { code: "BAD_REQUEST" } });
    });

    it("puts a trace id on every response, matching the error body", async () => {
        const res = await call(me.GET);
        expect(res.headers.get("x-trace-id")).toBe(res.json.traceId);
        const okRes = await call(health.GET);
        expect(okRes.headers.get("x-trace-id")).toMatch(/^[0-9a-f-]{36}$/);
    });

    it("hides internals in a 500 and turns a busy database into a 503", async () => {
        const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
        const boom = errorResponse(new Error("secret internal detail"), "trace-1");
        expect(boom.status).toBe(500);
        const body = await boom.json();
        expect(body).toEqual({ message: "Something went wrong on our side", code: "INTERNAL_ERROR", traceId: "trace-1" });
        expect(spy).toHaveBeenCalled();
        const busy = errorResponse(new Error("SQLITE_BUSY: database is locked"), "trace-2");
        expect(busy.status).toBe(503);
        expect(busy.headers.get("retry-after")).toBe("1");
        spy.mockRestore();
    });
});

describe("GET /api/health", () => {
    it("answers without signing in", async () => {
        expect(await call(health.GET)).toMatchObject({ status: 200, json: { status: "ok", app: "DraftDex" } });
    });
});
