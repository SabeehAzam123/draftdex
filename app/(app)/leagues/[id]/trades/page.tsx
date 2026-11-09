"use client";

import { useState } from "react";
import { useLeague } from "@/components/league-context";
import { Sprite } from "@/components/pokemon";
import { Badge, type Tone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { EmptyState, ErrorBanner, Spinner } from "@/components/ui/feedback";
import { Field, Input, Select } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";
import { get, post } from "@/lib/client/api";
import { formatDate } from "@/lib/client/format";
import { useLoad } from "@/lib/client/use-api";
import type { TradeStatus } from "@/lib/domain/enums";
import type { EntryDto } from "@/lib/services/entries";
import type { TeamDto } from "@/lib/services/teams";
import type { TradeDto, TradeMon } from "@/lib/services/trades";

const STATUS: Record<TradeStatus, { label: string; tone: Tone }> = {
    proposed: { label: "Waiting for the other coach", tone: "amber" },
    accepted: { label: "Waiting for the commissioner", tone: "blue" },
    approved: { label: "Done", tone: "green" },
    rejected: { label: "Rejected by the commissioner", tone: "red" },
    declined: { label: "Declined", tone: "slate" },
    cancelled: { label: "Cancelled", tone: "slate" },
};

export default function TradesPage() {
    const { league } = useLeague();
    const toast = useToast();
    const tradesLoad = useLoad(() => get<TradeDto[]>(`/leagues/${league.id}/trades`), league.id);
    const [busy, setBusy] = useState<string | null>(null);
    const myEntry = league.me.entry?.status === "approved" ? league.me.entry : null;
    const canPropose = league.status === "season" && !!myEntry;

    async function act(t: TradeDto, action: string, message: string) {
        setBusy(`${t.id}-${action}`);
        try {
            await post(`/leagues/${league.id}/trades/${t.id}/${action}`);
            toast.success(message);
            await tradesLoad.reload();
        } catch (err) {
            toast.error(err);
        } finally {
            setBusy(null);
        }
    }

    return (
        <div className="grid gap-6 lg:grid-cols-5">
            <div className="lg:col-span-3">
                {tradesLoad.loading && !tradesLoad.data ? (
                    <Spinner />
                ) : tradesLoad.error ? (
                    <ErrorBanner error={tradesLoad.error} onRetry={tradesLoad.reload} />
                ) : tradesLoad.data!.length === 0 ? (
                    <EmptyState testId="trades-empty" title="No trades yet">
                        Coaches can swap Pokémon during the season. The commissioner approves each trade.
                    </EmptyState>
                ) : (
                    <ul className="space-y-4" data-testid="trades-list">
                        {tradesLoad.data!.map((t) => (
                            <li key={t.id} data-testid="trade-row" data-trade-id={t.id} data-status={t.status}>
                                <Card>
                                    <CardBody>
                                        <div className="flex flex-wrap items-center justify-between gap-2">
                                            <p className="text-sm text-slate-600">
                                                <strong className="text-slate-900">{t.from.teamName}</strong> → <strong className="text-slate-900">{t.to.teamName}</strong>
                                                <span className="ml-2 text-xs text-slate-400">{formatDate(t.createdAt)}</span>
                                            </p>
                                            <Badge tone={STATUS[t.status].tone} testId="trade-status">
                                                {STATUS[t.status].label}
                                            </Badge>
                                        </div>
                                        <div className="mt-3 grid grid-cols-2 gap-3">
                                            <MonList title={`${t.from.teamName} gives`} mons={t.give} testId="trade-give" />
                                            <MonList title={`${t.to.teamName} gives`} mons={t.get} testId="trade-get" />
                                        </div>
                                        {t.note && <p className="mt-3 text-sm italic text-slate-500">&ldquo;{t.note}&rdquo;</p>}
                                        <div className="mt-3 flex flex-wrap gap-2">
                                            {t.me.canAccept && (
                                                <Button size="sm" variant="success" loading={busy === `${t.id}-accept`} onClick={() => act(t, "accept", "Trade accepted: the commissioner will review it")} testId="trade-accept">
                                                    Accept
                                                </Button>
                                            )}
                                            {t.me.canDecline && (
                                                <Button size="sm" variant="secondary" loading={busy === `${t.id}-decline`} onClick={() => act(t, "decline", "Trade declined")} testId="trade-decline">
                                                    Decline
                                                </Button>
                                            )}
                                            {t.me.canCancel && (
                                                <Button size="sm" variant="ghost" loading={busy === `${t.id}-cancel`} onClick={() => act(t, "cancel", "Trade cancelled")} testId="trade-cancel">
                                                    Cancel
                                                </Button>
                                            )}
                                            {t.me.canApprove && (
                                                <Button size="sm" loading={busy === `${t.id}-approve`} onClick={() => act(t, "approve", "Trade approved: the Pokémon have changed teams")} testId="trade-approve">
                                                    Approve
                                                </Button>
                                            )}
                                            {t.me.canReject && (
                                                <Button size="sm" variant="secondary" loading={busy === `${t.id}-reject`} onClick={() => act(t, "reject", "Trade rejected")} testId="trade-reject">
                                                    Reject
                                                </Button>
                                            )}
                                        </div>
                                    </CardBody>
                                </Card>
                            </li>
                        ))}
                    </ul>
                )}
            </div>
            <div className="lg:col-span-2">
                {canPropose ? (
                    <ProposeTrade myEntryId={myEntry.id} onDone={tradesLoad.reload} />
                ) : (
                    <Card>
                        <CardBody>
                            <p className="text-sm text-slate-500" data-testid="trades-cannot-propose">
                                {league.status === "season" ? "Only coaches in this league can propose trades." : "Trading is closed: the season is over."}
                            </p>
                        </CardBody>
                    </Card>
                )}
            </div>
        </div>
    );
}

function MonList({ title, mons, testId }: { title: string; mons: TradeMon[]; testId: string }) {
    return (
        <div className="rounded-lg bg-slate-50 p-3" data-testid={testId}>
            <p className="mb-2 text-xs font-semibold uppercase text-slate-500">{title}</p>
            <ul className="space-y-1">
                {mons.map((m) => (
                    <li key={m.id} className="flex items-center gap-2 text-sm" data-pokemon-id={m.id}>
                        <Sprite id={m.id} name={m.name} size={32} />
                        <span className="flex-1">{m.name}</span>
                        <span className="text-xs text-slate-500">{m.points} pts</span>
                    </li>
                ))}
            </ul>
        </div>
    );
}

function ProposeTrade({ myEntryId, onDone }: { myEntryId: string; onDone: () => Promise<void> }) {
    const { league } = useLeague();
    const toast = useToast();
    const others = useLoad(() => get<EntryDto[]>(`/leagues/${league.id}/entries`), league.id);
    const [partner, setPartner] = useState("");
    const mine = useLoad(() => get<TeamDto>(`/leagues/${league.id}/teams/${myEntryId}`), myEntryId);
    const theirs = useLoad(() => get<TeamDto>(`/leagues/${league.id}/teams/${partner}`), partner || null);
    const [give, setGive] = useState<number[]>([]);
    const [want, setWant] = useState<number[]>([]);
    const [note, setNote] = useState("");
    const [busy, setBusy] = useState(false);
    const toggle = (list: number[], set: (l: number[]) => void, id: number) => set(list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
    const partners = (others.data ?? []).filter((e) => e.status === "approved" && e.id !== myEntryId);

    async function submit() {
        setBusy(true);
        try {
            await post(`/leagues/${league.id}/trades`, { toEntryId: partner, give, get: want, ...(note.trim() ? { note: note.trim() } : {}) });
            toast.success("Trade offered");
            setGive([]);
            setWant([]);
            setNote("");
            await onDone();
        } catch (err) {
            toast.error(err);
        } finally {
            setBusy(false);
        }
    }

    return (
        <Card testId="trade-propose">
            <CardHeader title="Propose a trade" subtitle="Swap the same number of Pokémon each way (1 to 3). Both teams must stay within the budget." />
            <CardBody className="space-y-4">
                <Field label="Trade with" htmlFor="trade-partner" testId="trade-partner">
                    <Select
                        id="trade-partner"
                        testId="trade-partner"
                        value={partner}
                        onChange={(e) => {
                            setPartner(e.target.value);
                            setWant([]);
                        }}
                    >
                        <option value="">Choose a team…</option>
                        {partners.map((e) => (
                            <option key={e.id} value={e.id}>
                                {e.teamName} ({e.coach.displayName})
                            </option>
                        ))}
                    </Select>
                </Field>
                <Picker title="You give" team={mine.data} selected={give} onToggle={(id) => toggle(give, setGive, id)} testId="trade-pick-give" />
                {partner && <Picker title="You get" team={theirs.data} selected={want} onToggle={(id) => toggle(want, setWant, id)} testId="trade-pick-get" />}
                <Field label="Note (optional)" htmlFor="trade-note" testId="trade-note">
                    <Input id="trade-note" testId="trade-note" value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} />
                </Field>
                <Button className="w-full" disabled={!partner || give.length === 0 || give.length !== want.length} loading={busy} onClick={submit} testId="trade-submit">
                    {give.length && give.length === want.length ? `Offer ${give.length}-for-${want.length}` : "Pick the same number each way"}
                </Button>
            </CardBody>
        </Card>
    );
}

function Picker({ title, team, selected, onToggle, testId }: { title: string; team: TeamDto | null; selected: number[]; onToggle: (id: number) => void; testId: string }) {
    if (!team) return <Spinner />;
    return (
        <fieldset data-testid={testId}>
            <legend className="mb-2 text-sm font-medium text-slate-700">{title}</legend>
            <ul className="grid grid-cols-2 gap-2">
                {team.roster.map((r) => (
                    <li key={r.pokemon.id}>
                        <label className={`flex cursor-pointer items-center gap-2 rounded-lg border px-2 py-1 text-sm ${selected.includes(r.pokemon.id) ? "border-brand-500 bg-brand-50" : "border-slate-200"}`}>
                            <input type="checkbox" data-pokemon-id={r.pokemon.id} checked={selected.includes(r.pokemon.id)} onChange={() => onToggle(r.pokemon.id)} className="accent-brand-600" />
                            <Sprite id={r.pokemon.id} name={r.pokemon.name} size={28} />
                            <span className="flex-1 truncate">{r.pokemon.name}</span>
                            <span className="text-xs text-slate-500">{r.points}</span>
                        </label>
                    </li>
                ))}
            </ul>
        </fieldset>
    );
}
