"use client";

import { Badge, type Tone } from "@/components/ui/badge";
import { Card, CardHeader, PageHeader } from "@/components/ui/card";
import { ErrorBanner, Spinner } from "@/components/ui/feedback";
import { get } from "@/lib/client/api";
import { credits, formatDate } from "@/lib/client/format";
import { useLoad } from "@/lib/client/use-api";
import type { LedgerRow } from "@/lib/services/ledger";

const KIND: Record<string, { label: string; tone: Tone }> = {
    signup_bonus: { label: "Welcome", tone: "violet" },
    entry_fee: { label: "Entry fee", tone: "slate" },
    refund: { label: "Refund", tone: "blue" },
    prize: { label: "Prize", tone: "green" },
};

export default function WalletPage() {
    const wallet = useLoad(() => get<{ balance: number; history: LedgerRow[] }>("/me/wallet"), "wallet");

    return (
        <>
            <PageHeader title="Wallet" subtitle="Credits are play money for entry fees and prizes." />
            {wallet.loading && !wallet.data ? (
                <Spinner />
            ) : wallet.error ? (
                <ErrorBanner error={wallet.error} onRetry={wallet.reload} />
            ) : (
                wallet.data && (
                    <div className="grid gap-6 lg:grid-cols-3">
                        <div className="rounded-xl bg-gradient-to-br from-brand-700 to-indigo-600 p-6 text-white shadow">
                            <p className="text-sm text-brand-100">Balance</p>
                            <p className="mt-2 text-4xl font-black tabular-nums" data-testid="wallet-balance">
                                {credits(wallet.data.balance)}
                            </p>
                        </div>
                        <Card className="lg:col-span-2" testId="wallet-history">
                            <CardHeader title="History" subtitle="Your latest 50 movements" />
                            <table className="w-full text-sm">
                                <tbody className="divide-y divide-slate-100">
                                    {wallet.data.history.map((r) => (
                                        <tr key={r.id} data-testid="wallet-row" data-kind={r.kind}>
                                            <td className="px-5 py-3">
                                                <Badge tone={KIND[r.kind]?.tone ?? "slate"}>{KIND[r.kind]?.label ?? r.kind}</Badge>
                                            </td>
                                            <td className="px-3 py-3 text-slate-700">{r.memo}</td>
                                            <td className="px-3 py-3 text-xs text-slate-500">{formatDate(r.createdAt)}</td>
                                            <td
                                                className={`px-5 py-3 text-right font-semibold tabular-nums ${r.amount < 0 ? "text-red-600" : "text-emerald-600"}`}
                                                data-testid="wallet-row-amount"
                                            >
                                                {r.amount > 0 ? "+" : ""}
                                                {r.amount.toLocaleString()}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </Card>
                    </div>
                )
            )}
        </>
    );
}
