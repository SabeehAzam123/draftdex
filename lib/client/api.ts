import { getToken } from "./authStore";

const BASE = process.env.NEXT_PUBLIC_API_BASE || "/api";

export type ApiError = { message: string; code: string; traceId: string };

async function handle(res: Response) {
    if (res.status === 204) return null;
    const json = await res.json().catch(() => null);
    if (!res.ok) throw json as ApiError;
    return json;
}

export async function apiGet(path: string) {
    const token = getToken();
    const res = await fetch(`${BASE}${path}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        cache: "no-store",
    });
    return handle(res);
}

export async function apiPost(path: string, body: any) {
    const token = getToken();
    const res = await fetch(`${BASE}${path}`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(body),
    });
    return handle(res);
}

export async function apiPut(path: string, body: any) {
    const token = getToken();
    const res = await fetch(`${BASE}${path}`, {
        method: "PUT",
        headers: {
            "Content-Type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(body),
    });
    return handle(res);
}

export async function apiDelete(path: string) {
    const token = getToken();
    const res = await fetch(`${BASE}${path}`, {
        method: "DELETE",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    return handle(res);
}
