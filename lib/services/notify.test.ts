import { beforeAll, describe, expect, it, vi } from "vitest";
import type { Db } from "@/lib/db/client";
import { ctxOf, expectError, makeUser, setupDb } from "@/test/helpers";
import type { DomainEvent } from "./context";
import { createLeague, setWebhook } from "./leagues";
import { deliverEvents, listNotifications, postToWebhook, sendTestNotification, type PostFn } from "./notify";

let db: Db;
beforeAll(async () => {
    db = await setupDb();
});

const HOOK = "https://discord.com/api/webhooks/1/secret-token";

async function leagueWithHook(url: string | null = HOOK) {
    const me = await makeUser(db);
    const league = await createLeague(ctxOf(db, me), { name: "Notify League", format: "singles", settings: {} });
    if (url) await setWebhook(ctxOf(db, me), league.id, url);
    return { me, league };
}

const event = (leagueId: string): DomainEvent => ({ leagueId, type: "pick.made", title: "Pick 1", text: "**Team** drafted **Garchomp**" });

/** A fake fetch that records calls and answers with `status`, or throws `error`. */
function fakePost(status = 204, error?: Error) {
    const calls: { url: string; body: unknown }[] = [];
    const post: PostFn = vi.fn(async (url, init) => {
        calls.push({ url, body: JSON.parse(init.body) });
        if (error) throw error;
        return { status };
    });
    return { post, calls };
}

describe("postToWebhook", () => {
    it("sends Discord's embed format", async () => {
        const { post, calls } = fakePost(204);
        const d = await postToWebhook(HOOK, event("lg_x"), post);
        expect(d).toEqual({ status: "sent", httpStatus: 204, error: null });
        expect(calls[0]).toEqual({
            url: HOOK,
            body: { username: "DraftDex", embeds: [{ title: "Pick 1", description: "**Team** drafted **Garchomp**", color: expect.any(Number) }] },
        });
    });

    it("reports HTTP errors, timeouts and network errors without the URL", async () => {
        expect(await postToWebhook(HOOK, event("lg_x"), fakePost(404).post)).toEqual({ status: "failed", httpStatus: 404, error: "HTTP 404" });
        const timeout = Object.assign(new Error("aborted"), { name: "TimeoutError" });
        expect(await postToWebhook(HOOK, event("lg_x"), fakePost(0, timeout).post)).toMatchObject({ error: "Timed out after 3 s" });
        const network = await postToWebhook(HOOK, event("lg_x"), fakePost(0, new Error(`connect ECONNREFUSED ${HOOK}`)).post);
        expect(network).toEqual({ status: "failed", httpStatus: null, error: "Network error" });
    });

    it("refuses a URL whose host is no longer allowed, without calling it", async () => {
        const { post } = fakePost();
        expect(await postToWebhook("https://evil.example/hook", event("lg_x"), post)).toMatchObject({ status: "failed" });
        expect(post).not.toHaveBeenCalled();
    });
});

describe("deliverEvents", () => {
    it("posts each event to its league's webhook and records the result", async () => {
        const { me, league } = await leagueWithHook();
        const { post, calls } = fakePost(204);
        await deliverEvents(db, [event(league.id), { ...event(league.id), type: "draft.completed" }], post);
        expect(calls).toHaveLength(2);
        const log = await listNotifications(ctxOf(db, me), league.id);
        expect(log.map((n) => [n.event, n.status, n.httpStatus])).toEqual([
            ["draft.completed", "sent", 204],
            ["pick.made", "sent", 204],
        ]);
    });

    it("skips leagues without a webhook, and records failures", async () => {
        const quiet = await leagueWithHook(null);
        const loud = await leagueWithHook();
        const { post, calls } = fakePost(500);
        await deliverEvents(db, [event(quiet.league.id), event(loud.league.id)], post);
        expect(calls).toHaveLength(1);
        expect(await listNotifications(ctxOf(db, quiet.me), quiet.league.id)).toEqual([]);
        expect(await listNotifications(ctxOf(db, loud.me), loud.league.id)).toEqual([
            expect.objectContaining({ status: "failed", httpStatus: 500, error: "HTTP 500" }),
        ]);
    });

    it("does nothing for no events", async () => {
        const { post } = fakePost();
        await deliverEvents(db, [], post);
        expect(post).not.toHaveBeenCalled();
    });
});

describe("sendTestNotification", () => {
    it("sends a test message and logs it", async () => {
        const { me, league } = await leagueWithHook();
        const { post, calls } = fakePost(204);
        expect(await sendTestNotification(ctxOf(db, me), league.id, post)).toEqual({ status: "sent", httpStatus: 204, error: null });
        expect(calls[0]!.body).toMatchObject({ embeds: [{ title: "DraftDex is connected" }] });
        expect(await listNotifications(ctxOf(db, me), league.id)).toEqual([expect.objectContaining({ event: "test", status: "sent" })]);
    });

    it("needs a webhook and the commissioner", async () => {
        const none = await leagueWithHook(null);
        await expectError(sendTestNotification(ctxOf(db, none.me), none.league.id, fakePost().post), 409, "WEBHOOK_NOT_CONFIGURED");
        const set = await leagueWithHook();
        const other = await makeUser(db);
        await expectError(sendTestNotification(ctxOf(db, other), set.league.id, fakePost().post), 403, "RBAC_FORBIDDEN");
        await expectError(listNotifications(ctxOf(db, other), set.league.id), 403, "RBAC_FORBIDDEN");
    });
});
