"use client";

import Link from "next/link";
import { useParams, usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { LeagueContext } from "@/components/league-context";
import { StatusBadge } from "@/components/ui/badge";
import { ErrorBanner, Spinner } from "@/components/ui/feedback";
import { get } from "@/lib/client/api";
import { credits } from "@/lib/client/format";
import { useLoad } from "@/lib/client/use-api";
import type { LeagueDto } from "@/lib/services/leagues";

export default function LeagueLayout({ children }: { children: ReactNode }) {
    const { id } = useParams<{ id: string }>();
    const pathname = usePathname();
    const { data: league, error, loading, reload } = useLoad(() => get<LeagueDto>(`/leagues/${id}`), id);

    if (loading && !league) return <Spinner label="Loading league…" />;
    if (error && !league) return <ErrorBanner error={error} onRetry={reload} />;
    if (!league) return null;

    const base = `/leagues/${league.id}`;
    const tabs = [
        { href: base, label: "Overview", testId: "league-tab-overview" },
        { href: `${base}/pool`, label: "Tier list", testId: "league-tab-pool" },
        { href: `${base}/draft`, label: "Draft", testId: "league-tab-draft" },
        ...(league.me.canManage ? [{ href: `${base}/settings`, label: "Settings", testId: "league-tab-settings" }] : []),
    ];

    return (
        <LeagueContext.Provider value={{ league, reload }}>
            <div className="mb-6">
                <Link href="/leagues" className="text-sm text-slate-500 hover:text-brand-700" data-testid="league-back">
                    ← Leagues
                </Link>
                <div className="mt-2 flex flex-wrap items-center gap-3">
                    <h1 data-testid="league-name" className="text-2xl font-bold tracking-tight text-slate-900">
                        {league.name}
                    </h1>
                    <StatusBadge status={league.status} testId="league-status" />
                </div>
                <p className="mt-1 text-sm text-slate-500">
                    <span className="capitalize">{league.format}</span> · Commissioner{" "}
                    <span data-testid="league-commissioner" className="font-medium text-slate-700">
                        {league.commissioner.displayName}
                    </span>{" "}
                    · {league.counts.approved}/{league.settings.maxCoaches} coaches · Prize pool{" "}
                    <span data-testid="league-prize-pool" className="font-medium text-slate-700">
                        {credits(league.prizePool)}
                    </span>
                </p>
                <nav className="mt-5 flex gap-1 border-b border-slate-200" aria-label="League">
                    {tabs.map((t) => {
                        const active = t.href === base ? pathname === base : pathname.startsWith(t.href);
                        return (
                            <Link
                                key={t.href}
                                href={t.href}
                                data-testid={t.testId}
                                aria-current={active ? "page" : undefined}
                                className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium ${
                                    active ? "border-brand-600 text-brand-700" : "border-transparent text-slate-500 hover:text-slate-800"
                                }`}
                            >
                                {t.label}
                            </Link>
                        );
                    })}
                </nav>
            </div>
            {children}
        </LeagueContext.Provider>
    );
}
