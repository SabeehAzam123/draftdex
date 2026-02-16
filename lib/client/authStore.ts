const TOKEN_KEY = "mini_admin_token";
const USER_KEY = "mini_admin_user";

export type SessionUser = { id: string; email: string; role: "Admin" | "Staff" };

function isBrowser() {
    return typeof window !== "undefined";
}

export function setSession(token: string, user: SessionUser) {
    if (!isBrowser()) return;
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(USER_KEY, JSON.stringify(user));
}

export function clearSession() {
    if (!isBrowser()) return;
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
}

export function getToken() {
    if (!isBrowser()) return null;
    return localStorage.getItem(TOKEN_KEY);
}

export function getUser(): SessionUser | null {
    if (!isBrowser()) return null;
    const raw = localStorage.getItem(USER_KEY);
    if (!raw) return null;
    try {
        return JSON.parse(raw);
    } catch {
        return null;
    }
}
