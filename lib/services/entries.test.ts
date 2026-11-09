import { beforeAll, describe, expect, it } from "vitest";
import type { Db } from "@/lib/db/client";
import { ctxOf, expectError, expectLedgerBalanced, leagueWithCoaches, makeUser, setupDb } from "@/test/helpers";
import { applyToLeague, approveEntry, listEntries, rejectEntry, withdrawEntry } from "./entries";
import { createLeague, openRegistration, updateLeague } from "./leagues";
import { balanceOf, leagueAccount, userAccount } from "./ledger";

let db: Db;
beforeAll(async () => {
    db = await setupDb();
});

async function openLeague(settings = {}) {
    const commissioner = await makeUser(db, { name: "Commissioner" });
    const league = await createLeague(ctxOf(db, commissioner), { name: "Entries League", format: "singles", settings });
    await openRegistration(ctxOf(db, commissioner), league.id);
    return { commissioner, league };
}

describe("applyToLeague", () => {
    it("creates a pending entry and charges the fee into the league's pool", async () => {
        const { league } = await openLeague({ entryFee: 100 });
        const coach = await makeUser(db, { name: "Applicant" });
        const entry = await applyToLeague(ctxOf(db, coach), league.id, { teamName: "Fresh Team" });
        expect(entry).toMatchObject({ teamName: "Fresh Team", status: "pending", coach: { id: coach.id, displayName: "Applicant" } });
        expect(await balanceOf(db, userAccount(coach.id))).toBe(900);
        expect(await balanceOf(db, leagueAccount(league.id))).toBe(100);
        await expectLedgerBalanced(db);
    });

    it("costs nothing in a free league", async () => {
        const { league } = await openLeague({ entryFee: 0 });
        const coach = await makeUser(db);
        await applyToLeague(ctxOf(db, coach), league.id, { teamName: "Free Team" });
        expect(await balanceOf(db, userAccount(coach.id))).toBe(1000);
    });

    it("refuses when the coach can't pay", async () => {
        const { commissioner, league } = await openLeague({ entryFee: 1000 });
        const coach = await makeUser(db);
        await applyToLeague(ctxOf(db, coach), league.id, { teamName: "All In" });
        // A second league with a fee the coach can no longer cover
        const second = await createLeague(ctxOf(db, commissioner), { name: "Second", format: "singles", settings: { entryFee: 50 } });
        await openRegistration(ctxOf(db, commissioner), second.id);
        await expect(applyToLeague(ctxOf(db, coach), second.id, { teamName: "Broke" })).rejects.toMatchObject({
            status: 422,
            code: "ENTRY_INSUFFICIENT_CREDITS",
            message: "The entry fee is 50 credits; you have 0",
        });
    });

    it("refuses a second application and a team name already in use", async () => {
        const { league } = await openLeague();
        const a = await makeUser(db);
        const b = await makeUser(db);
        await applyToLeague(ctxOf(db, a), league.id, { teamName: "Thunder Ducks" });
        await expectError(applyToLeague(ctxOf(db, a), league.id, { teamName: "Other Name" }), 409, "ENTRY_ALREADY_EXISTS");
        await expectError(applyToLeague(ctxOf(db, b), league.id, { teamName: "THUNDER ducks" }), 409, "ENTRY_TEAM_NAME_TAKEN");
    });

    it("refuses when the league is full", async () => {
        const { league } = await openLeague({ maxCoaches: 2 });
        for (let i = 0; i < 2; i++) await applyToLeague(ctxOf(db, await makeUser(db)), league.id, { teamName: `Team ${i}` });
        await expectError(applyToLeague(ctxOf(db, await makeUser(db)), league.id, { teamName: "Late" }), 409, "ENTRY_LEAGUE_FULL");
    });

    it("only while registration is open", async () => {
        const me = await makeUser(db);
        const league = await createLeague(ctxOf(db, me), { name: "Not open", format: "singles", settings: {} });
        await expectError(applyToLeague(ctxOf(db, me), league.id, { teamName: "Too Early" }), 409, "LEAGUE_INVALID_STATE");
        await expectError(applyToLeague(ctxOf(db, me), "lg_missing", { teamName: "Nowhere" }), 404, "LEAGUE_NOT_FOUND");
    });
});

