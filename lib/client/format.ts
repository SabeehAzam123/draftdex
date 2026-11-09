import type { LeagueStatus } from "@/lib/domain/enums";

export const STATUS_LABEL: Record<LeagueStatus, string> = {
    setup: "Setting up",
    registration: "Registration open",
    drafting: "Drafting",
    season: "Season",
    completed: "Completed",
    cancelled: "Cancelled",
};

export const STATUS_TONE: Record<LeagueStatus, "slate" | "blue" | "violet" | "green" | "amber" | "red"> = {
    setup: "slate",
    registration: "blue",
    drafting: "violet",
    season: "green",
    completed: "slate",
    cancelled: "red",
};

export function formatDate(iso: string): string {
    return new Date(iso).toLocaleString(undefined, { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

export function formatShortDate(iso: string): string {
    return new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

export function formatTimer(seconds: number): string {
    if (seconds <= 0) return "No timer";
    if (seconds < 60) return `${seconds} s`;
    if (seconds < 3600) return `${Math.round(seconds / 60)} min`;
    return `${Math.round(seconds / 3600)} h`;
}

/** mm:ss or h:mm:ss until a deadline, never negative. */
export function formatCountdown(ms: number): string {
    const total = Math.max(0, Math.ceil(ms / 1000));
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    const mm = String(m).padStart(h ? 2 : 1, "0");
    const ss = String(s).padStart(2, "0");
    return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

export const credits = (n: number) => `${n.toLocaleString()} cr`;

export const dex = (id: number) => `#${String(id).padStart(4, "0")}`;
