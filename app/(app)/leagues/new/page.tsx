"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { LeagueSettingsForm, type LeagueFormValues } from "@/components/league-settings-form";
import { Card, CardBody, PageHeader } from "@/components/ui/card";
import { useToast } from "@/components/ui/toast";
import { fieldErrors, post } from "@/lib/client/api";
import type { LeagueDto } from "@/lib/services/leagues";

const DEFAULTS: LeagueFormValues = {
    name: "",
    format: "singles",
    settings: { budget: 100, rosterSize: 10, maxCoaches: 8, entryFee: 100, pickTimerSeconds: 0, prizeSplit: [60, 30, 10] },
};

export default function NewLeaguePage() {
    const router = useRouter();
    const toast = useToast();
    const [errors, setErrors] = useState<Record<string, string>>({});

    async function create(values: LeagueFormValues) {
        setErrors({});
        try {
            const league = await post<LeagueDto>("/leagues", values);
            toast.success(`${league.name} created`);
            router.push(`/leagues/${league.id}`);
        } catch (err) {
            setErrors(fieldErrors(err));
            toast.error(err);
        }
    }

    return (
        <>
            <PageHeader title="New league" subtitle="You'll be its commissioner. Everything here can change until the draft starts." />
            <Card>
                <CardBody>
                    <LeagueSettingsForm initial={DEFAULTS} submitLabel="Create league" onSubmit={create} errors={errors} />
                </CardBody>
            </Card>
        </>
    );
}