describe("approve and reject", () => {
    it("approves a pending entry and raises a notification event", async () => {
        const { commissioner, league } = await openLeague();
        const coach = await makeUser(db);
        const entry = await applyToLeague(ctxOf(db, coach), league.id, { teamName: "Approved Team" });
        const ctx = ctxOf(db, commissioner);
        expect(await approveEntry(ctx, league.id, entry.id)).toMatchObject({ status: "approved" });
        expect(ctx.events).toEqual([
            expect.objectContaining({ leagueId: league.id, type: "entry.approved", text: expect.stringContaining("Approved Team") }),
        ]);
        await expectError(approveEntry(ctx, league.id, entry.id), 409, "ENTRY_INVALID_STATE");
    });

    it("rejects with a refund of what was paid", async () => {
        const { commissioner, league } = await openLeague({ entryFee: 60 });
        const coach = await makeUser(db);
        const entry = await applyToLeague(ctxOf(db, coach), league.id, { teamName: "Rejected Team" });
        expect(await rejectEntry(ctxOf(db, commissioner), league.id, entry.id)).toMatchObject({ status: "rejected" });
        expect(await balanceOf(db, userAccount(coach.id))).toBe(1000);
        expect(await balanceOf(db, leagueAccount(league.id))).toBe(0);
        await expectLedgerBalanced(db);
    });

    it("is for the commissioner only", async () => {
        const { league } = await openLeague();
        const coach = await makeUser(db);
        const entry = await applyToLeague(ctxOf(db, coach), league.id, { teamName: "Self Approver" });
        await expectError(approveEntry(ctxOf(db, coach), league.id, entry.id), 403, "RBAC_FORBIDDEN");
        await expectError(rejectEntry(ctxOf(db, coach), league.id, entry.id), 403, "RBAC_FORBIDDEN");
    });

    it("answers 404 for an entry from another league", async () => {
        const one = await openLeague();
        const two = await openLeague();
        const entry = await applyToLeague(ctxOf(db, await makeUser(db)), one.league.id, { teamName: "Elsewhere" });
        await expectError(approveEntry(ctxOf(db, two.commissioner), two.league.id, entry.id), 404, "ENTRY_NOT_FOUND");
    });
});

describe("withdrawEntry", () => {
    it("refunds the coach, and they can apply again (paying again)", async () => {
        const { league } = await openLeague({ entryFee: 100 });
        const coach = await makeUser(db);
        const entry = await applyToLeague(ctxOf(db, coach), league.id, { teamName: "Back Again" });
        expect(await withdrawEntry(ctxOf(db, coach), league.id, entry.id)).toMatchObject({ status: "withdrawn" });
        expect(await balanceOf(db, userAccount(coach.id))).toBe(1000);
        await expectError(withdrawEntry(ctxOf(db, coach), league.id, entry.id), 409, "ENTRY_INVALID_STATE");

        const again = await applyToLeague(ctxOf(db, coach), league.id, { teamName: "Back Again" });
        expect(again).toMatchObject({ id: entry.id, status: "pending" });
        expect(await balanceOf(db, userAccount(coach.id))).toBe(900);
        await expectLedgerBalanced(db);
    });

    it("refunds what was actually paid, even if the fee changed since", async () => {
        const { commissioner, league } = await openLeague({ entryFee: 100 });
        const early = await makeUser(db);
        const entry = await applyToLeague(ctxOf(db, early), league.id, { teamName: "Early Bird" });
        await withdrawEntry(ctxOf(db, early), league.id, entry.id);
        await updateLeague(ctxOf(db, commissioner), league.id, { settings: { entryFee: 30 } });
        const again = await applyToLeague(ctxOf(db, early), league.id, { teamName: "Early Bird" });
        expect(await balanceOf(db, userAccount(early.id))).toBe(970);
        await withdrawEntry(ctxOf(db, early), league.id, again.id);
        expect(await balanceOf(db, userAccount(early.id))).toBe(1000);
    });

    it("is for the coach themself, before the draft", async () => {
        const { commissioner, league, coaches } = await leagueWithCoaches(db, { coaches: 2 });
        await expectError(withdrawEntry(ctxOf(db, commissioner), league.id, coaches[0]!.entryId), 403, "RBAC_FORBIDDEN");
        const drafted = await leagueWithCoaches(db, { coaches: 2, draft: true });
        await expectError(
            withdrawEntry(ctxOf(db, drafted.coaches[0]!.actor), drafted.league.id, drafted.coaches[0]!.entryId),
            409,
            "LEAGUE_INVALID_STATE",
        );
    });
});

describe("listEntries", () => {
    it("lists every entry with its coach, oldest first", async () => {
        const { league, coaches } = await leagueWithCoaches(db, { coaches: 3 });
        const list = await listEntries(ctxOf(db, coaches[1]!.actor), league.id);
        expect(list.map((e) => e.id)).toEqual(coaches.map((c) => c.entryId));
        expect(list[0]).toMatchObject({ status: "approved", coach: { displayName: "Coach 1" } });
    });
});
