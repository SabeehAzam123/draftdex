"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useLeague } from "@/components/league-context";
import { Sprite } from "@/components/pokemon";
import { Badge, PointsBadge, TypeBadges } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { EmptyState, ErrorBanner, Spinner } from "@/components/ui/feedback";
import { Input, Select } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";
import { apiPage, get, post, query } from "@/lib/client/api";
import { dex, formatCountdown } from "@/lib/client/format";
import { useLoad } from "@/lib/client/use-api";
import { POKEMON_TYPES } from "@/lib/domain/enums";
import type { DraftState } from "@/lib/services/draft";
import type { PoolRowDto } from "@/lib/services/pool";

const REFRESH_MS = 2000;

export default function DraftPage() {
    const { league, reload: reloadLeague } = useLeague();
    const draft = useLoad(() => get<DraftState>(`/leagues/${league.id}/draft`), league.id, league.status === "drafting" ? REFRESH_MS : undefined);
    const state = draft.data;

    // Keep the league header in step when the draft finishes
    const lastStatus = useRef(league.status);
    useEffect(() => {
        if (state && state.status !== lastStatus.current) {
            lastStatus.current = state.status;
            void reloadLeague();
        }
    }, [state, reloadLeague]);

    if (draft.loading && !state) return <Spinner label="Loading the draft…" />;
    if (draft.error && !state) return <ErrorBanner error={draft.error} onRetry={draft.reload} />;
    if (!state) return null;

    if (state.status === "setup" || state.status === "registration") {
        return (
            <EmptyState testId="draft-not-started" title="The draft hasn't started yet">
                {league.me.canManage
                    ? "Approve your coaches on the Overview tab, then start the draft there."
                    : "The commissioner starts it once registration closes. This page updates live once it begins."}
            </EmptyState>
        );
    }

    return (
        <div className="space-y-6">
            <OnTheClock state={state} onChange={draft.reload} />
            <div className="grid gap-6 lg:grid-cols-3">
                <div className="lg:col-span-2">
                    {state.status === "drafting" ? <Available state={state} onPicked={draft.reload} /> : <FinalRosters state={state} />}
                </div>
                <div className="space-y-6">
                    <MyTeam state={state} />
                    <Teams state={state} />
                    <RecentPicks state={state} />
                </div>
            </div>
        </div>
    );
}

/** Milliseconds left until `deadline`, ticking. The server's clock is the truth, so a browser clock that's off doesn't matter. */
function useCountdown(deadline: string | null, serverTime: string): number | null {
    const [remaining, setRemaining] = useState<number | null>(null);
    useEffect(() => {
        if (!deadline) return;
        const offset = new Date(serverTime).getTime() - Date.now();
        const end = new Date(deadline).getTime();
        const tick = () => setRemaining(end - (Date.now() + offset));
        const first = setTimeout(tick, 0);
        const every = setInterval(tick, 250);
        return () => {
            clearTimeout(first);
            clearInterval(every);
        };
    }, [deadline, serverTime]);
    return deadline ? remaining : null;
}

function OnTheClock({ state, onChange }: { state: DraftState; onChange: () => Promise<void> }) {
    const toast = useToast();
    const [busy, setBusy] = useState(false);
    const remaining = useCountdown(state.current?.deadline ?? null, state.serverTime);

    if (state.status !== "drafting" || !state.current) {
        return (
            <div data-testid="draft-complete" className="rounded-xl border border-emerald-200 bg-emerald-50 px-6 py-5">
                <p className="text-lg font-bold text-emerald-900">The draft is complete</p>
                <p className="text-sm text-emerald-800">Every roster is full. Open a team to copy it into Pokémon Showdown.</p>
            </div>
        );
    }
    const c = state.current;
    const mine = state.me.isMyTurn;
    const urgent = remaining !== null && remaining < 10_000;

    async function skip() {
        setBusy(true);
        try {
            await post(`/leagues/${state.leagueId}/draft/skip`);
            toast.success(`${c.teamName}'s pick was skipped`);
            await onChange();
        } catch (err) {
            toast.error(err);
        } finally {
            setBusy(false);
        }
    }

    return (
        <div
            data-testid="draft-current"
            data-slot={c.slotNo}
            data-entry-id={c.entryId}
            className={`flex flex-wrap items-center justify-between gap-4 rounded-xl px-6 py-5 shadow-sm ${mine ? "pulse-ring bg-brand-600 text-white" : "border border-slate-200 bg-white"}`}
        >
            <div>
                <p className={`text-xs font-semibold uppercase tracking-wide ${mine ? "text-brand-100" : "text-slate-500"}`}>
                    Pick {c.slotNo} · Round {c.round} of {state.totalRounds}
                    {c.kind === "makeup" && " · makeup pick"}
                </p>
                <p className="mt-1 text-xl font-bold" data-testid="draft-on-the-clock">
                    {mine ? <span data-testid="draft-your-turn">You&apos;re on the clock!</span> : <>{c.teamName} is on the clock</>}
                </p>
            </div>
            <div className="flex items-center gap-4">
                {remaining !== null && (
                    <span
                        data-testid="draft-countdown"
                        className={`rounded-lg px-3 py-2 font-mono text-2xl font-bold tabular-nums ${
                            mine ? "bg-white/15" : urgent ? "bg-red-50 text-red-700" : "bg-slate-100 text-slate-800"
                        }`}
                    >
                        {formatCountdown(remaining)}
                    </span>
                )}
                {state.me.canManage && (
                    <Button variant="secondary" size="sm" loading={busy} onClick={skip} testId="draft-skip">
                        Skip this pick
                    </Button>
                )}
            </div>
        </div>
    );
}

