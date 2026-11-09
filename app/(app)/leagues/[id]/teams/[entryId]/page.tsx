"use client";

import { useParams } from "next/navigation";
import { useState } from "react";
import { useLeague } from "@/components/league-context";
import { Sprite } from "@/components/pokemon";
import { Badge, PointsBadge, TypeBadges } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { EmptyState, ErrorBanner, Spinner } from "@/components/ui/feedback";
import { Textarea } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";
import { apiText, get } from "@/lib/client/api";
import { dex } from "@/lib/client/format";
import { useLoad } from "@/lib/client/use-api";
import type { TeamDto } from "@/lib/services/teams";

export default function TeamPage() {
    const { league } = useLeague();
    const { entryId } = useParams<{ entryId: string }>();
    const toast = useToast();
    const team = useLoad(() => get<TeamDto>(`/leagues/${league.id}/teams/${entryId}`), entryId);
    const [showdown, setShowdown] = useState<string | null>(null);

    async function copyForShowdown() {
        try {
            const text = await apiText(`/leagues/${league.id}/teams/${entryId}/showdown`);
            setShowdown(text);
            await navigator.clipboard?.writeText(text).catch(() => undefined);
            toast.success("Copied. In Showdown: Teambuilder → New team → Import from text.");
        } catch (err) {
            toast.error(err);
        }
    }

    if (team.loading && !team.data) return <Spinner label="Loading team…" />;
    if (team.error) return <ErrorBanner error={team.error} onRetry={team.reload} />;
    const t = team.data!;

    return (
        <div className="space-y-6">
            <Card testId="team-header">
                <CardHeader
                    title={<span data-testid="team-name">{t.teamName}</span>}
                    subtitle={
                        <>
                            Coach <span data-testid="team-coach">{t.coach.displayName}</span> · {t.roster.length}/{t.league.rosterSize} Pokémon ·{" "}
                            <span data-testid="team-spent">
                                {t.spent}/{t.league.budget} pts spent
                            </span>
                        </>
                    }
                    actions={
                        <Button variant="secondary" onClick={copyForShowdown} disabled={t.roster.length === 0} testId="team-showdown-copy">
                            Copy for Showdown
                        </Button>
                    }
                />
                {showdown !== null && (
                    <CardBody>
                        <Textarea readOnly rows={Math.min(14, t.roster.length * 2 + 1)} value={showdown} aria-label="Showdown import text" testId="team-showdown-text" />
                    </CardBody>
                )}
            </Card>

            {t.roster.length === 0 ? (
                <EmptyState testId="team-empty" title="No Pokémon yet">
                    Picks show up here as soon as they&apos;re made.
                </EmptyState>
            ) : (
                <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" data-testid="team-roster">
                    {t.roster.map((r) => (
                        <li key={r.slotNo} data-testid="roster-card" data-pokemon-id={r.pokemon.id} className="flex items-center gap-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                            <Sprite id={r.pokemon.id} name={r.pokemon.name} size={72} />
                            <div className="min-w-0 flex-1">
                                <p className="truncate font-semibold text-slate-900">{r.pokemon.name}</p>
                                <p className="text-xs text-slate-400">
                                    {dex(r.pokemon.id)} · pick {r.slotNo}, round {r.round}
                                </p>
                                <div className="mt-2 flex flex-wrap items-center gap-2">
                                    <TypeBadges types={r.pokemon.types} />
                                    <PointsBadge points={r.points} />
                                    {r.autoPicked && <Badge tone="amber">auto-pick</Badge>}
                                    {r.viaTrade && (
                                        <Badge tone="blue" testId="roster-via-trade">
                                            via trade
                                        </Badge>
                                    )}
                                </div>
                            </div>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}
