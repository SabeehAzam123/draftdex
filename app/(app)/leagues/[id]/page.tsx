"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { useSession } from "@/components/app-shell";
import { useLeague } from "@/components/league-context";
import { EntryStatusBadge } from "@/components/ui/badge";
import { Button, LinkButton } from "@/components/ui/button";
import { Card, CardBody, CardHeader, Stat } from "@/components/ui/card";
import { ErrorBanner, Spinner } from "@/components/ui/feedback";
import { Field, Input } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";
import { fieldErrors, get, post } from "@/lib/client/api";
import { credits, formatShortDate, formatTimer } from "@/lib/client/format";
import { useLoad } from "@/lib/client/use-api";
import type { LeagueStatus } from "@/lib/domain/enums";
import type { EntryDto } from "@/lib/services/entries";

const STEPS: { status: LeagueStatus; label: string }[] = [
    { status: "setup", label: "Set up" },
    { status: "registration", label: "Registration" },
    { status: "drafting", label: "Draft" },
    { status: "season", label: "Season" },
    { status: "completed", label: "Done" },
];

export default function LeagueOverviewPage() {
    const { league, reload: reloadLeague } = useLeague();
    const entries = useLoad(() => get<EntryDto[]>(`/leagues/${league.id}/entries`), league.id);
    const reloadAll = async () => {
        await Promise.all([reloadLeague(), entries.reload()]);
    };

    return (
        <div className="grid gap-6 lg:grid-cols-3">
            <div className="space-y-6 lg:col-span-2">
                <Progress status={league.status} />
                <Actions entries={entries.data ?? []} onChange={reloadAll} />
                <Card testId="entries-card">
                    <CardHeader title="Coaches" subtitle={`${league.counts.approved} approved · ${league.counts.pending} waiting`} />
                    {entries.loading && !entries.data ? (
                        <Spinner />
                    ) : entries.error ? (
                        <CardBody>
                            <ErrorBanner error={entries.error} onRetry={entries.reload} />
                        </CardBody>
                    ) : (
                        <EntriesTable entries={entries.data ?? []} onChange={reloadAll} />
                    )}
                </Card>
            </div>
            <Rules />
        </div>
    );
}

