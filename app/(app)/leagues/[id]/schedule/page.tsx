"use client";

import { useState } from "react";
import { useLeague } from "@/components/league-context";
import { Badge, type Tone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { EmptyState, ErrorBanner, Spinner } from "@/components/ui/feedback";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";
import { fieldErrors, get, post } from "@/lib/client/api";
import { useLoad } from "@/lib/client/use-api";
import type { MatchStatus } from "@/lib/domain/enums";
import type { MatchDto, ScheduleDto } from "@/lib/services/season";

const STATUS: Record<MatchStatus, { label: string; tone: Tone }> = {
    scheduled: { label: "To play", tone: "slate" },
    reported: { label: "Awaiting confirmation", tone: "amber" },
    confirmed: { label: "Confirmed", tone: "green" },
    disputed: { label: "Disputed", tone: "red" },
    resolved: { label: "Decided by commissioner", tone: "violet" },
};

type Dialog = { kind: "report" | "resolve" | "dispute"; match: MatchDto } | null;

export default function SchedulePage() {
    const { league, reload: reloadLeague } = useLeague();
    const toast = useToast();
    const schedule = useLoad(() => get<ScheduleDto>(`/leagues/${league.id}/schedule`), league.id);
    const [dialog, setDialog] = useState<Dialog>(null);
    const [busy, setBusy] = useState<string | null>(null);

    async function confirm(m: MatchDto) {
        setBusy(m.id);
        try {
            await post(`/leagues/${league.id}/matches/${m.id}/confirm`);
            toast.success("Result confirmed");
            await schedule.reload();
        } catch (err) {
            toast.error(err);
        } finally {
            setBusy(null);
        }
    }

    if (schedule.loading && !schedule.data) return <Spinner label="Loading the schedule…" />;
    if (schedule.error) return <ErrorBanner error={schedule.error} onRetry={schedule.reload} />;
    const data = schedule.data!;
    if (data.weeks.length === 0) return <EmptyState testId="schedule-empty" title="No matches yet">The schedule is made when the draft ends.</EmptyState>;

    return (
        <div className="space-y-6">
            <p className="text-sm text-slate-600" data-testid="schedule-summary">
                Best of three. A coach reports the score, the opponent confirms or disputes, and the commissioner settles disputes.{" "}
                {data.openMatches > 0 ? <strong>{data.openMatches} match(es) still open.</strong> : <strong>Every match is decided.</strong>}
            </p>
            {data.weeks.map((w) => (
                <Card key={w.week} testId="schedule-week">
                    <CardHeader title={`Week ${w.week}`} />
                    <ul className="divide-y divide-slate-100">
                        {w.matches.map((m) => (
                            <li key={m.id} data-testid="match-row" data-match-id={m.id} data-status={m.status} className={`px-5 py-4 ${m.me.side ? "bg-brand-50/40" : ""}`}>
                                <div className="flex flex-wrap items-center gap-4">
                                    <div className="flex min-w-64 flex-1 items-center gap-3 text-sm">
                                        <TeamSide team={m.home} winner={m.winnerEntryId === m.home.entryId} />
                                        <span className="rounded-md bg-slate-100 px-3 py-1 font-mono font-bold tabular-nums text-slate-800" data-testid="match-score">
                                            {m.homeWins === null ? "vs" : `${m.homeWins} – ${m.awayWins}`}
                                        </span>
                                        <TeamSide team={m.away} winner={m.winnerEntryId === m.away.entryId} />
                                    </div>
                                    <Badge tone={STATUS[m.status].tone} testId="match-status">
                                        {STATUS[m.status].label}
                                    </Badge>
                                    <div className="flex flex-wrap gap-2">
                                        {m.me.canReport && (
                                            <Button size="sm" onClick={() => setDialog({ kind: "report", match: m })} testId="match-report">
                                                Report result
                                            </Button>
                                        )}
                                        {m.me.canConfirm && (
                                            <Button size="sm" variant="success" loading={busy === m.id} onClick={() => confirm(m)} testId="match-confirm">
                                                Confirm
                                            </Button>
                                        )}
                                        {m.me.canDispute && (
                                            <Button size="sm" variant="secondary" onClick={() => setDialog({ kind: "dispute", match: m })} testId="match-dispute">
                                                Dispute
                                            </Button>
                                        )}
                                        {m.me.canResolve && (
                                            <Button size="sm" variant="secondary" onClick={() => setDialog({ kind: "resolve", match: m })} testId="match-resolve">
                                                Set result
                                            </Button>
                                        )}
                                    </div>
                                </div>
                                {(m.replayUrl || m.disputeReason) && (
                                    <div className="mt-2 flex flex-wrap gap-4 text-xs text-slate-500">
                                        {m.replayUrl && (
                                            <a href={m.replayUrl} target="_blank" rel="noreferrer" className="font-medium text-brand-700 hover:underline" data-testid="match-replay">
                                                Watch the replay ↗
                                            </a>
                                        )}
                                        {m.disputeReason && <span data-testid="match-dispute-reason">Disputed: &ldquo;{m.disputeReason}&rdquo;</span>}
                                    </div>
                                )}
                            </li>
                        ))}
                    </ul>
                </Card>
            ))}
            <ResultDialog
                dialog={dialog}
                leagueId={league.id}
                onClose={() => setDialog(null)}
                onDone={async (message) => {
                    setDialog(null);
                    toast.success(message);
                    await Promise.all([schedule.reload(), reloadLeague()]);
                }}
            />
        </div>
    );
}

function TeamSide({ team, winner }: { team: MatchDto["home"]; winner: boolean }) {
    return (
        <span className="min-w-0 flex-1">
            <span className={`block truncate ${winner ? "font-bold text-slate-900" : "font-medium text-slate-700"}`}>{team.teamName}</span>
            <span className="block truncate text-xs text-slate-400">{team.coach.displayName}</span>
        </span>
    );
}

function ResultDialog({ dialog, leagueId, onClose, onDone }: { dialog: Dialog; leagueId: string; onClose: () => void; onDone: (message: string) => Promise<void> }) {
    const toast = useToast();
    const [homeWins, setHomeWins] = useState("2");
    const [awayWins, setAwayWins] = useState("0");
    const [replayUrl, setReplayUrl] = useState("");
    const [reason, setReason] = useState("");
    const [errors, setErrors] = useState<Record<string, string>>({});
    const [busy, setBusy] = useState(false);
    if (!dialog) return null;
    const m = dialog.match;

    async function submit() {
        setBusy(true);
        setErrors({});
        try {
            if (dialog!.kind === "dispute") {
                await post(`/leagues/${leagueId}/matches/${m.id}/dispute`, { reason });
                await onDone("Result disputed: the commissioner will decide");
            } else {
                const body = { homeWins: Number(homeWins), awayWins: Number(awayWins), ...(dialog!.kind === "report" ? { replayUrl: replayUrl.trim() || null } : {}) };
                await post(`/leagues/${leagueId}/matches/${m.id}/${dialog!.kind}`, body);
                await onDone(dialog!.kind === "report" ? "Result reported: your opponent will confirm it" : "Result set");
            }
        } catch (err) {
            const fields = fieldErrors(err);
            if (Object.keys(fields).length) setErrors(fields);
            else setErrors({ form: err instanceof Error ? err.message : "Something went wrong" });
            toast.error(err);
        } finally {
            setBusy(false);
        }
    }

    const title = dialog.kind === "report" ? "Report the result" : dialog.kind === "resolve" ? "Set the result" : "Dispute the result";
    return (
        <Modal
            open
            title={title}
            onClose={onClose}
            testId="result-modal"
            footer={
                <>
                    <Button variant="secondary" onClick={onClose}>
                        Cancel
                    </Button>
                    <Button loading={busy} onClick={submit} testId="result-submit">
                        {dialog.kind === "dispute" ? "Dispute" : "Save result"}
                    </Button>
                </>
            }
        >
            <p className="mb-4 text-sm text-slate-600">
                Week {m.week}: <strong>{m.home.teamName}</strong> vs <strong>{m.away.teamName}</strong>
                {dialog.kind === "dispute" && m.homeWins !== null && (
                    <>
                        , reported as {m.homeWins}–{m.awayWins}
                    </>
                )}
            </p>
            {dialog.kind === "dispute" ? (
                <Field label="What's wrong?" htmlFor="dispute-reason" error={errors.reason} testId="result-reason">
                    <Textarea id="dispute-reason" rows={3} testId="result-reason" className="font-sans" value={reason} onChange={(e) => setReason(e.target.value)} />
                </Field>
            ) : (
                <div className="space-y-4">
                    <div className="grid grid-cols-2 gap-3">
                        <Field label={`${m.home.teamName} wins`} htmlFor="home-wins" testId="result-home-wins">
                            <Select id="home-wins" testId="result-home-wins" value={homeWins} onChange={(e) => setHomeWins(e.target.value)}>
                                {[0, 1, 2].map((n) => (
                                    <option key={n}>{n}</option>
                                ))}
                            </Select>
                        </Field>
                        <Field label={`${m.away.teamName} wins`} htmlFor="away-wins" testId="result-away-wins">
                            <Select id="away-wins" testId="result-away-wins" value={awayWins} onChange={(e) => setAwayWins(e.target.value)}>
                                {[0, 1, 2].map((n) => (
                                    <option key={n}>{n}</option>
                                ))}
                            </Select>
                        </Field>
                    </div>
                    {dialog.kind === "report" && (
                        <Field label="Showdown replay (optional)" htmlFor="replay-url" hint="https://replay.pokemonshowdown.com/…" testId="result-replay">
                            <Input id="replay-url" testId="result-replay" value={replayUrl} onChange={(e) => setReplayUrl(e.target.value)} />
                        </Field>
                    )}
                </div>
            )}
            {errors.form && (
                <p data-testid="result-error" role="alert" className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
                    {errors.form}
                </p>
            )}
        </Modal>
    );
}
