import { randomUUID } from "node:crypto";
import { after, NextResponse, type NextRequest } from "next/server";
import type { ZodType } from "zod";
import { readSession, SESSION_COOKIE } from "@/lib/auth/session";
import { getDb, type Db } from "@/lib/db/client";
import { AppError, isBusy, unauthorized, zodDetails } from "@/lib/errors/app-error";
import { ErrorCodes } from "@/lib/errors/codes";
import { makeCtx, type Ctx, type DomainEvent } from "@/lib/services/context";
import { deliverEvents } from "@/lib/services/notify";

type Segment<P> = { params: Promise<P> };
type Handler<P> = (args: { req: NextRequest; params: P; ctx: Ctx }) => Promise<Response>;

const WRITES = new Set(["POST", "PUT", "PATCH"]);

/**
 * Wraps a route handler with what every endpoint needs:
 * - a trace id on every response (`x-trace-id`, and in error bodies), also printed with 500s;
 * - the caller from the Bearer token or the session cookie (401 unless `public`);
 * - JSON only for writes (415 otherwise), which also blocks cross-site form posts;
 * - AppErrors as `{ message, code, traceId, details? }`, anything else as a 500 without internals;
 * - Discord notifications sent after the response, so a slow webhook never slows the API.
 */
export function api<P = Record<string, never>>(fn: Handler<P>, opts: { public?: boolean } = {}) {
    return async (req: NextRequest, segment: Segment<P>): Promise<Response> => {
        const traceId = randomUUID();
        try {
            if (WRITES.has(req.method) && !(req.headers.get("content-type") ?? "").toLowerCase().startsWith("application/json")) {
                throw new AppError(415, ErrorCodes.UNSUPPORTED_MEDIA_TYPE, "Send JSON with the header Content-Type: application/json");
            }
            const db = getDb();
            const session = await readSession(db, req.headers.get("authorization"), req.cookies.get(SESSION_COOKIE)?.value);
            if (!opts.public && !session.actor) {
                throw session.invalid
                    ? unauthorized(ErrorCodes.AUTH_INVALID_TOKEN, "Your session has expired or is invalid; sign in again")
                    : unauthorized();
            }
            const ctx = makeCtx(db, session.actor);
            const res = await fn({ req, params: await segment.params, ctx });
            res.headers.set("x-trace-id", traceId);
            sendLater(db, ctx.events);
            return res;
        } catch (err) {
            return errorResponse(err, traceId);
        }
    };
}

function sendLater(db: Db, events: DomainEvent[]) {
    if (events.length === 0) return;
    const send = () => deliverEvents(db, events).catch((e) => console.error("[notify] delivery failed", e));
    try {
        after(send);
    } catch {
        // Outside a Next request (unit tests): send now, without waiting
        void send();
    }
}

export function errorResponse(err: unknown, traceId: string): Response {
    if (err instanceof AppError) {
        const body = { message: err.message, code: err.code, traceId, ...(err.details ? { details: err.details } : {}) };
        return NextResponse.json(body, { status: err.status, headers: { "x-trace-id": traceId } });
    }
    if (isBusy(err)) {
        return NextResponse.json(
            { message: "The server is busy; try again", code: ErrorCodes.CONFLICT_BUSY, traceId },
            { status: 503, headers: { "x-trace-id": traceId, "retry-after": "1" } },
        );
    }
    console.error(`[api] ${traceId}`, err);
    return NextResponse.json(
        { message: "Something went wrong on our side", code: ErrorCodes.INTERNAL_ERROR, traceId },
        { status: 500, headers: { "x-trace-id": traceId } },
    );
}

// ---- Input ----

function parseOr422<T>(schema: ZodType<T>, value: unknown, message: string): T {
    const parsed = schema.safeParse(value);
    if (!parsed.success) throw new AppError(422, ErrorCodes.VALIDATION_ERROR, message, zodDetails(parsed.error.issues));
    return parsed.data;
}

/** The JSON body, validated. An empty body counts as `{}`. */
export async function readBody<T>(req: NextRequest, schema: ZodType<T>): Promise<T> {
    const text = await req.text();
    let value: unknown = {};
    if (text.trim()) {
        try {
            value = JSON.parse(text);
        } catch {
            throw new AppError(400, ErrorCodes.BAD_REQUEST, "The body isn't valid JSON");
        }
    }
    return parseOr422(schema, value, "Some fields are invalid");
}

export function readQuery<T>(req: NextRequest, schema: ZodType<T>): T {
    return parseOr422(schema, Object.fromEntries(req.nextUrl.searchParams), "Some query parameters are invalid");
}

/** A path id like `/api/pokemon/25`. */
export function readIntParam(value: string, what: string): number {
    if (!/^\d{1,6}$/.test(value)) throw new AppError(422, ErrorCodes.VALIDATION_ERROR, `${what} must be a number`);
    return Number(value);
}

// ---- Output ----

export const ok = (data: unknown, status = 200) => NextResponse.json({ data }, { status });
export const created = (data: unknown) => ok(data, 201);
export const paged = (result: { data: unknown; page: number; pageSize: number; total: number }) => NextResponse.json(result);
export const noContent = () => new NextResponse(null, { status: 204 });
