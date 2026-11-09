import { randomUUID } from "node:crypto";
import type { Db, Tx } from "@/lib/db/client";
import type { UserRole } from "@/lib/db/schema";
import { forbidden, unauthorized } from "@/lib/errors/app-error";

export type Actor = { id: string; email: string; displayName: string; role: UserRole };

export const EVENT_TYPES = ["entry.approved", "draft.started", "pick.made", "pick.skipped", "pick.auto", "draft.completed", "test"] as const;
export type EventType = (typeof EVENT_TYPES)[number];

/** Something that happened in a league that its Discord channel should hear about. */
export type DomainEvent = { leagueId: string; type: EventType; title: string; text: string };

/**
 * What every service call gets: the database, who is acting, the time (tests set it), and the events
 * to send once the request has succeeded.
 */
export type Ctx = { db: Db; actor: Actor | null; now: Date; events: DomainEvent[] };

export function makeCtx(db: Db, actor: Actor | null, now: Date = new Date()): Ctx {
    return { db, actor, now, events: [] };
}

export function requireActor(ctx: Ctx): Actor {
    if (!ctx.actor) throw unauthorized();
    return ctx.actor;
}

export function requireAdmin(ctx: Ctx): Actor {
    const actor = requireActor(ctx);
    if (actor.role !== "admin") throw forbidden("Only an admin can do that");
    return actor;
}

export const nowIso = (ctx: Ctx) => ctx.now.toISOString();

/**
 * Runs `fn` in a write transaction. Events it raises join `ctx.events` only after the commit, so a
 * rolled-back change never announces anything on Discord.
 */
export async function withTx<T>(ctx: Ctx, fn: (tx: Tx, events: DomainEvent[]) => Promise<T>): Promise<T> {
    const events: DomainEvent[] = [];
    const result = await ctx.db.transaction((tx) => fn(tx, events));
    ctx.events.push(...events);
    return result;
}

/** Readable ids with a type prefix, e.g. lg_3f2a9c1e0b7d4a55. */
export function newId(prefix: "us" | "lg" | "en" | "pk" | "tx"): string {
    return `${prefix}_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
}
