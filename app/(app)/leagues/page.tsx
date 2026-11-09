"use client";

import Link from "next/link";
import { useState } from "react";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { LinkButton } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/card";
import { EmptyState, ErrorBanner, Pager, Spinner } from "@/components/ui/feedback";
import { Select } from "@/components/ui/field";
import { apiPage, query } from "@/lib/client/api";
import { credits, STATUS_LABEL } from "@/lib/client/format";
import { useLoad } from "@/lib/client/use-api";
import { LEAGUE_STATUSES } from "@/lib/domain/enums";
import type { LeagueDto } from "@/lib/services/leagues";

export default function LeaguesPage() {
    const [tab, setTab] = useState<"mine" | "all">("mine");
    const [status, setStatus] = useState("");
    const [page, setPage] = useState(1);
    const path = `/leagues${query({ mine: tab === "mine" ? "true" : undefined, status, page, pageSize: 12 })}`;
    const { data, error, loading, reload } = useLoad(() => apiPage<LeagueDto>(path), path);

    return (
        <>
            <PageHeader
                title="Leagues"
                subtitle="Join a league, or start your own and invite coaches."
                actions={
                    <LinkButton href="/leagues/new" testId="leagues-create">
                        + New league
                    </LinkButton>
                }
            />
            <div className="mb-5 flex flex-wrap items-center gap-3">
                <div className="inline-flex rounded-lg border border-slate-200 bg-white p-1 shadow-sm" role="tablist">
                    {(["mine", "all"] as const).map((t) => (
                        <button
                            key={t}
                            role="tab"
                            aria-selected={tab === t}
                            data-testid={`leagues-tab-${t}`}
                            onClick={() => {
                                setTab(t);
                                setPage(1);
                            }}
                            className={`rounded-md px-3 py-1.5 text-sm font-medium ${tab === t ? "bg-brand-600 text-white" : "text-slate-600 hover:bg-slate-100"}`}
                        >
                            {t === "mine" ? "My leagues" : "All leagues"}
                        </button>
                    ))}
                </div>
                <Select
                    aria-label="Filter by status"
                    testId="leagues-status-filter"
                    className="w-48"
                    value={status}
                    onChange={(e) => {
                        setStatus(e.target.value);
                        setPage(1);
                    }}
                >
                    <option value="">Any status</option>
                    {LEAGUE_STATUSES.map((s) => (
                        <option key={s} value={s}>
                            {STATUS_LABEL[s]}
                        </option>
                    ))}
                </Select>
            </div>

            {loading && !data ? (
                <Spinner />
            ) : error ? (
                <ErrorBanner error={error} onRetry={reload} />
            ) : data && data.data.length === 0 ? (
                <EmptyState
                    testId="leagues-empty"
                    title={tab === "mine" ? "You're not in any league yet" : "No leagues match"}
                    action={
                        tab === "mine" ? (
                            <button className="text-sm font-semibold text-brand-700 hover:underline" onClick={() => setTab("all")} data-testid="leagues-browse-all">
                                Browse all leagues
                            </button>
                        ) : undefined
                    }
                >
                    {tab === "mine" ? "Join one that's open for registration, or start your own." : "Try another status."}
                </EmptyState>
            ) : (
                data && (
                    <>
                        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" data-testid="leagues-list">
                            {data.data.map((l) => (
                                <LeagueCard key={l.id} league={l} />
                            ))}
                        </ul>
                        <Pager page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} />
                    </>
                )
            )}
        </>
    );
}

function LeagueCard({ league: l }: { league: LeagueDto }) {
    const role = l.me.canManage ? "Commissioner" : l.me.entry ? `Coach · ${l.me.entry.status}` : null;
    return (
        <li data-testid="league-card" data-league-id={l.id}>
            <Link href={`/leagues/${l.id}`} className="block h-full rounded-xl border border-slate-200 bg-white p-5 shadow-sm transition hover:border-brand-300 hover:shadow-md">
                <div className="flex items-start justify-between gap-3">
                    <h3 data-testid="league-card-name" className="font-semibold text-slate-900">
                        {l.name}
                    </h3>
                    <StatusBadge status={l.status} testId="league-card-status" />
                </div>
                <p className="mt-1 text-xs text-slate-500">
                    <span className="capitalize">{l.format}</span> · run by {l.commissioner.displayName}
                </p>
                <dl className="mt-4 grid grid-cols-3 gap-2 text-center">
                    <div className="rounded-lg bg-slate-50 py-2">
                        <dt className="text-[10px] uppercase text-slate-500">Coaches</dt>
                        <dd className="text-sm font-semibold" data-testid="league-card-coaches">
                            {l.counts.approved}/{l.settings.maxCoaches}
                        </dd>
                    </div>
                    <div className="rounded-lg bg-slate-50 py-2">
                        <dt className="text-[10px] uppercase text-slate-500">Entry</dt>
                        <dd className="text-sm font-semibold">{l.settings.entryFee ? credits(l.settings.entryFee) : "Free"}</dd>
                    </div>
                    <div className="rounded-lg bg-slate-50 py-2">
                        <dt className="text-[10px] uppercase text-slate-500">Prize pool</dt>
                        <dd className="text-sm font-semibold">{credits(l.prizePool)}</dd>
                    </div>
                </dl>
                {role && (
                    <div className="mt-3">
                        <Badge tone={l.me.canManage ? "violet" : "blue"} testId="league-card-role">
                            {role}
                        </Badge>
                    </div>
                )}
            </Link>
        </li>
    );
}
