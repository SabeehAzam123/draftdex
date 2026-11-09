"use client";

import { useState } from "react";
import { Sprite } from "@/components/pokemon";
import { Badge, TypeBadges } from "@/components/ui/badge";
import { PageHeader } from "@/components/ui/card";
import { ErrorBanner, Pager, Spinner } from "@/components/ui/feedback";
import { Input, Select } from "@/components/ui/field";
import { apiPage, query } from "@/lib/client/api";
import { dex } from "@/lib/client/format";
import { useLoad } from "@/lib/client/use-api";
import { POKEMON_TYPES } from "@/lib/domain/enums";
import type { PokemonDto } from "@/lib/services/pokemon";

export default function PokemonPage() {
    const [f, setF] = useState({ q: "", type: "", generation: "" });
    const [page, setPage] = useState(1);
    const path = `/pokemon${query({ ...f, page, pageSize: 24 })}`;
    const list = useLoad(() => apiPage<PokemonDto>(path), path);
    const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
        setF({ ...f, [k]: e.target.value });
        setPage(1);
    };

    return (
        <>
            <PageHeader title="Pokémon" subtitle="All 1,025 species with their base stats, from PokéAPI." />
            <div className="mb-5 flex flex-wrap gap-3">
                <Input aria-label="Search" placeholder="Search by name or #" className="w-56" testId="pokemon-search" value={f.q} onChange={set("q")} />
                <Select aria-label="Type" className="w-36" testId="pokemon-type" value={f.type} onChange={set("type")}>
                    <option value="">Any type</option>
                    {POKEMON_TYPES.map((t) => (
                        <option key={t} value={t}>
                            {t}
                        </option>
                    ))}
                </Select>
                <Select aria-label="Generation" className="w-40" testId="pokemon-generation" value={f.generation} onChange={set("generation")}>
                    <option value="">Any generation</option>
                    {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((g) => (
                        <option key={g} value={g}>
                            Generation {g}
                        </option>
                    ))}
                </Select>
            </div>
            {list.loading && !list.data ? (
                <Spinner />
            ) : list.error ? (
                <ErrorBanner error={list.error} onRetry={list.reload} />
            ) : (
                list.data && (
                    <>
                        <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4" data-testid="pokemon-grid">
                            {list.data.data.map((p) => (
                                <li key={p.id} data-testid="pokemon-card" data-pokemon-id={p.id} className="rounded-xl border border-slate-200 bg-white p-4 text-center shadow-sm">
                                    <div className="flex justify-center">
                                        <Sprite id={p.id} name={p.name} size={96} />
                                    </div>
                                    <p className="font-semibold text-slate-900">{p.name}</p>
                                    <p className="text-xs text-slate-400">
                                        {dex(p.id)} · Gen {p.generation}
                                    </p>
                                    <div className="mt-2 flex justify-center">
                                        <TypeBadges types={p.types} />
                                    </div>
                                    <p className="mt-2 text-xs text-slate-600">
                                        Base stats <strong>{p.bst}</strong>
                                    </p>
                                    {(p.isLegendary || p.isMythical) && (
                                        <div className="mt-2">
                                            <Badge tone="amber">{p.isMythical ? "Mythical" : "Legendary"}</Badge>
                                        </div>
                                    )}
                                </li>
                            ))}
                        </ul>
                        {list.data.data.length === 0 && <p className="py-8 text-center text-sm text-slate-500">No Pokémon match.</p>}
                        <Pager page={list.data.page} pageSize={list.data.pageSize} total={list.data.total} onPage={setPage} />
                    </>
                )
            )}
        </>
    );
}
