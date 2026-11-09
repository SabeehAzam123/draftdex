"use client";

import Link from "next/link";
import { useLeague } from "@/components/league-context";
import { Card, CardHeader } from "@/components/ui/card";
import { ErrorBanner, Spinner } from "@/components/ui/feedback";
import { get } from "@/lib/client/api";
import { credits } from "@/lib/client/format";
import { useLoad } from "@/lib/client/use-api";
import type { StandingsDto } from "@/lib/services/season";

export default function StandingsPage() {
    const { league } = useLeague();
    const standings = useLoad(() => get<StandingsDto>(`/leagues/${league.id}/standings`), league.id);

    if (standings.loading && !standings.data) return <Spinner label="Loading the standings…" />;
    if (standings.error) return <ErrorBanner error={standings.error} onRetry={standings.reload} />;
    const s = standings.data!;
    const champion = s.final ? s.rows[0] : null;

    return (
        <div className="space-y-6">
            {champion && (
                <div data-testid="standings-champion" className="rounded-xl bg-gradient-to-r from-amber-400 to-yellow-300 px-6 py-5 text-amber-950 shadow">
                    <p className="text-xs font-semibold uppercase tracking-wide">Champion</p>
                    <p className="text-2xl font-black">{champion.teamName}</p>
                    <p className="text-sm">
                        Coach {champion.coach.displayName} · won {credits(champion.prize)}
                    </p>
                </div>
            )}
            <Card testId="standings">
                <CardHeader
                    title="Standings"
                    subtitle={s.final ? "Final. Prizes have been paid." : `Ranked by wins, then game difference, then head-to-head. Prize pool ${credits(s.prizePool)}.`}
                />
                <div className="overflow-x-auto">
                    <table className="w-full text-sm" data-testid="standings-table">
                        <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                            <tr>
                                <th className="px-5 py-2 font-medium">#</th>
                                <th className="px-3 py-2 font-medium">Team</th>
                                <th className="px-3 py-2 text-right font-medium">Played</th>
                                <th className="px-3 py-2 text-right font-medium">W</th>
                                <th className="px-3 py-2 text-right font-medium">L</th>
                                <th className="px-3 py-2 text-right font-medium">Games</th>
                                <th className="px-3 py-2 text-right font-medium">+/–</th>
                                <th className="px-5 py-2 text-right font-medium">{s.final ? "Prize" : "Prize if it ended now"}</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                            {s.rows.map((r) => (
                                <tr key={r.entryId} data-testid="standings-row" data-entry-id={r.entryId} data-rank={r.rank}>
                                    <td className="px-5 py-3 font-bold text-slate-500">{r.rank}</td>
                                    <td className="px-3 py-3">
                                        <Link href={`/leagues/${league.id}/teams/${r.entryId}`} className="font-medium text-slate-900 hover:text-brand-700">
                                            {r.teamName}
                                        </Link>
                                        <span className="block text-xs text-slate-500">{r.coach.displayName}</span>
                                    </td>
                                    <td className="px-3 py-3 text-right tabular-nums">{r.played}</td>
                                    <td className="px-3 py-3 text-right font-semibold tabular-nums" data-testid="standings-wins">
                                        {r.wins}
                                    </td>
                                    <td className="px-3 py-3 text-right tabular-nums">{r.losses}</td>
                                    <td className="px-3 py-3 text-right tabular-nums">
                                        {r.gamesWon}–{r.gamesLost}
                                    </td>
                                    <td className="px-3 py-3 text-right tabular-nums">{r.gameDiff > 0 ? `+${r.gameDiff}` : r.gameDiff}</td>
                                    <td className="px-5 py-3 text-right font-semibold tabular-nums" data-testid="standings-prize">
                                        {r.prize ? credits(r.prize) : "—"}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </Card>
        </div>
    );
}
