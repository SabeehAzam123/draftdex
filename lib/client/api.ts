/**
 * The browser's API client. The session travels in an httpOnly cookie, so no token handling here.
 * Every failure becomes an ApiError carrying the server's code and trace id.
 */

export type ErrorDetail = { path: string; message: string };

export class ApiError extends Error {
    constructor(
        readonly status: number,
        readonly code: string,
        message: string,
        readonly traceId: string | null,
        readonly details: ErrorDetail[] = [],
    ) {
        super(message);
        this.name = "ApiError";
    }
}

type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

async function request(method: Method, path: string, body?: unknown): Promise<Response> {
    const write = method !== "GET";
    let res: Response;
    try {
        res = await fetch(`/api${path}`, {
            method,
            headers: write ? { "Content-Type": "application/json" } : undefined,
            body: write ? JSON.stringify(body ?? {}) : undefined,
            cache: "no-store",
        });
    } catch {
        throw new ApiError(0, "NETWORK_ERROR", "Can't reach the server. Check your connection and try again.", null);
    }
    if (res.ok) return res;
    const json = (await res.json().catch(() => null)) as { message?: string; code?: string; traceId?: string; details?: ErrorDetail[] } | null;
    if (res.status === 401 && typeof window !== "undefined" && !path.startsWith("/auth/")) {
        // The session ended: back to the sign-in page, then here again
        window.location.href = `/login?next=${encodeURIComponent(window.location.pathname + window.location.search)}`;
    }
    throw new ApiError(
        res.status,
        json?.code ?? "HTTP_ERROR",
        json?.message ?? `The server answered ${res.status}`,
        json?.traceId ?? res.headers.get("x-trace-id"),
        json?.details ?? [],
    );
}

/** `{ data }` endpoints: returns `data`. */
export async function apiData<T>(method: Method, path: string, body?: unknown): Promise<T> {
    const res = await request(method, path, body);
    if (res.status === 204) return undefined as T;
    return ((await res.json()) as { data: T }).data;
}

export type Page<T> = { data: T[]; page: number; pageSize: number; total: number };

/** Paged list endpoints. */
export async function apiPage<T>(path: string): Promise<Page<T>> {
    const res = await request("GET", path);
    return (await res.json()) as Page<T>;
}

/** Plain-text endpoints (the Showdown export). */
export async function apiText(path: string): Promise<string> {
    return (await request("GET", path)).text();
}

export const get = <T>(path: string) => apiData<T>("GET", path);
export const post = <T>(path: string, body?: unknown) => apiData<T>("POST", path, body);
export const put = <T>(path: string, body?: unknown) => apiData<T>("PUT", path, body);
export const patch = <T>(path: string, body?: unknown) => apiData<T>("PATCH", path, body);
export const del = (path: string) => apiData<void>("DELETE", path);

/** Field errors keyed by field path, from a 422's details. */
export function fieldErrors(err: unknown): Record<string, string> {
    if (!(err instanceof ApiError)) return {};
    const out: Record<string, string> = {};
    for (const d of err.details) if (!out[d.path]) out[d.path] = d.message;
    return out;
}

export const query = (params: Record<string, string | number | boolean | undefined | null>) => {
    const sp = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== "") sp.set(k, String(v));
    const s = sp.toString();
    return s ? `?${s}` : "";
};