function Available({ state, onPicked }: { state: DraftState; onPicked: () => Promise<void> }) {
    const toast = useToast();
    const [filters, setFilters] = useState({ q: "", type: "", sort: "points" });
    const [busy, setBusy] = useState<number | null>(null);
    const path = `/leagues/${state.leagueId}/pool${query({ ...filters, status: "available", pageSize: 40 })}`;
    const pool = useLoad(() => apiPage<PoolRowDto>(path), path);

    // Someone picked: refresh what's left
    const picksMade = state.picks.length;
    const reloadPool = pool.reload;
    useEffect(() => {
        void reloadPool();
    }, [picksMade, reloadPool]);

    const current = state.current!;
    const onClock = state.teams.find((t) => t.entryId === current.entryId);
    const cap = onClock?.maxForNextPick ?? 0;
    const canPick = state.me.isMyTurn || state.me.canManage;
    const pickingFor = !state.me.isMyTurn && state.me.canManage ? current.teamName : null;

    async function pick(row: PoolRowDto) {
        setBusy(row.pokemon.id);
        try {
            await post(`/leagues/${state.leagueId}/draft/picks`, { pokemonId: row.pokemon.id });
            toast.success(pickingFor ? `${pickingFor} drafted ${row.pokemon.name}` : `You drafted ${row.pokemon.name}!`);
            await onPicked();
        } catch (err) {
            toast.error(err);
            await Promise.all([onPicked(), pool.reload()]);
        } finally {
            setBusy(null);
        }
    }

    return (
        <Card testId="draft-available">
            <CardHeader
                title="Available Pokémon"
                subtitle={
                    canPick ? (
                        <>
                            {pickingFor ? `Picking for ${pickingFor}: ` : "Your pick: "}up to <strong data-testid="draft-max-points">{cap} points</strong>
                        </>
                    ) : (
                        `Wait for your turn. ${current.teamName} can spend up to ${cap} points.`
                    )
                }
            />
            <div className="flex flex-wrap gap-3 border-b border-slate-100 px-5 py-3">
                <Input
                    aria-label="Search"
                    placeholder="Search by name or #"
                    className="w-56"
                    testId="draft-search"
                    value={filters.q}
                    onChange={(e) => setFilters({ ...filters, q: e.target.value })}
                />
                <Select aria-label="Type" className="w-36" testId="draft-type" value={filters.type} onChange={(e) => setFilters({ ...filters, type: e.target.value })}>
                    <option value="">Any type</option>
                    {POKEMON_TYPES.map((t) => (
                        <option key={t} value={t}>
                            {t}
                        </option>
                    ))}
                </Select>
                <Select aria-label="Sort" className="w-40" testId="draft-sort" value={filters.sort} onChange={(e) => setFilters({ ...filters, sort: e.target.value })}>
                    <option value="points">Most points</option>
                    <option value="bst">Base stats</option>
                    <option value="name">Name</option>
                </Select>
            </div>
            {pool.loading && !pool.data ? (
                <Spinner />
            ) : pool.error ? (
                <div className="p-5">
                    <ErrorBanner error={pool.error} onRetry={pool.reload} />
                </div>
            ) : (
                <ul className="divide-y divide-slate-100" data-testid="draft-available-list">
                    {pool.data?.data.map((r) => {
                        const over = r.points > cap;
                        return (
                            <li key={r.pokemon.id} data-testid="draft-available-row" data-pokemon-id={r.pokemon.id} className="flex items-center gap-3 px-5 py-2">
                                <Sprite id={r.pokemon.id} name={r.pokemon.name} size={44} />
                                <div className="min-w-0 flex-1">
                                    <p className="truncate font-medium text-slate-900">
                                        {r.pokemon.name} <span className="text-xs font-normal text-slate-400">{dex(r.pokemon.id)}</span>
                                    </p>
                                    <div className="mt-0.5 flex items-center gap-2">
                                        <TypeBadges types={r.pokemon.types} />
                                        <span className="text-xs text-slate-500">BST {r.pokemon.bst}</span>
                                    </div>
                                </div>
                                <PointsBadge points={r.points} />
                                {canPick && (
                                    <Button
                                        size="sm"
                                        disabled={over || busy !== null}
                                        loading={busy === r.pokemon.id}
                                        title={over ? `Over budget: at most ${cap} points on this pick` : undefined}
                                        onClick={() => pick(r)}
                                        testId="draft-pick-button"
                                    >
                                        {over ? "Over budget" : "Draft"}
                                    </Button>
                                )}
                            </li>
                        );
                    })}
                    {pool.data?.data.length === 0 && <li className="px-5 py-8 text-center text-sm text-slate-500">No available Pokémon match.</li>}
                </ul>
            )}
        </Card>
    );
}

