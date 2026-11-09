import { desc, eq, sql } from "drizzle-orm";
import type { DbOrTx } from "@/lib/db/client";
import { ledger, type LedgerKind } from "@/lib/db/schema";
import { newId } from "./context";

export const SYSTEM_ACCOUNT = "system";
export const userAccount = (userId: string) => `user:${userId}`;
export const leagueAccount = (leagueId: string) => `league:${leagueId}`;

/**
 * Moves credits between two accounts: one negative row, one positive row, same txId.
 * Because every movement is a pair, the sum of the whole ledger is always 0.
 */
export async function transfer(
    db: DbOrTx,
    t: { from: string; to: string; amount: number; kind: LedgerKind; ref: string | null; memo: string; at: string },
): Promise<string> {
    if (!Number.isInteger(t.amount) || t.amount <= 0) throw new Error(`transfer amount must be a positive integer, got ${t.amount}`);
    if (t.from === t.to) throw new Error("transfer from an account to itself");
    const txId = newId("tx");
    await db.insert(ledger).values([
        { txId, account: t.from, amount: -t.amount, kind: t.kind, ref: t.ref, memo: t.memo, createdAt: t.at },
        { txId, account: t.to, amount: t.amount, kind: t.kind, ref: t.ref, memo: t.memo, createdAt: t.at },
    ]);
    return txId;
}

export async function balanceOf(db: DbOrTx, account: string): Promise<number> {
    const [row] = await db
        .select({ total: sql<number>`coalesce(sum(${ledger.amount}), 0)` })
        .from(ledger)
        .where(eq(ledger.account, account));
    return Number(row?.total ?? 0);
}

/** Sum of every row in the ledger. Always 0 unless something wrote half a transfer. */
export async function ledgerTotal(db: DbOrTx): Promise<number> {
    const [row] = await db.select({ total: sql<number>`coalesce(sum(${ledger.amount}), 0)` }).from(ledger);
    return Number(row?.total ?? 0);
}

export type LedgerRow = { id: number; amount: number; kind: LedgerKind; ref: string | null; memo: string; createdAt: string };

export async function historyOf(db: DbOrTx, account: string, limit = 50): Promise<LedgerRow[]> {
    return db
        .select({ id: ledger.id, amount: ledger.amount, kind: ledger.kind, ref: ledger.ref, memo: ledger.memo, createdAt: ledger.createdAt })
        .from(ledger)
        .where(eq(ledger.account, account))
        .orderBy(desc(ledger.id))
        .limit(limit);
}
