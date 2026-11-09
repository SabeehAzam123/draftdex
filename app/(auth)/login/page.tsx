import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getServerActor } from "@/lib/auth/server";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in" };

/** Only same-site paths, so `?next=` can't send someone to another site after signing in. */
function safeNext(next: string | string[] | undefined): string {
    return typeof next === "string" && next.startsWith("/") && !next.startsWith("//") ? next : "/leagues";
}

export default async function LoginPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
    const next = safeNext((await searchParams).next);
    if (await getServerActor()) redirect(next);
    return <LoginForm next={next} />;
}
