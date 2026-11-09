"use client";

import { useState } from "react";
import { useLeague } from "@/components/league-context";
import { Sprite } from "@/components/pokemon";
import { PointsBadge, TypeBadges } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { ErrorBanner, Pager, Spinner } from "@/components/ui/feedback";
import { Input, Select, Textarea } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";
import { ApiError, apiPage, get, post, put, query } from "@/lib/client/api";
import { dex } from "@/lib/client/format";
import { useLoad } from "@/lib/client/use-api";
import { POKEMON_TYPES } from "@/lib/domain/enums";
import type { PoolRowDto } from "@/lib/services/pool";

type Change = { points?: number; banned?: boolean };

export default function PoolPage() {
    const { league } = useLeague();
    const toast = useToast();
    const editable = league.me.canManage && (league.status === "setup" || league.status === "registration");
    const [filters, setFilters] = useState({ q: "", type: "", status: "all", sort: "points" });
    const [page, setPage] = useState(1);
    const [changes, setChanges] = useState<Record<number, Change>>({});
    const [saving, setSaving] = useState(false);
    const [importOpen, setImportOpen] = useState(false);

    const path = `/leagues/${league.id}/pool${query({ ...filters, page, pageSize: 50 })}`;
    const pool = useLoad(() => apiPage<PoolRowDto>(path), path);
    const summary = useLoad(() => get<{ tiers: { points: number; n: number }[]; banned: number }>(`/leagues/${league.id}/pool/summary`), league.id);
    const setFilter = (k: keyof typeof filters) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
        setFilters({ ...filters, [k]: e.target.value });
        setPage(1);
    };
    const dirty = Object.keys(changes).length;

    function change(id: number, c: Change) {
        setChanges((prev) => ({ ...prev, [id]: { ...prev[id], ...c } }));
    }

    async function save() {
        setSaving(true);
        try {
            const body = { changes: Object.entries(changes).map(([id, c]) => ({ pokemonId: Number(id), ...c })) };
            const res = await put<{ updated: number }>(`/leagues/${league.id}/pool`, body);
            toast.success(`Saved ${res.updated} change(s)`);
            setChanges({});
            await Promise.all([pool.reload(), summary.reload()]);
        } catch (err) {
            toast.error(err);
        } finally {
            setSaving(false);
        }
    }

    return (
        <div className="space-y-6">
            {summary.data && (
                <div className="flex flex-wrap gap-2" data-testid="pool-summary">
                    {summary.data.tiers.map((t) => (
                        <span key={t.points} className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs shadow-sm" data-testid="pool-tier" data-points={t.points}>
                            <strong>{t.points} pts</strong> <span className="text-slate-500">× {t.n}</span>
                        </span>
                    ))}
                    <span className="rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-xs text-red-700" data-testid="pool-banned-count">
                        <strong>Banned</strong> × {summary.data.banned}
                    </span>
                </div>
            )}

            <Card>
                <CardHeader
                    title="Tier list"
                    subtitle={editable ? "Set what each Pokémon costs, or ban it. Changes lock when the draft starts." : "What each Pokémon costs in this league."}
                    actions={
                        editable && (
                            <>
                                <Button variant="secondary" size="sm" onClick={() => setImportOpen(true)} testId="pool-import-open">
                                    Import CSV
                                </Button>
                                <Button size="sm" disabled={!dirty} loading={saving} onClick={save} testId="pool-save">
                                    Save {dirty ? `${dirty} change(s)` : "changes"}
                                </Button>
                            </>
                        )
                    }
                />
                <div className="flex flex-wrap gap-3 border-b border-slate-100 px-5 py-3">
                    <Input aria-label="Search" placeholder="Search by name or #" className="w-56" testId="pool-search" value={filters.q} onChange={setFilter("q")} />
                    <Select aria-label="Type" className="w-36" testId="pool-type" value={filters.type} onChange={setFilter("type")}>
                        <option value="">Any type</option>
                        {POKEMON_TYPES.map((t) => (
                            <option key={t} value={t} className="capitalize">
                                {t}
                            </option>
                        ))}
                    </Select>
                    <Select aria-label="Status" className="w-36" testId="pool-status" value={filters.status} onChange={setFilter("status")}>
                        <option value="all">All</option>
                        <option value="available">Available</option>
                        <option value="taken">Drafted</option>
                        <option value="banned">Banned</option>
                    </Select>
                    <Select aria-label="Sort" className="w-40" testId="pool-sort" value={filters.sort} onChange={setFilter("sort")}>
                        <option value="points">Most points</option>
                        <option value="bst">Base stats</option>
                        <option value="dex">Dex number</option>
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
                    pool.data && (
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm" data-testid="pool-table">
                                <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                                    <tr>
                                        <th className="px-5 py-2 font-medium">Pokémon</th>
                                        <th className="px-3 py-2 font-medium">Type</th>
                                        <th className="px-3 py-2 text-right font-medium">Base stats</th>
                                        <th className="px-3 py-2 font-medium">Cost</th>
                                        {editable && <th className="px-3 py-2 font-medium">Banned</th>}
                                        <th className="px-5 py-2 font-medium">Drafted by</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100">
                                    {pool.data.data.map((r) => {
                                        const c = changes[r.pokemon.id];
                                        const points = c?.points ?? r.points;
                                        const banned = c?.banned ?? r.banned;
                                        return (
                                            <tr key={r.pokemon.id} data-testid="pool-row" data-pokemon-id={r.pokemon.id} className={c ? "bg-amber-50/60" : ""}>
                                                <td className="px-5 py-2">
                                                    <span className="flex items-center gap-2">
                                                        <Sprite id={r.pokemon.id} name={r.pokemon.name} size={40} />
                                                        <span>
                                                            <span className="block font-medium text-slate-900" data-testid="pool-row-name">
                                                                {r.pokemon.name}
                                                            </span>
                                                            <span className="text-xs text-slate-400">{dex(r.pokemon.id)}</span>
                                                        </span>
                                                    </span>
                                                </td>
                                                <td className="px-3 py-2">
                                                    <TypeBadges types={r.pokemon.types} />
                                                </td>
                                                <td className="px-3 py-2 text-right tabular-nums text-slate-600">{r.pokemon.bst}</td>
                                                <td className="px-3 py-2">
                                                    {editable ? (
                                                        <Input
                                                            type="number"
                                                            min={1}
                                                            max={20}
                                                            aria-label={`Points for ${r.pokemon.name}`}
                                                            className="w-20"
                                                            testId="pool-points-input"
                                                            value={points}
                                                            disabled={banned}
                                                            onChange={(e) => change(r.pokemon.id, { points: Number(e.target.value) })}
                                                        />
                                                    ) : (
                                                        <PointsBadge points={r.points} banned={r.banned} testId="pool-row-points" />
                                                    )}
                                                </td>
                                                {editable && (
                                                    <td className="px-3 py-2">
                                                        <input
                                                            type="checkbox"
                                                            aria-label={`Ban ${r.pokemon.name}`}
                                                            data-testid="pool-ban-toggle"
                                                            checked={banned}
                                                            onChange={(e) => change(r.pokemon.id, { banned: e.target.checked })}
                                                            className="h-4 w-4 accent-red-600"
                                                        />
                                                    </td>
                                                )}
                                                <td className="px-5 py-2 text-slate-600" data-testid="pool-row-taken-by">
                                                    {r.takenBy?.teamName ?? "—"}
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                            {pool.data.data.length === 0 && <p className="px-5 py-8 text-center text-sm text-slate-500">No Pokémon match.</p>}
                            <div className="px-5 pb-4">
                                <Pager page={pool.data.page} pageSize={pool.data.pageSize} total={pool.data.total} onPage={setPage} />
                            </div>
                        </div>
                    )
                )}
            </Card>

            <ImportModal
                open={importOpen}
                onClose={() => setImportOpen(false)}
                onDone={async () => {
                    setImportOpen(false);
                    setChanges({});
                    await Promise.all([pool.reload(), summary.reload()]);
                }}
            />
        </div>
    );
}

function ImportModal({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => Promise<void> }) {
    const { league } = useLeague();
    const toast = useToast();
    const [csv, setCsv] = useState("dex,points\n");
    const [errors, setErrors] = useState<{ path: string; message: string }[]>([]);
    const [busy, setBusy] = useState(false);

    async function submit() {
        setBusy(true);
        setErrors([]);
        try {
            const res = await post<{ updated: number }>(`/leagues/${league.id}/pool/import`, { csv });
            toast.success(`Imported ${res.updated} row(s)`);
            await onDone();
        } catch (err) {
            if (err instanceof ApiError && err.details.length) setErrors(err.details);
            else toast.error(err);
        } finally {
            setBusy(false);
        }
    }

    return (
        <Modal
            open={open}
            title="Import a tier list"
            onClose={onClose}
            testId="pool-import-modal"
            wide
            footer={
                <>
                    <Button variant="secondary" onClick={onClose}>
                        Cancel
                    </Button>
                    <Button loading={busy} onClick={submit} testId="pool-import-submit">
                        Import
                    </Button>
                </>
            }
        >
            <p className="text-sm text-slate-600">
                One Pokémon per line: a dex number or name, then the points (1–20) or <code>banned</code>. Nothing changes unless every line is valid.
            </p>
            <Textarea rows={10} className="mt-3" aria-label="CSV" testId="pool-import-text" value={csv} onChange={(e) => setCsv(e.target.value)} />
            {errors.length > 0 && (
                <ul data-testid="pool-import-errors" className="mt-3 max-h-40 space-y-1 overflow-y-auto rounded-lg bg-red-50 px-3 py-2 text-xs text-red-800">
                    {errors.map((e, i) => (
                        <li key={i}>
                            <strong>{e.path}:</strong> {e.message}
                        </li>
                    ))}
                </ul>
            )}
        </Modal>
    );
}
