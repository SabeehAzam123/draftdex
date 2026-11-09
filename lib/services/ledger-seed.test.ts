import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import type { Db } from "@/lib/db/client";
import { leagues, users } from "@/lib/db/schema";
import { ctxOf, expectLedgerBalanced, setupDb } from "@/test/helpers";
import { getDraftState } from "./draft";
import { balanceOf, historyOf, leagueAccount, SYSTEM_ACCOUNT, transfer, userAccount } from "./ledger";
import { seedPokemon } from "./pokemon";
import { clearData, DEMO_ADMIN, isEmpty, seedDemo } from "./seed";
import { findActor, logIn } from "./users";

let db: Db;
beforeAll(async () => {
    db = await setupDb();
});

describe("transfer", () => {
    it("writes a pair of rows that cancel out", async () => {
        await db.transaction((tx) =>
            transfer(tx, { from: SYSTEM_ACCOUNT, to: userAccount("us_a"), amount: 30, kind: "prize", ref: "x", memo: "Test", at: "2026-11-09T00:00:00.000Z" }),
        );
        expect(await balanceOf(db, userAccount("us_a"))).toBe(30);
        expect(await historyOf(db, userAccount("us_a"))).toEqual([expect.objectContaining({ amount: 30, kind: "prize", memo: "Test" })]);
        await expectLedgerBalanced(db);
    });

    it("refuses amounts that aren't positive whole credits, and self-transfers", async () => {
        const base = { from: SYSTEM_ACCOUNT, to: userAccount("us_b"), kind: "prize" as const, ref: null, memo: "", at: "" };
        await expect(transfer(db, { ...base, amount: 0 })).rejects.toThrow(/positive integer/);
        await expect(transfer(db, { ...base, amount: -5 })).rejects.toThrow(/positive integer/);
        await expect(transfer(db, { ...base, amount: 1.5 })).rejects.toThrow(/positive integer/);
        await expect(transfer(db, { ...base, to: SYSTEM_ACCOUNT, amount: 5 })).rejects.toThrow(/itself/);
    });
});

describe("seedDemo", () => {
    it("builds one league in each state through the real rules, with a balanced ledger", async () => {
        await clearData(db);
        expect(await isEmpty(db)).toBe(true);
        const summary = await seedDemo(db, new Date("2026-11-09T12:00:00.000Z"));

        expect(summary.coaches).toHaveLength(8);
        expect(Object.fromEntries(summary.leagues.map((l) => [l.name, l.status]))).toEqual({
            "Weekend Cup": "setup",
            "Sunday Singles S1": "registration",
            "Office League S3": "drafting",
            "Friends Doubles S2": "season",
        });
        await expectLedgerBalanced(db);

        const admin = await db.select().from(users).where(eq(users.email, DEMO_ADMIN.email)).get();
        expect(admin?.role).toBe("admin");
        expect((await logIn(ctxOf(db, null), DEMO_ADMIN.email, DEMO_ADMIN.password)).user.role).toBe("admin");

        // Sunday Singles: 3 approved + 1 pending, 100 each
        const sunday = (await db.select().from(leagues).where(eq(leagues.name, "Sunday Singles S1")).get())!;
        expect(await balanceOf(db, leagueAccount(sunday.id))).toBe(400);

        // Office League: 14 picks made, pick 15 is next
        const office = (await db.select().from(leagues).where(eq(leagues.name, "Office League S3")).get())!;
        const state = await getDraftState(ctxOf(db, (await findActor(db, admin!.id))!), office.id);
        expect(state.picks).toHaveLength(14);
        expect(state.current?.slotNo).toBe(15);
        expect(state.teams.every((t) => t.spent <= 80)).toBe(true);
    });

    it("clearData keeps the Pokémon species", async () => {
        await clearData(db);
        expect(await isEmpty(db)).toBe(true);
        expect(await seedPokemon(db)).toBe(0); // still loaded
    });
});
