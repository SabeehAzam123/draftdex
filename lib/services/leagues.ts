import { and, count, desc, eq, inArray, or, sql, type SQL } from "drizzle-orm";
import type { z } from "zod";
import { getConfig } from "@/lib/config";
import type { DbOrTx } from "@/lib/db/client";
import {
    entries,
    leagues,
    ledger,
    leaguePool,
    pokemon,
    users,
    type EntryStatus,
    type LeagueSettings,
    type LeagueStatus,
} from "@/lib/db/schema";
import { defaultBanned, defaultPoints } from "@/lib/domain/tiers";
import { checkWebhookUrl, maskWebhookUrl } from "@/lib/domain/webhook";
import { AppError, conflict, forbidden, invalid, notFound, zodDetails } from "@/lib/errors/app-error";
import { ErrorCodes } from "@/lib/errors/codes";
import { LeagueSettingsSchema, type CreateLeagueSchema, type LeaguesQuerySchema, type UpdateLeagueSchema } from "@/lib/validators/schemas";
import { newId, nowIso, requireActor, type Actor, type Ctx } from "./context";
import { leagueAccount, transfer, userAccount } from "./ledger";

export const DEFAULT_SETTINGS: LeagueSettings = {
    budget: 100,
    rosterSize: 10,
    maxCoaches: 8,
    entryFee: 100,
    pickTimerSeconds: 0,
    prizeSplit: [60, 30, 10],
};

export type LeagueRow = typeof leagues.$inferSelect;

export type LeagueDto = {
    id: string;
    name: string;
    format: LeagueRow["format"];
    status: LeagueStatus;
    settings: LeagueSettings;
    createdAt: string;
    commissioner: { id: string; displayName: string };
    counts: { approved: number; pending: number };
    prizePool: number;
    /** Only for the commissioner and admins: where notifications go, with the secret part hidden. */
    webhook: { configured: boolean; masked: string | null } | null;
    me: { canManage: boolean; entry: { id: string; teamName: string; status: EntryStatus } | null };
};

export async function getLeagueRow(db: DbOrTx, id: string): Promise<LeagueRow> {
    const row = await db.select().from(leagues).where(eq(leagues.id, id)).get();
    if (!row) throw notFound(ErrorCodes.LEAGUE_NOT_FOUND, "League not found");
    return row;
}

export const canManage = (league: LeagueRow, actor: Actor | null) =>
    !!actor && (actor.role === "admin" || league.commissionerId === actor.id);

export function requireManager(ctx: Ctx, league: LeagueRow): Actor {
    const actor = requireActor(ctx);
    if (!canManage(league, actor)) throw forbidden("Only the league's commissioner can do that");
    return actor;
}

const STATUS_WORDS: Record<LeagueStatus, string> = {
    setup: "being set up",
    registration: "open for registration",
    drafting: "drafting",
    season: "in its season",
    completed: "completed",
    cancelled: "cancelled",
};

export function requireStatus(league: LeagueRow, allowed: LeagueStatus[], action: string) {
    if (!allowed.includes(league.status)) {
        throw conflict(ErrorCodes.LEAGUE_INVALID_STATE, `You can't ${action} while the league is ${STATUS_WORDS[league.status]}`);
    }
}

function validSettings(merged: unknown): LeagueSettings {
    const parsed = LeagueSettingsSchema.safeParse(merged);
    if (!parsed.success) {
        throw invalid(
            ErrorCodes.VALIDATION_ERROR,
            "Invalid league settings",
            zodDetails(parsed.error.issues).map((d) => ({ ...d, path: `settings.${d.path}` })),
        );
    }
    return parsed.data;
}

/** Pending + approved entries: the places taken (or about to be). */
async function activeEntryCount(db: DbOrTx, leagueId: string): Promise<number> {
    const [row] = await db
        .select({ n: count() })
        .from(entries)
        .where(and(eq(entries.leagueId, leagueId), inArray(entries.status, ["pending", "approved"])));
    return row?.n ?? 0;
}

// ---- Reading ----

