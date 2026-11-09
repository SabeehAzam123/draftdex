import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { getServerActor } from "@/lib/auth/server";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
    const actor = await getServerActor();
    if (!actor) redirect("/login");
    return <AppShell user={actor}>{children}</AppShell>;
}