function MyTeam({ state }: { state: DraftState }) {
    const team = state.teams.find((t) => t.entryId === state.me.entryId);
    if (!team) return null;
    const roster = state.picks.filter((p) => p.entryId === team.entryId).sort((a, b) => a.slotNo - b.slotNo);
    return (
        <Card testId="draft-my-team">
            <CardHeader
                title={team.teamName}
                subtitle={`${team.picksMade}/${state.totalRounds} picked`}
                actions={
                    <Link href={`/leagues/${state.leagueId}/teams/${team.entryId}`} className="text-sm font-medium text-brand-700 hover:underline" data-testid="draft-my-team-link">
                        Open
                    </Link>
                }
            />
            <CardBody>
                <div className="mb-3 grid grid-cols-2 gap-3 text-center">
                    <div className="rounded-lg bg-slate-50 py-2">
                        <p className="text-[10px] uppercase text-slate-500">Budget left</p>
                        <p className="font-bold" data-testid="draft-my-budget">
                            {team.budgetLeft} pts
                        </p>
                    </div>
                    <div className="rounded-lg bg-slate-50 py-2">
                        <p className="text-[10px] uppercase text-slate-500">Max next pick</p>
                        <p className="font-bold" data-testid="draft-my-max">
                            {team.openSlots ? `${team.maxForNextPick} pts` : "—"}
                        </p>
                    </div>
                </div>
                {roster.length === 0 ? (
                    <p className="text-sm text-slate-500">No picks yet.</p>
                ) : (
                    <ul className="grid grid-cols-4 gap-2" data-testid="draft-my-roster">
                        {roster.map((p) => (
                            <li key={p.slotNo} className="flex flex-col items-center rounded-lg bg-slate-50 p-1 text-center" title={`${p.pokemon.name} (${p.points} pts)`}>
                                <Sprite id={p.pokemon.id} name={p.pokemon.name} size={40} />
                                <span className="w-full truncate text-[10px] text-slate-600">{p.pokemon.name}</span>
                            </li>
                        ))}
                    </ul>
                )}
            </CardBody>
        </Card>
    );
}

