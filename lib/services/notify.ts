import { desc, eq, inArray } from "drizzle-orm";
import { APP_NAME, getConfig } from "@/lib/config";
import type { Db } from "@/lib/db/client";
import { leagues, notifications } from "@/lib/db/schema";
import { checkWebhookUrl } from "@/lib/domain/webhook";
import { conflict } from "@/lib/errors/app-error";
import { ErrorCodes } from "@/lib/errors/codes";
import { nowIso, type Ctx, type DomainEvent, type EventType } from "./context";
import { getLeagueRow, requireManager } from "./leagues";

/** The part of `fetch` this needs, so tests can pass a fake. */
export type PostFn = (url: string, init: { method: "POST"; headers: Record<string, string>; body: string; signal: AbortSignal }) => Promise<{ status: number }>;

const COLORS: Record<EventType, number> = {
    "entry.approved": 0x3b82f6,
    "draft.started": 0x8b5cf6,
    "pick.made": 0x10b981,
    "pick.skipped": 0xf59e0b,
    "pick.auto": 0xf59e0b,
    "draft.completed": 0xec4899,
    test: 0x64748b,
};

export type Delivery = { status: "sent" | "failed"; httpStatus: number | null; error: string | null };

/** Discord's webhook format. Errors never include the URL: it holds the webhook's secret token. */
export async function postToWebhook(url: string, event: DomainEvent, post: PostFn): Promise<Delivery> {
    const check = checkWebhookUrl(url, getConfig().webhookAllowedHosts);
    if (!check.ok) return { status: "failed", httpStatus: null, error: "The webhook's host is no longer allowed" };
    try {
        const res = await post(check.url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ username: APP_NAME, embeds: [{ title: event.title, description: event.text, color: COLORS[event.type] }] }),
            signal: AbortSignal.timeout(3000),
        });
        const ok = res.status >= 200 && res.status < 300;
        return { status: ok ? "sent" : "failed", httpStatus: res.status, error: ok ? null : `HTTP ${res.status}` };
    } catch (err) {
        const timedOut = err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
        return { status: "failed", httpStatus: null, error: timedOut ? "Timed out after 3 s" : "Network error" };
    }
}

const realPost: PostFn = (url, init) => fetch(url, init);

/** Sends each event to its league's webhook (if it has one) and records the outcome. Never throws. */
export async function deliverEvents(db: Db, events: DomainEvent[], post: PostFn = realPost): Promise<void> {
    if (events.length === 0) return;
    const ids = [...new Set(events.map((e) => e.leagueId))];
    const rows = await db.select({ id: leagues.id, url: leagues.webhookUrl }).from(leagues).where(inArray(leagues.id, ids));
    for (const event of events) {
        const url = rows.find((r) => r.id === event.leagueId)?.url;
        if (!url) continue;
        const d = await postToWebhook(url, event, post);
        await db.transaction((tx) =>
            tx.insert(notifications).values({
                leagueId: event.leagueId,
                event: event.type,
                status: d.status,
                httpStatus: d.httpStatus,
                error: d.error,
                createdAt: new Date().toISOString(),
            }),
        );
    }
}

export async function sendTestNotification(ctx: Ctx, leagueId: string, post: PostFn = realPost): Promise<Delivery> {
    const league = await getLeagueRow(ctx.db, leagueId);
    requireManager(ctx, league);
    if (!league.webhookUrl) throw conflict(ErrorCodes.WEBHOOK_NOT_CONFIGURED, "Set a webhook URL first");
    const event: DomainEvent = { leagueId, type: "test", title: `${APP_NAME} is connected`, text: `Notifications for **${league.name}** will appear here.` };
    const d = await postToWebhook(league.webhookUrl, event, post);
    await ctx.db.transaction((tx) => tx.insert(notifications).values({ leagueId, event: "test", ...d, createdAt: nowIso(ctx) }));
    return d;
}

export async function listNotifications(ctx: Ctx, leagueId: string) {
    const league = await getLeagueRow(ctx.db, leagueId);
    requireManager(ctx, league);
    return ctx.db
        .select({
            id: notifications.id,
            event: notifications.event,
            status: notifications.status,
            httpStatus: notifications.httpStatus,
            error: notifications.error,
            createdAt: notifications.createdAt,
        })
        .from(notifications)
        .where(eq(notifications.leagueId, leagueId))
        .orderBy(desc(notifications.id))
        .limit(50);
}
