import { and, asc, eq, inArray, ne, sql } from "drizzle-orm";
import type { z } from "zod";
import { entries, users, type EntryStatus } from "@/lib/db/schema";
import { AppError, conflict, forbidden, notFound } from "@/lib/errors/app-error";
import { ErrorCodes } from "@/lib/errors/codes";
import type { ApplySchema } from "@/lib/validators/schemas";
import type { DbOrTx } from "@/lib/db/client";
import { newId, nowIso, requireActor, withTx, type Ctx } from "./context";
import { getLeagueRow, refundEntry, requireManager, requireStatus } from "./leagues";
import { balanceOf, leagueAccount, transfer, userAccount } from "./ledger";

export type EntryDto = {
    id: string;
    leagueId: string;
    teamName: string;
    status: EntryStatus;
    createdAt: string;
    coach: { id: string; displayName: string };
};

type EntryRow = typeof entries.$inferSelect;

async function toDto(db: DbOrTx, e: EntryRow): Promise<EntryDto> {
    const coach = await db.select({ id: users.id, displayName: users.displayName }).from(users).where(eq(users.id, e.userId)).get();
    return {
        id: e.id,
        leagueId: e.leagueId,
        teamName: e.teamName,
        status: e.status,
        createdAt: e.createdAt,
        coach: coach ?? { id: e.userId, displayName: "(deleted)" },
    };
}

export async function getEntryRow(db: DbOrTx, leagueId: string, entryId: string): Promise<EntryRow> {
    const row = await db
        .select()
        .from(entries)
        .where(and(eq(entries.id, entryId), eq(entries.leagueId, leagueId)))
        .get();
    if (!row) throw notFound(ErrorCodes.ENTRY_NOT_FOUND, "Entry not found in this league");
    return row;
}

export async function listEntries(ctx: Ctx, leagueId: string): Promise<EntryDto[]> {
    requireActor(ctx);
    await getLeagueRow(ctx.db, leagueId);
    const rows = await ctx.db
        .select({
            id: entries.id,
            leagueId: entries.leagueId,
            teamName: entries.teamName,
            status: entries.status,
            createdAt: entries.createdAt,
            coachId: users.id,
            coachName: users.displayName,
        })
        .from(entries)
        .innerJoin(users, eq(users.id, entries.userId))
        .where(eq(entries.leagueId, leagueId))
        .orderBy(asc(entries.createdAt), asc(entries.teamName));
    return rows.map(({ coachId, coachName, ...e }) => ({ ...e, coach: { id: coachId, displayName: coachName } }));
}

const ACTIVE: EntryStatus[] = ["pending", "approved"];

/** A coach asks to join. The entry fee is charged now and refunded if they're rejected or withdraw. */
export async function applyToLeague(ctx: Ctx, leagueId: string, input: z.infer<typeof ApplySchema>): Promise<EntryDto> {
    const actor = requireActor(ctx);
    const entry = await ctx.db.transaction(async (tx) => {
        const league = await getLeagueRow(tx, leagueId);
        requireStatus(league, ["registration"], "apply");
        const existing = await tx
            .select()
            .from(entries)
            .where(and(eq(entries.leagueId, leagueId), eq(entries.userId, actor.id)))
            .get();
        if (existing && ACTIVE.includes(existing.status)) {
            throw conflict(ErrorCodes.ENTRY_ALREADY_EXISTS, "You've already applied to this league");
        }
        const nameTaken = await tx
            .select({ id: entries.id })
            .from(entries)
            .where(
                and(
                    eq(entries.leagueId, leagueId),
                    inArray(entries.status, ACTIVE),
                    eq(sql`lower(${entries.teamName})`, input.teamName.toLowerCase()),
                    ne(entries.userId, actor.id),
                ),
            )
            .get();
        if (nameTaken) throw conflict(ErrorCodes.ENTRY_TEAM_NAME_TAKEN, `Another team in this league is called "${input.teamName}"`);
        const active = await tx
            .select({ id: entries.id })
            .from(entries)
            .where(and(eq(entries.leagueId, leagueId), inArray(entries.status, ACTIVE)));
        if (active.length >= league.settings.maxCoaches) {
            throw conflict(ErrorCodes.ENTRY_LEAGUE_FULL, `This league is full (${league.settings.maxCoaches} coaches)`);
        }
        const fee = league.settings.entryFee;
        if (fee > 0) {
            const balance = await balanceOf(tx, userAccount(actor.id));
            if (balance < fee) {
                throw new AppError(422, ErrorCodes.ENTRY_INSUFFICIENT_CREDITS, `The entry fee is ${fee} credits; you have ${balance}`);
            }
        }
        const at = nowIso(ctx);
        let row: EntryRow;
        if (existing) {
            // Re-applying after a rejection or withdrawal reuses the entry
            row = { ...existing, teamName: input.teamName, status: "pending", createdAt: at };
            await tx.update(entries).set({ teamName: row.teamName, status: row.status, createdAt: at }).where(eq(entries.id, existing.id));
        } else {
            row = { id: newId("en"), leagueId, userId: actor.id, teamName: input.teamName, status: "pending", createdAt: at };
            await tx.insert(entries).values(row);
        }
        if (fee > 0) {
            await transfer(tx, {
                from: userAccount(actor.id),
                to: leagueAccount(leagueId),
                amount: fee,
                kind: "entry_fee",
                ref: row.id,
                memo: `Entry fee: ${league.name}`,
                at,
            });
        }
        return row;
    });
    return toDto(ctx.db, entry);
}

