/**
 * League notification webhooks. The server POSTs to a URL a user typed, so the URL is checked
 * against an allow-list of hosts (no requests to internal addresses), and it's never shown back
 * in full: it contains the webhook's secret token.
 */

export type UrlCheck = { ok: true; url: string } | { ok: false; reason: string };

const IP_LITERAL = /^(\d{1,3}\.){3}\d{1,3}$|^\[.*\]$/;

export function checkWebhookUrl(raw: string, allowedHosts: readonly string[]): UrlCheck {
    let url: URL;
    try {
        url = new URL(raw.trim());
    } catch {
        return { ok: false, reason: "Not a valid URL" };
    }
    if (url.username || url.password) return { ok: false, reason: "URLs with a username or password aren't allowed" };
    const host = url.hostname.toLowerCase();
    const allowed = allowedHosts.some((h) => host === h || host.endsWith(`.${h}`));
    if (!allowed) {
        return { ok: false, reason: `Host "${host}" isn't allowed (allowed: ${allowedHosts.join(", ")})` };
    }
    // An address typed as numbers bypasses the host names above, unless it's listed itself
    if (IP_LITERAL.test(host) && !allowedHosts.includes(host)) return { ok: false, reason: "IP addresses aren't allowed" };
    const local = host === "localhost" || host.endsWith(".localhost") || IP_LITERAL.test(host);
    if (url.protocol !== "https:" && !(url.protocol === "http:" && local)) {
        return { ok: false, reason: "Use https (http only for a listed local address)" };
    }
    return { ok: true, url: url.toString() };
}

/**
 * Shows where a webhook points without its secret: scheme, host and the first path part,
 * e.g. https://discord.com/api/webhooks/**** .
 */
export function maskWebhookUrl(raw: string | null): string | null {
    if (!raw) return null;
    try {
        const url = new URL(raw);
        const parts = url.pathname.split("/").filter(Boolean);
        const keep = parts[0] === "api" && parts[1] === "webhooks" ? ["api", "webhooks"] : parts.slice(0, 1);
        return `${url.protocol}//${url.host}/${keep.join("/")}${keep.length ? "/" : ""}****`;
    } catch {
        return "****";
    }
}