async function toDtos(db: DbOrTx, rows: LeagueRow[], actor: Actor | null): Promise<LeagueDto[]> {
    if (rows.length === 0) return [];
    const ids = rows.map((r) => r.id);
    const counts = await db
        .select({ leagueId: entries.leagueId, status: entries.status, n: count() })
        .from(entries)
        .where(inArray(entries.leagueId, ids))
        .groupBy(entries.leagueId, entries.status);
    const pools = await db
        .select({ account: ledger.account, total: sql<number>`coalesce(sum(${ledger.amount}), 0)` })
        .from(ledger)
        .where(inArray(ledger.account, ids.map(leagueAccount)))
        .groupBy(ledger.account);
    const commissioners = await db
        .select({ id: users.id, displayName: users.displayName })
        .from(users)
        .where(inArray(users.id, [...new Set(rows.map((r) => r.commissionerId))]));
    const mine = actor
        ? await db
              .select({ id: entries.id, leagueId: entries.leagueId, teamName: entries.teamName, status: entries.status })
              .from(entries)
              .where(and(eq(entries.userId, actor.id), inArray(entries.leagueId, ids)))
        : [];

    return rows.map((r) => {
        const n = (status: EntryStatus) => counts.find((c) => c.leagueId === r.id && c.status === status)?.n ?? 0;
        const manage = canManage(r, actor);
        const my = mine.find((m) => m.leagueId === r.id);
        return {
            id: r.id,
            name: r.name,
            format: r.format,
            status: r.status,
            settings: r.settings,
            createdAt: r.createdAt,
            commissioner: commissioners.find((c) => c.id === r.commissionerId) ?? { id: r.commissionerId, displayName: "(deleted)" },
            counts: { approved: n("approved"), pending: n("pending") },
            prizePool: Number(pools.find((p) => p.account === leagueAccount(r.id))?.total ?? 0),
            webhook: manage ? { configured: !!r.webhookUrl, masked: maskWebhookUrl(r.webhookUrl) } : null,
            me: { canManage: manage, entry: my ? { id: my.id, teamName: my.teamName, status: my.status } : null },
        };
    });
}

export async function getLeague(ctx: Ctx, id: string): Promise<LeagueDto> {
    requireActor(ctx);
    const row = await getLeagueRow(ctx.db, id);
    const [dto] = await toDtos(ctx.db, [row], ctx.actor);
    return dto!;
}

export async function listLeagues(ctx: Ctx, q: z.infer<typeof LeaguesQuerySchema>) {
    const actor = requireActor(ctx);
    const filters: SQL[] = [];
    if (q.status) filters.push(eq(leagues.status, q.status));
    if (q.mine) {
        const myLeagueIds = ctx.db.select({ id: entries.leagueId }).from(entries).where(eq(entries.userId, actor.id));
        filters.push(or(eq(leagues.commissionerId, actor.id), inArray(leagues.id, myLeagueIds))!);
    }
    const where = filters.length ? and(...filters) : undefined;
    const [{ total } = { total: 0 }] = await ctx.db.select({ total: count() }).from(leagues).where(where);
    const rows = await ctx.db
        .select()
        .from(leagues)
        .where(where)
        .orderBy(desc(leagues.createdAt), leagues.name)
        .limit(q.pageSize)
        .offset((q.page - 1) * q.pageSize);
    return { data: await toDtos(ctx.db, rows, actor), page: q.page, pageSize: q.pageSize, total };
}

// ---- Changing ----

export async function createLeague(ctx: Ctx, input: z.infer<typeof CreateLeagueSchema>): Promise<LeagueDto> {
    const actor = requireActor(ctx);
    const settings = validSettings({ ...DEFAULT_SETTINGS, ...input.settings });
    const id = newId("lg");
    await ctx.db.transaction(async (tx) => {
        await tx.insert(leagues).values({
            id,
            name: input.name,
            format: input.format,
            status: "setup",
            commissionerId: actor.id,
            settings,
            createdAt: nowIso(ctx),
        });
        // The default tier list: a cost for every species from its base stats; legendaries banned
        const species = await tx
            .select({ id: pokemon.id, bst: pokemon.bst, isLegendary: pokemon.isLegendary, isMythical: pokemon.isMythical })
            .from(pokemon);
        const rows = species.map((p) => ({ leagueId: id, pokemonId: p.id, points: defaultPoints(p.bst), banned: defaultBanned(p) }));
        for (let i = 0; i < rows.length; i += 250) await tx.insert(leaguePool).values(rows.slice(i, i + 250));
    });
    return getLeague(ctx, id);
}