function Teams({ state }: { state: DraftState }) {
    const ordered = state.order.map((o) => state.teams.find((t) => t.entryId === o.entryId)!).filter(Boolean);
    return (
        <Card testId="draft-teams">
            <CardHeader title="Teams" subtitle="In draft order" />
            <table className="w-full text-sm">
                <thead className="bg-slate-50 text-left text-[11px] uppercase text-slate-500">
                    <tr>
                        <th className="px-4 py-2 font-medium">Team</th>
                        <th className="px-2 py-2 text-right font-medium">Picks</th>
                        <th className="px-4 py-2 text-right font-medium">Left</th>
                    </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                    {ordered.map((t) => (
                        <tr key={t.entryId} data-testid="draft-team-row" data-entry-id={t.entryId} className={state.current?.entryId === t.entryId ? "bg-brand-50" : ""}>
                            <td className="px-4 py-2">
                                <Link href={`/leagues/${state.leagueId}/teams/${t.entryId}`} className="font-medium text-slate-900 hover:text-brand-700">
                                    {t.teamName}
                                </Link>
                                <span className="block text-xs text-slate-500">{t.coach.displayName}</span>
                            </td>
                            <td className="px-2 py-2 text-right tabular-nums">
                                {t.picksMade}/{state.totalRounds}
                            </td>
                            <td className="px-4 py-2 text-right tabular-nums" data-testid="draft-team-budget">
                                {t.budgetLeft}
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>
            {state.upcoming.length > 0 && (
                <div className="border-t border-slate-100 px-4 py-3">
                    <p className="mb-2 text-xs font-semibold uppercase text-slate-500">Up next</p>
                    <ol className="space-y-1 text-sm" data-testid="draft-upcoming">
                        {state.upcoming.slice(0, 5).map((u) => (
                            <li key={u.slotNo} className="flex justify-between text-slate-600">
                                <span>
                                    {u.slotNo}. {u.teamName}
                                </span>
                                {u.kind === "makeup" && <Badge tone="amber">makeup</Badge>}
                            </li>
                        ))}
                    </ol>
                </div>
            )}
        </Card>
    );
}

function RecentPicks({ state }: { state: DraftState }) {
    return (
        <Card testId="draft-picks-log">
            <CardHeader title="Picks" subtitle={`${state.picks.length} made`} />
            {state.picks.length === 0 && state.skipped.length === 0 ? (
                <p className="px-5 py-4 text-sm text-slate-500">No picks yet.</p>
            ) : (
                <ol className="max-h-96 divide-y divide-slate-100 overflow-y-auto">
                    {state.picks.map((p) => (
                        <li key={p.slotNo} data-testid="draft-pick" data-slot={p.slotNo} className="flex items-center gap-3 px-4 py-2">
                            <span className="w-6 text-right text-xs font-semibold text-slate-400">{p.slotNo}</span>
                            <Sprite id={p.pokemon.id} name={p.pokemon.name} size={32} />
                            <div className="min-w-0 flex-1 text-sm">
                                <p className="truncate font-medium text-slate-900">{p.pokemon.name}</p>
                                <p className="truncate text-xs text-slate-500">
                                    {p.teamName}
                                    {p.pickedBy === "timer" && " · auto-pick"}
                                    {p.pickedBy === "commissioner" && " · by commissioner"}
                                </p>
                            </div>
                            <span className="text-xs font-semibold text-slate-600">{p.points}</span>
                        </li>
                    ))}
                </ol>
            )}
            {state.skipped.length > 0 && (
                <p className="border-t border-slate-100 px-4 py-2 text-xs text-amber-700" data-testid="draft-skipped">
                    Skipped: {state.skipped.map((s) => `#${s.slotNo} ${s.teamName}`).join(", ")}
                </p>
            )}
        </Card>
    );
}

function FinalRosters({ state }: { state: DraftState }) {
    return (
        <div className="grid gap-4 sm:grid-cols-2" data-testid="draft-final-rosters">
            {state.order.map((o) => {
                const roster = state.picks.filter((p) => p.entryId === o.entryId).sort((a, b) => a.slotNo - b.slotNo);
                const team = state.teams.find((t) => t.entryId === o.entryId);
                return (
                    <Card key={o.entryId}>
                        <CardHeader
                            title={
                                <Link href={`/leagues/${state.leagueId}/teams/${o.entryId}`} className="hover:text-brand-700">
                                    {o.teamName}
                                </Link>
                            }
                            subtitle={`${o.coach.displayName} · ${team?.spent ?? 0}/${state.settings.budget} pts`}
                        />
                        <CardBody>
                            <ul className="grid grid-cols-4 gap-2">
                                {roster.map((p) => (
                                    <li key={p.slotNo} className="flex flex-col items-center text-center" title={`${p.pokemon.name} (${p.points} pts)`}>
                                        <Sprite id={p.pokemon.id} name={p.pokemon.name} size={44} />
                                        <span className="w-full truncate text-[10px] text-slate-600">{p.pokemon.name}</span>
                                    </li>
                                ))}
                            </ul>
                        </CardBody>
                    </Card>
                );
            })}
        </div>
    );
}
