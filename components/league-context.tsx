"use client";

import { createContext, useContext } from "react";
import type { LeagueDto } from "@/lib/services/leagues";

type LeagueCtx = { league: LeagueDto; reload: () => Promise<void> };

export const LeagueContext = createContext<LeagueCtx | null>(null);

/** The league loaded by app/(app)/leagues/[id]/layout.tsx, for its pages. */
export function useLeague(): LeagueCtx {
    const ctx = useContext(LeagueContext);
    if (!ctx) throw new Error("useLeague needs the league layout");
    return ctx;
}
