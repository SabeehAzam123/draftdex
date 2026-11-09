import { ErrorCodes, type ErrorCode } from "./codes";

export type ErrorDetail = { path: string; message: string };

/** An expected failure with an HTTP status and a stable code. Anything else becomes a 500. */
export class AppError extends Error {
    constructor(
        readonly status: number,
        readonly code: ErrorCode,
        message: string,
        readonly details?: ErrorDetail[],
    ) {
        super(message);
        this.name = "AppError";
    }
}

export const unauthorized = (code: ErrorCode = ErrorCodes.AUTH_MISSING_TOKEN, message = "Sign in first") =>
    new AppError(401, code, message);

export const forbidden = (message = "You don't have permission to do that") =>
    new AppError(403, ErrorCodes.RBAC_FORBIDDEN, message);

export const notFound = (code: ErrorCode, message: string) => new AppError(404, code, message);

export const conflict = (code: ErrorCode, message: string) => new AppError(409, code, message);

export const invalid = (code: ErrorCode, message: string, details?: ErrorDetail[]) =>
    new AppError(422, code, message, details);

/** Zod's issues as the API's `details` list. */
export function zodDetails(issues: ReadonlyArray<{ path: PropertyKey[]; message: string }>): ErrorDetail[] {
    return issues.map((i) => ({ path: i.path.map(String).join(".") || "(body)", message: i.message }));
}

/** SQLite's own constraint failures (e.g. a unique index), so services can turn them into a clean 409. */
export function isUniqueViolation(err: unknown): boolean {
    const text = errorText(err);
    return text.includes("UNIQUE constraint failed") || text.includes("SQLITE_CONSTRAINT");
}

export function isBusy(err: unknown): boolean {
    return errorText(err).includes("SQLITE_BUSY");
}

function errorText(err: unknown): string {
    if (!err || typeof err !== "object") return String(err);
    const parts: string[] = [];
    let e: unknown = err;
    // drizzle wraps the driver's error in `cause`
    for (let i = 0; e && i < 4; i++) {
        const o = e as { message?: unknown; code?: unknown; cause?: unknown };
        parts.push(String(o.message ?? ""), String(o.code ?? ""));
        e = o.cause;
    }
    return parts.join(" ");
}