export async function approveEntry(ctx: Ctx, leagueId: string, entryId: string): Promise<EntryDto> {
    const entry = await withTx(ctx, async (tx, events) => {
        const league = await getLeagueRow(tx, leagueId);
        requireManager(ctx, league);
        requireStatus(league, ["registration"], "approve coaches");
        const e = await getEntryRow(tx, leagueId, entryId);
        if (e.status !== "pending") throw conflict(ErrorCodes.ENTRY_INVALID_STATE, `This entry is ${e.status}, not pending`);
        const approved = await tx
            .select({ id: entries.id })
            .from(entries)
            .where(and(eq(entries.leagueId, leagueId), eq(entries.status, "approved")));
        if (approved.length >= league.settings.maxCoaches) {
            throw conflict(ErrorCodes.ENTRY_LEAGUE_FULL, `This league is full (${league.settings.maxCoaches} coaches)`);
        }
        await tx.update(entries).set({ status: "approved" }).where(eq(entries.id, entryId));
        events.push({
            leagueId,
            type: "entry.approved",
            title: "New coach",
            text: `**${e.teamName}** joined ${league.name} (${approved.length + 1}/${league.settings.maxCoaches} coaches).`,
        });
        return { ...e, status: "approved" as const };
    });
    return toDto(ctx.db, entry);
}

export async function rejectEntry(ctx: Ctx, leagueId: string, entryId: string): Promise<EntryDto> {
    const entry = await ctx.db.transaction(async (tx) => {
        const league = await getLeagueRow(tx, leagueId);
        requireManager(ctx, league);
        requireStatus(league, ["registration"], "reject coaches");
        const e = await getEntryRow(tx, leagueId, entryId);
        if (e.status !== "pending") throw conflict(ErrorCodes.ENTRY_INVALID_STATE, `This entry is ${e.status}, not pending`);
        await tx.update(entries).set({ status: "rejected" }).where(eq(entries.id, entryId));
        await refundEntry(tx, league, e, `Refund: entry to ${league.name} not accepted`, nowIso(ctx));
        return { ...e, status: "rejected" as const };
    });
    return toDto(ctx.db, entry);
}

/** The coach leaves before the draft and gets their fee back. */
export async function withdrawEntry(ctx: Ctx, leagueId: string, entryId: string): Promise<EntryDto> {
    const actor = requireActor(ctx);
    const entry = await ctx.db.transaction(async (tx) => {
        const league = await getLeagueRow(tx, leagueId);
        const e = await getEntryRow(tx, leagueId, entryId);
        if (e.userId !== actor.id) throw forbidden("Only the coach can withdraw their entry");
        requireStatus(league, ["registration"], "withdraw");
        if (!ACTIVE.includes(e.status)) throw conflict(ErrorCodes.ENTRY_INVALID_STATE, `This entry is already ${e.status}`);
        await tx.update(entries).set({ status: "withdrawn" }).where(eq(entries.id, entryId));
        await refundEntry(tx, league, e, `Refund: withdrew from ${league.name}`, nowIso(ctx));
        return { ...e, status: "withdrawn" as const };
    });
    return toDto(ctx.db, entry);
}
