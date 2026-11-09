"use client";

import { useState } from "react";
import { useLeague } from "@/components/league-context";
import { LeagueSettingsForm, type LeagueFormValues } from "@/components/league-settings-form";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/feedback";
import { Field, Input } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";
import { fieldErrors, get, patch, post, put } from "@/lib/client/api";
import { formatDate } from "@/lib/client/format";
import { useLoad } from "@/lib/client/use-api";

type Notification = { id: number; event: string; status: "sent" | "failed"; httpStatus: number | null; error: string | null; createdAt: string };
type Delivery = { status: "sent" | "failed"; httpStatus: number | null; error: string | null };

export default function LeagueSettingsPage() {
    const { league, reload } = useLeague();
    const toast = useToast();
    const [errors, setErrors] = useState<Record<string, string>>({});
    if (!league.me.canManage) {
        return <EmptyState testId="settings-forbidden" title="Only the commissioner can change this league's settings" />;
    }
    const editable = league.status === "setup" || league.status === "registration";
    const feeLocked = league.counts.approved + league.counts.pending > 0;

    async function save(values: LeagueFormValues) {
        setErrors({});
        try {
            const settings = { ...values.settings };
            if (feeLocked) delete (settings as Partial<typeof settings>).entryFee;
            await patch(`/leagues/${league.id}`, { name: values.name, format: values.format, settings });
            toast.success("Settings saved");
            await reload();
        } catch (err) {
            setErrors(fieldErrors(err));
            toast.error(err);
        }
    }

    return (
        <div className="space-y-6">
            <Card testId="settings-rules">
                <CardHeader title="League rules" subtitle={editable ? "These lock when the draft starts." : "Locked: the draft has started."} />
                <CardBody>
                    <LeagueSettingsForm
                        key={JSON.stringify(league.settings) + league.name}
                        initial={{ name: league.name, format: league.format, settings: league.settings }}
                        submitLabel="Save settings"
                        onSubmit={save}
                        errors={errors}
                        disabled={!editable}
                        lockedFee={feeLocked}
                    />
                </CardBody>
            </Card>
            <Webhook />
        </div>
    );
}

function Webhook() {
    const { league, reload } = useLeague();
    const toast = useToast();
    const [url, setUrl] = useState("");
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState<string | null>(null);
    const [lastTest, setLastTest] = useState<Delivery | null>(null);
    const log = useLoad(() => get<Notification[]>(`/leagues/${league.id}/notifications`), league.id);
    const hook = league.webhook;

    async function save(value: string | null) {
        setBusy(value ? "save" : "remove");
        setError(null);
        try {
            await put(`/leagues/${league.id}/webhook`, { url: value });
            toast.success(value ? "Webhook saved" : "Webhook removed");
            setUrl("");
            await reload();
        } catch (err) {
            setError(err instanceof Error ? err.message : "Couldn't save the webhook");
        } finally {
            setBusy(null);
        }
    }

    async function test() {
        setBusy("test");
        try {
            const d = await post<Delivery>(`/leagues/${league.id}/webhook/test`);
            setLastTest(d);
            if (d.status === "sent") toast.success("Test message sent");
            else toast.error(new Error(`The webhook didn't accept it: ${d.error}`));
            await log.reload();
        } catch (err) {
            toast.error(err);
        } finally {
            setBusy(null);
        }
    }

    return (
        <Card testId="settings-webhook">
            <CardHeader title="Discord notifications" subtitle="Post approvals, the draft's start, every pick and its end to a Discord channel." />
            <CardBody className="space-y-4">
                <p className="text-sm text-slate-600">
                    In Discord: channel settings → Integrations → Webhooks → New webhook → Copy webhook URL. The URL contains a secret, so it&apos;s never shown again in
                    full.
                </p>
                <p className="text-sm">
                    Now:{" "}
                    {hook?.configured ? (
                        <code data-testid="webhook-current" className="rounded bg-slate-100 px-1.5 py-0.5 text-xs">
                            {hook.masked}
                        </code>
                    ) : (
                        <span data-testid="webhook-current" className="text-slate-500">
                            not set
                        </span>
                    )}
                </p>
                <div className="flex flex-wrap items-start gap-3">
                    <div className="min-w-72 flex-1">
                        <Field label="Webhook URL" htmlFor="webhook-url" error={error ?? undefined} testId="webhook-url">
                            <Input
                                id="webhook-url"
                                testId="webhook-url"
                                placeholder="https://discord.com/api/webhooks/…"
                                value={url}
                                invalid={!!error}
                                onChange={(e) => setUrl(e.target.value)}
                            />
                        </Field>
                    </div>
                    <Button className="mt-6" disabled={!url.trim()} loading={busy === "save"} onClick={() => save(url.trim())} testId="webhook-save">
                        Save
                    </Button>
                    {hook?.configured && (
                        <>
                            <Button variant="secondary" className="mt-6" loading={busy === "test"} onClick={test} testId="webhook-test">
                                Send test
                            </Button>
                            <Button variant="ghost" className="mt-6" loading={busy === "remove"} onClick={() => save(null)} testId="webhook-remove">
                                Remove
                            </Button>
                        </>
                    )}
                </div>
                {lastTest && (
                    <p data-testid="webhook-test-result" className={`text-sm ${lastTest.status === "sent" ? "text-emerald-700" : "text-red-700"}`}>
                        Last test: {lastTest.status === "sent" ? `delivered (HTTP ${lastTest.httpStatus})` : `failed: ${lastTest.error}`}
                    </p>
                )}

                <div>
                    <p className="mb-2 text-sm font-semibold text-slate-800">Recent deliveries</p>
                    {log.data && log.data.length > 0 ? (
                        <table className="w-full text-sm" data-testid="notifications-table">
                            <tbody className="divide-y divide-slate-100">
                                {log.data.map((n) => (
                                    <tr key={n.id} data-testid="notification-row" data-status={n.status}>
                                        <td className="py-1.5 font-mono text-xs text-slate-700">{n.event}</td>
                                        <td className="py-1.5">
                                            <Badge tone={n.status === "sent" ? "green" : "red"}>{n.status}</Badge>
                                        </td>
                                        <td className="py-1.5 text-xs text-slate-500">{n.error ?? (n.httpStatus ? `HTTP ${n.httpStatus}` : "")}</td>
                                        <td className="py-1.5 text-right text-xs text-slate-500">{formatDate(n.createdAt)}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    ) : (
                        <p className="text-sm text-slate-500" data-testid="notifications-empty">
                            Nothing sent yet.
                        </p>
                    )}
                </div>
            </CardBody>
        </Card>
    );
}
