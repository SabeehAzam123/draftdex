"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { get, post } from "@/lib/client/api";
import { credits } from "@/lib/client/format";
import type { Actor } from "@/lib/services/context";

type Session = { user: Actor; balance: number | null; refreshBalance: () => void };
const SessionContext = createContext<Session | null>(null);

export function useSession(): Session {
    const s = useContext(SessionContext);
    if (!s) throw new Error("useSession needs <AppShell>");
    return s;
}

const NAV = [
    { href: "/leagues", label: "Leagues", testId: "nav-leagues" },
    { href: "/pokemon", label: "Pokémon", testId: "nav-pokemon" },
    { href: "/wallet", label: "Wallet", testId: "nav-wallet" },
];

export function AppShell({ user, children }: { user: Actor; children: ReactNode }) {
    const pathname = usePathname();
    const [balance, setBalance] = useState<number | null>(null);
    const refreshBalance = useCallback(() => {
        get<{ balance: number }>("/me")
            .then((me) => setBalance(me.balance))
            .catch(() => undefined);
    }, []);
    useEffect(refreshBalance, [refreshBalance]);

    async function signOut() {
        await post("/auth/logout").catch(() => undefined);
        window.location.href = "/login";
    }

    const nav = user.role === "admin" ? [...NAV, { href: "/admin/users", label: "Admin", testId: "nav-admin" }] : NAV;

    return (
        <SessionContext.Provider value={{ user, balance, refreshBalance }}>
            <div className="flex min-h-screen flex-col">
                <header className="sticky top-0 z-30 bg-brand-900 text-white shadow">
                    <div className="mx-auto flex h-14 max-w-6xl items-center gap-6 px-4">
                        <Link href="/leagues" className="text-lg font-black tracking-tight" data-testid="nav-home">
                            Draft<span className="text-brand-200">Dex</span>
                        </Link>
                        <nav className="flex gap-1" aria-label="Main">
                            {nav.map((n) => {
                                const active = pathname === n.href || pathname.startsWith(`${n.href}/`);
                                return (
                                    <Link
                                        key={n.href}
                                        href={n.href}
                                        data-testid={n.testId}
                                        aria-current={active ? "page" : undefined}
                                        className={`rounded-md px-3 py-1.5 text-sm font-medium ${active ? "bg-white/15 text-white" : "text-brand-100 hover:bg-white/10"}`}
                                    >
                                        {n.label}
                                    </Link>
                                );
                            })}
                        </nav>
                        <div className="ml-auto flex items-center gap-3 text-sm">
                            <Link href="/wallet" data-testid="user-credits" className="rounded-full bg-white/10 px-3 py-1 font-semibold hover:bg-white/20">
                                {balance === null ? "…" : credits(balance)}
                            </Link>
                            <span data-testid="user-name" className="hidden text-brand-100 sm:inline">
                                {user.displayName}
                            </span>
                            <button data-testid="logout-button" onClick={signOut} className="rounded-md px-2 py-1 text-brand-100 hover:bg-white/10 hover:text-white">
                                Sign out
                            </button>
                        </div>
                    </div>
                </header>
                <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8">{children}</main>
                <footer className="border-t border-slate-200 py-4 text-center text-xs text-slate-500">
                    Pokémon data and sprites from{" "}
                    <a href="https://pokeapi.co" className="underline" target="_blank" rel="noreferrer">
                        PokéAPI
                    </a>
                    . DraftDex is a fan project, not affiliated with Nintendo, Game Freak or The Pokémon Company.
                </footer>
            </div>
        </SessionContext.Provider>
    );
}
