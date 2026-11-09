import { NextRequest } from "next/server";

type RouteHandler = (req: NextRequest, segment: { params: Promise<Record<string, string>> }) => Promise<Response>;

export type CallOptions = {
    method?: string;
    path?: string;
    body?: unknown;
    /** Sent as `Authorization: Bearer …` */
    token?: string;
    /** Sent as the session cookie */
    cookie?: string;
    /** Overrides the JSON content type (or sets one with no body) */
    contentType?: string;
    headers?: Record<string, string>;
    params?: Record<string, string>;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- tests reach into response JSON freely; the assertions check its shape
export type CallResult = { status: number; json: any; text: string; headers: Headers };

/** Calls a Next route handler directly with a real Request: the API tests' HTTP client. */
export async function call(handler: unknown, o: CallOptions = {}): Promise<CallResult> {
    const method = o.method ?? "GET";
    const headers = new Headers(o.headers);
    const hasBody = o.body !== undefined;
    if (o.contentType) headers.set("content-type", o.contentType);
    else if (hasBody || ["POST", "PUT", "PATCH"].includes(method)) headers.set("content-type", "application/json");
    if (o.token) headers.set("authorization", `Bearer ${o.token}`);
    if (o.cookie) headers.set("cookie", `draftdex_session=${o.cookie}`);
    const body = !hasBody ? undefined : typeof o.body === "string" ? o.body : JSON.stringify(o.body);
    const req = new NextRequest(`http://localhost${o.path ?? "/api/test"}`, { method, headers, body });
    const res = await (handler as RouteHandler)(req, { params: Promise.resolve(o.params ?? {}) });
    const text = await res.text();
    let json: unknown;
    try {
        json = JSON.parse(text);
    } catch {
        json = undefined;
    }
    return { status: res.status, json, text, headers: res.headers };
}