export async function updateLeague(ctx: Ctx, id: string, input: z.infer<typeof UpdateLeagueSchema>): Promise<LeagueDto> {
    await ctx.db.transaction(async (tx) => {
        const league = await getLeagueRow(tx, id);
        requireManager(ctx, league);
        requireStatus(league, ["setup", "registration"], "change the settings");
        const patch: Partial<LeagueRow> = {};
        if (input.name !== undefined) patch.name = input.name;
        if (input.format !== undefined) patch.format = input.format;
        if (input.settings) {
            const next = validSettings({ ...league.settings, ...input.settings });
            const active = await activeEntryCount(tx, id);
            if (active > 0 && next.entryFee !== league.settings.entryFee) {
                throw conflict(ErrorCodes.LEAGUE_SETTING_LOCKED, "The entry fee can't change once coaches have paid it");
            }
            if (next.maxCoaches < active) {
                throw conflict(ErrorCodes.LEAGUE_SETTING_LOCKED, `${active} coaches have applied, so the limit can't go below ${active}`);
            }
            patch.settings = next;
        }
        if (Object.keys(patch).length > 0) await tx.update(leagues).set(patch).where(eq(leagues.id, id));
    });
    return getLeague(ctx, id);
}

export async function openRegistration(ctx: Ctx, id: string): Promise<LeagueDto> {
    await ctx.db.transaction(async (tx) => {
        const league = await getLeagueRow(tx, id);
        requireManager(ctx, league);
        requireStatus(league, ["setup"], "open registration");
        await tx.update(leagues).set({ status: "registration" }).where(eq(leagues.id, id));
    });
    return getLeague(ctx, id);
}

/** What a coach has paid for an entry, net of any refunds (from the ledger, not from the current fee). */
export async function netPaid(db: DbOrTx, userId: string, entryId: string): Promise<number> {
    const [row] = await db
        .select({ total: sql<number>`coalesce(sum(${ledger.amount}), 0)` })
        .from(ledger)
        .where(and(eq(ledger.account, userAccount(userId)), eq(ledger.ref, entryId)));
    return -Number(row?.total ?? 0);
}

export async function refundEntry(
    db: DbOrTx,
    league: LeagueRow,
    entry: { id: string; userId: string },
    memo: string,
    at: string,
): Promise<number> {
    const paid = await netPaid(db, entry.userId, entry.id);
    if (paid > 0) {
        await transfer(db, { from: leagueAccount(league.id), to: userAccount(entry.userId), amount: paid, kind: "refund", ref: entry.id, memo, at });
    }
    return paid;
}

export async function cancelLeague(ctx: Ctx, id: string): Promise<LeagueDto> {
    await ctx.db.transaction(async (tx) => {
        const league = await getLeagueRow(tx, id);
        requireManager(ctx, league);
        requireStatus(league, ["setup", "registration"], "cancel the league");
        const active = await tx
            .select({ id: entries.id, userId: entries.userId })
            .from(entries)
            .where(and(eq(entries.leagueId, id), inArray(entries.status, ["pending", "approved"])));
        for (const e of active) {
            await refundEntry(tx, league, e, `Refund: ${league.name} was cancelled`, nowIso(ctx));
            await tx.update(entries).set({ status: "withdrawn" }).where(eq(entries.id, e.id));
        }
        await tx.update(leagues).set({ status: "cancelled" }).where(eq(leagues.id, id));
    });
    return getLeague(ctx, id);
}

export async function setWebhook(ctx: Ctx, id: string, url: string | null): Promise<LeagueDto> {
    const league = await getLeagueRow(ctx.db, id);
    requireManager(ctx, league);
    let value: string | null = null;
    if (url) {
        const check = checkWebhookUrl(url, getConfig().webhookAllowedHosts);
        if (!check.ok) throw new AppError(422, ErrorCodes.WEBHOOK_URL_NOT_ALLOWED, check.reason);
        value = check.url;
    }
    await ctx.db.transaction((tx) => tx.update(leagues).set({ webhookUrl: value }).where(eq(leagues.id, id)));
    return getLeague(ctx, id);
}