function Progress({ status }: { status: LeagueStatus }) {
    if (status === "cancelled") {
        return (
            <div data-testid="league-cancelled" className="rounded-xl border border-red-200 bg-red-50 px-5 py-4 text-sm text-red-800">
                This league was cancelled. Every entry fee was refunded.
            </div>
        );
    }
    const at = STEPS.findIndex((s) => s.status === status);
    return (
        <ol data-testid="league-progress" className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
            {STEPS.map((s, i) => (
                <li key={s.status} className="flex flex-1 items-center gap-2" data-step={s.status} data-state={i < at ? "done" : i === at ? "current" : "todo"}>
                    <span
                        className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                            i < at ? "bg-brand-600 text-white" : i === at ? "bg-brand-100 text-brand-700 ring-2 ring-brand-500" : "bg-slate-100 text-slate-400"
                        }`}
                    >
                        {i < at ? "✓" : i + 1}
                    </span>
                    <span className={`text-xs font-medium ${i === at ? "text-slate-900" : "text-slate-500"}`}>{s.label}</span>
                    {i < STEPS.length - 1 && <span className="h-px flex-1 bg-slate-200" />}
                </li>
            ))}
        </ol>
    );
}

function Actions({ entries, onChange }: { entries: EntryDto[]; onChange: () => Promise<void> }) {
    const { league } = useLeague();
    const { balance, refreshBalance } = useSession();
    const toast = useToast();
    const [busy, setBusy] = useState<string | null>(null);
    const [confirmCancel, setConfirmCancel] = useState(false);
    const [startOpen, setStartOpen] = useState(false);
    const [order, setOrder] = useState<"random" | "listed">("random");
    const [teamName, setTeamName] = useState("");
    const [applyErrors, setApplyErrors] = useState<Record<string, string>>({});
    const mine = league.me.entry;
    const approved = entries.filter((e) => e.status === "approved");

    async function act(key: string, fn: () => Promise<unknown>, success: string) {
        setBusy(key);
        try {
            await fn();
            toast.success(success);
            refreshBalance();
            await onChange();
        } catch (err) {
            toast.error(err);
        } finally {
            setBusy(null);
        }
    }

    async function apply(e: FormEvent) {
        e.preventDefault();
        setApplyErrors({});
        setBusy("apply");
        try {
            await post(`/leagues/${league.id}/entries`, { teamName });
            toast.success("Application sent. The commissioner will review it.");
            refreshBalance();
            await onChange();
        } catch (err) {
            setApplyErrors(fieldErrors(err));
            toast.error(err);
        } finally {
            setBusy(null);
        }
    }

    const items: React.ReactNode[] = [];

    if (league.me.canManage && league.status === "setup") {
        items.push(
            <div key="open" className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-sm text-slate-600">Check the rules and the tier list, then let coaches apply.</p>
                <Button testId="league-open-registration" loading={busy === "open"} onClick={() => act("open", () => post(`/leagues/${league.id}/open-registration`), "Registration is open")}>
                    Open registration
                </Button>
            </div>,
        );
    }
    if (league.me.canManage && league.status === "registration") {
        items.push(
            <div key="start" className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-sm text-slate-600">
                    {league.counts.pending > 0
                        ? `Review the ${league.counts.pending} waiting application(s) before the draft.`
                        : `${league.counts.approved} coaches are in. Start the draft when everyone is ready.`}
                </p>
                <Button testId="league-start-draft" disabled={league.counts.approved < 2} onClick={() => setStartOpen(true)}>
                    Start draft
                </Button>
            </div>,
        );
    }
    if (league.status === "registration" && (!mine || mine.status === "rejected" || mine.status === "withdrawn")) {
        const fee = league.settings.entryFee;
        items.push(
            <form key="apply" onSubmit={apply} noValidate className="space-y-3" data-testid="league-apply-form">
                <p className="text-sm text-slate-600">
                    {mine ? "You can apply again." : "Want in?"} Pick a team name.{" "}
                    {fee > 0 ? (
                        <>
                            The entry fee is <strong>{credits(fee)}</strong>
                            {balance !== null && <> (you have {credits(balance)})</>}, refunded if you leave before the draft.
                        </>
                    ) : (
                        "This league is free."
                    )}
                </p>
                <div className="flex flex-wrap items-start gap-3">
                    <div className="min-w-56 flex-1">
                        <Field label="Team name" htmlFor="apply-team" error={applyErrors.teamName} testId="league-apply-team-name">
                            <Input id="apply-team" testId="league-apply-team-name" value={teamName} onChange={(e) => setTeamName(e.target.value)} invalid={!!applyErrors.teamName} />
                        </Field>
                    </div>
                    <Button type="submit" className="mt-6" loading={busy === "apply"} testId="league-apply-submit">
                        Apply{fee > 0 ? ` · ${credits(fee)}` : ""}
                    </Button>
                </div>
            </form>,
        );
    }
    if (mine && league.status === "registration" && (mine.status === "pending" || mine.status === "approved")) {
        items.push(
            <div key="withdraw" className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-sm text-slate-600" data-testid="league-my-entry">
                    You&apos;re in as <strong>{mine.teamName}</strong> ({mine.status}).
                </p>
                <Button
                    variant="secondary"
                    testId="league-withdraw"
                    loading={busy === "withdraw"}
                    onClick={() => act("withdraw", () => post(`/leagues/${league.id}/entries/${mine.id}/withdraw`), "You've left the league; your fee was refunded")}
                >
                    Withdraw
                </Button>
            </div>,
        );
    }
    if (league.status === "drafting" || league.status === "season") {
        items.push(
            <div key="draft" className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-sm text-slate-600">
                    {league.status === "drafting" ? "The draft is live." : "The draft is complete. Check out the rosters."}
                    {mine?.status === "approved" && (
                        <>
                            {" "}
                            You&apos;re <strong>{mine.teamName}</strong>.
                        </>
                    )}
                </p>
                <div className="flex gap-2">
                    {mine?.status === "approved" && (
                        <LinkButton variant="secondary" href={`/leagues/${league.id}/teams/${mine.id}`} testId="league-my-team">
                            My team
                        </LinkButton>
                    )}
                    <LinkButton href={`/leagues/${league.id}/draft`} testId="league-go-draft">
                        {league.status === "drafting" ? "Go to the draft" : "Draft results"}
                    </LinkButton>
                </div>
            </div>,
        );
    }
    // The destructive action goes last
    if (league.me.canManage && (league.status === "setup" || league.status === "registration")) {
        items.push(
            <div key="cancel" className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-4">
                <p className="text-sm text-slate-500">Cancelling refunds every entry fee. It can&apos;t be undone.</p>
                <Button variant="secondary" testId="league-cancel" onClick={() => setConfirmCancel(true)}>
                    Cancel league
                </Button>
            </div>,
        );
    }

    return (
        <>
            {items.length > 0 && (
                <Card testId="league-actions">
                    <CardBody className="space-y-4">{items}</CardBody>
                </Card>
            )}

            <Modal
                open={confirmCancel}
                title="Cancel this league?"
                onClose={() => setConfirmCancel(false)}
                testId="league-cancel-modal"
                footer={
                    <>
                        <Button variant="secondary" onClick={() => setConfirmCancel(false)} testId="league-cancel-keep">
                            Keep it
                        </Button>
                        <Button
                            variant="danger"
                            testId="league-cancel-confirm"
                            loading={busy === "cancel"}
                            onClick={async () => {
                                await act("cancel", () => post(`/leagues/${league.id}/cancel`), "League cancelled and fees refunded");
                                setConfirmCancel(false);
                            }}
                        >
                            Cancel league
                        </Button>
                    </>
                }
            >
                <p className="text-sm text-slate-600">
                    {league.counts.approved + league.counts.pending} coach(es) will get their entry fee back. This can&apos;t be undone.
                </p>
            </Modal>

            <Modal
                open={startOpen}
                title="Start the draft"
                onClose={() => setStartOpen(false)}
                testId="start-draft-modal"
                footer={
                    <>
                        <Button variant="secondary" onClick={() => setStartOpen(false)}>
                            Not yet
                        </Button>
                        <Button
                            testId="start-draft-confirm"
                            loading={busy === "start"}
                            onClick={async () => {
                                await act(
                                    "start",
                                    () => post(`/leagues/${league.id}/start-draft`, order === "listed" ? { order: approved.map((e) => e.id) } : {}),
                                    "The draft has started",
                                );
                                setStartOpen(false);
                            }}
                        >
                            Start draft
                        </Button>
                    </>
                }
            >
                <p className="text-sm text-slate-600">
                    {league.settings.rosterSize} rounds, snake order, {league.settings.budget} points per coach
                    {league.settings.pickTimerSeconds ? `, ${formatTimer(league.settings.pickTimerSeconds)} per pick` : ""}. The tier list and rules lock once it starts.
                </p>
                <fieldset className="mt-4 space-y-2 text-sm">
                    <legend className="mb-1 font-medium text-slate-800">Draft order</legend>
                    <label className="flex items-center gap-2">
                        <input type="radio" name="order" data-testid="start-draft-order-random" checked={order === "random"} onChange={() => setOrder("random")} />
                        Random
                    </label>
                    <label className="flex items-center gap-2">
                        <input type="radio" name="order" data-testid="start-draft-order-listed" checked={order === "listed"} onChange={() => setOrder("listed")} />
                        As listed: {approved.map((e) => e.teamName).join(" → ")}
                    </label>
                </fieldset>
            </Modal>
        </>
    );
}

function EntriesTable({ entries, onChange }: { entries: EntryDto[]; onChange: () => Promise<void> }) {
    const { league } = useLeague();
    const toast = useToast();
    const [busy, setBusy] = useState<string | null>(null);
    const canDecide = league.me.canManage && league.status === "registration";
    const showRoster = league.status === "drafting" || league.status === "season" || league.status === "completed";

    async function decide(entry: EntryDto, action: "approve" | "reject") {
        setBusy(`${action}-${entry.id}`);
        try {
            await post(`/leagues/${league.id}/entries/${entry.id}/${action}`);
            toast.success(action === "approve" ? `${entry.teamName} approved` : `${entry.teamName} rejected; fee refunded`);
            await onChange();
        } catch (err) {
            toast.error(err);
        } finally {
            setBusy(null);
        }
    }

    if (entries.length === 0) {
        return <p className="px-5 py-8 text-center text-sm text-slate-500" data-testid="entries-empty">No coaches yet.</p>;
    }
    return (
        <div className="overflow-x-auto">
            <table className="w-full text-sm" data-testid="entries-table">
                <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                    <tr>
                        <th className="px-5 py-2 font-medium">Team</th>
                        <th className="px-5 py-2 font-medium">Coach</th>
                        <th className="px-5 py-2 font-medium">Status</th>
                        <th className="px-5 py-2 font-medium">Applied</th>
                        {canDecide && <th className="px-5 py-2" />}
                    </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                    {entries.map((e) => (
                        <tr key={e.id} data-testid="entry-row" data-entry-id={e.id} data-status={e.status}>
                            <td className="px-5 py-3 font-medium text-slate-900" data-testid="entry-team">
                                {showRoster && e.status === "approved" ? (
                                    <Link href={`/leagues/${league.id}/teams/${e.id}`} className="text-brand-700 hover:underline">
                                        {e.teamName}
                                    </Link>
                                ) : (
                                    e.teamName
                                )}
                            </td>
                            <td className="px-5 py-3 text-slate-600" data-testid="entry-coach">
                                {e.coach.displayName}
                            </td>
                            <td className="px-5 py-3">
                                <EntryStatusBadge status={e.status} testId="entry-status" />
                            </td>
                            <td className="px-5 py-3 text-slate-500">{formatShortDate(e.createdAt)}</td>
                            {canDecide && (
                                <td className="px-5 py-3 text-right">
                                    {e.status === "pending" && (
                                        <span className="inline-flex gap-2">
                                            <Button size="sm" variant="success" testId="entry-approve" loading={busy === `approve-${e.id}`} onClick={() => decide(e, "approve")}>
                                                Approve
                                            </Button>
                                            <Button size="sm" variant="secondary" testId="entry-reject" loading={busy === `reject-${e.id}`} onClick={() => decide(e, "reject")}>
                                                Reject
                                            </Button>
                                        </span>
                                    )}
                                </td>
                            )}
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}

function Rules() {
    const { league } = useLeague();
    const s = league.settings;
    return (
        <Card testId="league-rules">
            <CardHeader title="Rules" />
            <CardBody>
                <dl className="grid grid-cols-2 gap-4">
                    <Stat label="Budget" value={`${s.budget} pts`} testId="rule-budget" />
                    <Stat label="Roster" value={`${s.rosterSize} Pokémon`} testId="rule-roster" />
                    <Stat label="Pick timer" value={formatTimer(s.pickTimerSeconds)} testId="rule-timer" />
                    <Stat label="Max coaches" value={s.maxCoaches} testId="rule-max-coaches" />
                    <Stat label="Entry fee" value={s.entryFee ? credits(s.entryFee) : "Free"} testId="rule-entry-fee" />
                    <Stat label="Prize split" value={s.prizeSplit.map((p) => `${p}%`).join(" / ")} testId="rule-prize-split" />
                </dl>
                <p className="mt-4 text-xs text-slate-500">
                    Snake draft: the order reverses every round. You always keep enough points to fill your roster with the cheapest Pokémon.
                </p>
            </CardBody>
        </Card>
    );
}
