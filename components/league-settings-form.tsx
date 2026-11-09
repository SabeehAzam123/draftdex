"use client";

import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/field";
import type { LeagueFormat, LeagueSettings } from "@/lib/domain/enums";

export type LeagueFormValues = { name: string; format: LeagueFormat; settings: LeagueSettings };

const TIMERS = [
    [0, "No timer"],
    [30, "30 seconds"],
    [60, "1 minute"],
    [120, "2 minutes"],
    [300, "5 minutes"],
    [3600, "1 hour"],
    [43200, "12 hours"],
    [86400, "24 hours"],
] as const;

/**
 * The league's name, format and rules. Used to create a league and in the commissioner's settings.
 * `errors` are the API's field errors (paths like "settings.budget").
 */
export function LeagueSettingsForm({
    initial,
    submitLabel,
    onSubmit,
    errors,
    disabled,
    lockedFee,
}: {
    initial: LeagueFormValues;
    submitLabel: string;
    onSubmit: (values: LeagueFormValues) => Promise<void>;
    errors: Record<string, string>;
    disabled?: boolean;
    lockedFee?: boolean;
}) {
    const [v, setV] = useState(initial);
    const [busy, setBusy] = useState(false);
    const s = v.settings;
    const setSetting = <K extends keyof LeagueSettings>(k: K, value: LeagueSettings[K]) => setV({ ...v, settings: { ...s, [k]: value } });
    const num = (k: "budget" | "rosterSize" | "maxCoaches" | "entryFee") => (e: React.ChangeEvent<HTMLInputElement>) =>
        setSetting(k, e.target.value === "" ? (NaN as number) : Number(e.target.value));
    const split = [...s.prizeSplit, 0, 0, 0].slice(0, 3);
    const setSplit = (i: number, value: number) => {
        const next = [...split];
        next[i] = value;
        // drop trailing zero places, keep at least 1st place
        while (next.length > 1 && !next[next.length - 1]) next.pop();
        setSetting("prizeSplit", next);
    };
    const err = (path: string) => errors[path];

    async function submit(e: FormEvent) {
        e.preventDefault();
        setBusy(true);
        try {
            await onSubmit(v);
        } finally {
            setBusy(false);
        }
    }

    return (
        <form onSubmit={submit} noValidate className="space-y-5" data-testid="league-form">
            <div className="grid gap-4 sm:grid-cols-2">
                <Field label="League name" htmlFor="lf-name" error={err("name")} testId="league-form-name">
                    <Input id="lf-name" testId="league-form-name" value={v.name} disabled={disabled} invalid={!!err("name")} onChange={(e) => setV({ ...v, name: e.target.value })} />
                </Field>
                <Field label="Format" htmlFor="lf-format" error={err("format")} testId="league-form-format">
                    <Select
                        id="lf-format"
                        testId="league-form-format"
                        value={v.format}
                        disabled={disabled}
                        onChange={(e) => setV({ ...v, format: e.target.value as LeagueFormat })}
                    >
                        <option value="singles">Singles</option>
                        <option value="doubles">Doubles</option>
                    </Select>
                </Field>
            </div>

            <fieldset className="grid gap-4 sm:grid-cols-3" disabled={disabled}>
                <legend className="mb-2 text-sm font-semibold text-slate-800">Draft rules</legend>
                <Field label="Points budget" htmlFor="lf-budget" hint="Points each coach can spend" error={err("settings.budget")} testId="league-form-budget">
                    <Input id="lf-budget" testId="league-form-budget" type="number" min={10} max={500} value={Number.isNaN(s.budget) ? "" : s.budget} onChange={num("budget")} invalid={!!err("settings.budget")} />
                </Field>
                <Field label="Roster size" htmlFor="lf-roster" hint="Pokémon per team = rounds" error={err("settings.rosterSize")} testId="league-form-roster-size">
                    <Input id="lf-roster" testId="league-form-roster-size" type="number" min={3} max={15} value={Number.isNaN(s.rosterSize) ? "" : s.rosterSize} onChange={num("rosterSize")} invalid={!!err("settings.rosterSize")} />
                </Field>
                <Field label="Pick timer" htmlFor="lf-timer" hint="A missed pick moves to the end" error={err("settings.pickTimerSeconds")} testId="league-form-timer">
                    <Select id="lf-timer" testId="league-form-timer" value={s.pickTimerSeconds} onChange={(e) => setSetting("pickTimerSeconds", Number(e.target.value))}>
                        {TIMERS.map(([sec, label]) => (
                            <option key={sec} value={sec}>
                                {label}
                            </option>
                        ))}
                    </Select>
                </Field>
            </fieldset>

            <fieldset className="grid gap-4 sm:grid-cols-3" disabled={disabled}>
                <legend className="mb-2 text-sm font-semibold text-slate-800">Coaches and credits</legend>
                <Field label="Max coaches" htmlFor="lf-max" error={err("settings.maxCoaches")} testId="league-form-max-coaches">
                    <Input id="lf-max" testId="league-form-max-coaches" type="number" min={2} max={16} value={Number.isNaN(s.maxCoaches) ? "" : s.maxCoaches} onChange={num("maxCoaches")} invalid={!!err("settings.maxCoaches")} />
                </Field>
                <Field
                    label="Entry fee (credits)"
                    htmlFor="lf-fee"
                    hint={lockedFee ? "Locked: coaches have paid it" : "Refunded if a coach leaves before the draft"}
                    error={err("settings.entryFee")}
                    testId="league-form-entry-fee"
                >
                    <Input
                        id="lf-fee"
                        testId="league-form-entry-fee"
                        type="number"
                        min={0}
                        max={1000}
                        disabled={lockedFee}
                        value={Number.isNaN(s.entryFee) ? "" : s.entryFee}
                        onChange={num("entryFee")}
                        invalid={!!err("settings.entryFee")}
                    />
                </Field>
                <Field label="Prize split %" htmlFor="lf-split-0" hint="1st / 2nd / 3rd, adds up to 100" error={err("settings.prizeSplit")} testId="league-form-prize-split">
                    <div className="flex gap-2">
                        {[0, 1, 2].map((i) => (
                            <Input
                                key={i}
                                id={`lf-split-${i}`}
                                testId={`league-form-prize-${i + 1}`}
                                type="number"
                                min={0}
                                max={100}
                                aria-label={`Prize for place ${i + 1}`}
                                value={split[i]}
                                onChange={(e) => setSplit(i, Number(e.target.value))}
                                invalid={!!err("settings.prizeSplit")}
                            />
                        ))}
                    </div>
                </Field>
            </fieldset>

            {!disabled && (
                <div className="flex justify-end">
                    <Button type="submit" loading={busy} testId="league-form-submit">
                        {submitLabel}
                    </Button>
                </div>
            )}
        </form>
    );
}
