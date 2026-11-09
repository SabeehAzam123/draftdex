import type { ReactNode } from "react";
import type { LeagueStatus } from "@/lib/domain/enums";
import { STATUS_LABEL, STATUS_TONE } from "@/lib/client/format";

export type Tone = "slate" | "blue" | "violet" | "green" | "amber" | "red";

const TONES: Record<Tone, string> = {
    slate: "bg-slate-100 text-slate-700 ring-slate-200",
    blue: "bg-blue-50 text-blue-700 ring-blue-200",
    violet: "bg-brand-50 text-brand-700 ring-brand-200",
    green: "bg-emerald-50 text-emerald-700 ring-emerald-200",
    amber: "bg-amber-50 text-amber-800 ring-amber-200",
    red: "bg-red-50 text-red-700 ring-red-200",
};

export function Badge({ tone = "slate", children, testId }: { tone?: Tone; children: ReactNode; testId?: string }) {
    return (
        <span data-testid={testId} className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${TONES[tone]}`}>
            {children}
        </span>
    );
}

export function StatusBadge({ status, testId }: { status: LeagueStatus; testId?: string }) {
    return (
        <span data-status={status}>
            <Badge tone={STATUS_TONE[status]} testId={testId}>
                {STATUS_LABEL[status]}
            </Badge>
        </span>
    );
}

const ENTRY_TONES: Record<string, Tone> = { pending: "amber", approved: "green", rejected: "red", withdrawn: "slate" };

export function EntryStatusBadge({ status, testId }: { status: string; testId?: string }) {
    return (
        <Badge tone={ENTRY_TONES[status] ?? "slate"} testId={testId}>
            {status[0]!.toUpperCase() + status.slice(1)}
        </Badge>
    );
}

// The 18 types' usual colours
const TYPE_COLORS: Record<string, string> = {
    normal: "#9fa19f",
    fire: "#e62829",
    water: "#2980ef",
    electric: "#fac000",
    grass: "#3fa129",
    ice: "#3dcef3",
    fighting: "#ff8000",
    poison: "#9141cb",
    ground: "#915121",
    flying: "#81b9ef",
    psychic: "#ef4179",
    bug: "#91a119",
    rock: "#afa981",
    ghost: "#704170",
    dragon: "#5060e1",
    dark: "#624d4e",
    steel: "#60a1b8",
    fairy: "#ef70ef",
};

export function TypeBadge({ type }: { type: string }) {
    return (
        <span
            data-type={type}
            className="inline-flex rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white shadow-sm"
            style={{ backgroundColor: TYPE_COLORS[type] ?? "#64748b" }}
        >
            {type}
        </span>
    );
}

export function TypeBadges({ types }: { types: string[] }) {
    return (
        <span className="inline-flex flex-wrap gap-1">
            {types.map((t) => (
                <TypeBadge key={t} type={t} />
            ))}
        </span>
    );
}

export function PointsBadge({ points, banned, testId }: { points: number; banned?: boolean; testId?: string }) {
    if (banned) {
        return (
            <Badge tone="red" testId={testId}>
                Banned
            </Badge>
        );
    }
    const tone: Tone = points >= 16 ? "violet" : points >= 10 ? "blue" : points >= 5 ? "green" : "slate";
    return (
        <Badge tone={tone} testId={testId}>
            {points} pts
        </Badge>
    );
}
