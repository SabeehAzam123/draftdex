import { describe, expect, it } from "vitest";
import { addSeconds, maxAffordable, poolFeasibility, shuffle, snakeSlots } from "./draft";
import { parsePoolCsv } from "./pool-csv";
import { showdownName, toShowdownText } from "./showdown";
import { defaultBanned, defaultPoints } from "./tiers";
import { checkWebhookUrl, maskWebhookUrl } from "./webhook";

describe("defaultPoints", () => {
    it.each([
        [720, 20],
        [600, 20],
        [599, 18],
        [580, 18],
        [579, 16],
        [550, 16],
        [520, 14],
        [500, 12],
        [480, 10],
        [450, 8],
        [400, 5],
        [350, 3],
        [349, 1],
        [180, 1],
    ])("base stat total %i costs %i points", (bst, points) => {
        expect(defaultPoints(bst)).toBe(points);
    });
});

describe("defaultBanned", () => {
    it("bans legendary and mythical Pokémon only", () => {
        expect(defaultBanned({ isLegendary: true, isMythical: false })).toBe(true);
        expect(defaultBanned({ isLegendary: false, isMythical: true })).toBe(true);
        expect(defaultBanned({ isLegendary: false, isMythical: false })).toBe(false);
    });
});

describe("snakeSlots", () => {
    it("reverses the order every other round and numbers slots from 1", () => {
        const slots = snakeSlots(["A", "B", "C"], 3);
        expect(slots.map((s) => s.entryId).join("")).toBe("ABCCBAABC");
        expect(slots.map((s) => s.slotNo)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
        expect(slots.map((s) => s.round)).toEqual([1, 1, 1, 2, 2, 2, 3, 3, 3]);
    });

    it("gives every coach the same number of picks", () => {
        const slots = snakeSlots(["A", "B", "C", "D"], 5);
        for (const id of ["A", "B", "C", "D"]) expect(slots.filter((s) => s.entryId === id)).toHaveLength(5);
    });

    it("rejects an empty or duplicated order", () => {
        expect(() => snakeSlots([], 3)).toThrow(/empty/);
        expect(() => snakeSlots(["A", "A"], 3)).toThrow(/duplicates/);
    });
});

describe("maxAffordable", () => {
    it("keeps enough budget to fill the remaining slots at the minimum cost", () => {
        // 100 budget, nothing spent, 10 slots to fill: this pick may cost up to 100 - 9*1
        expect(maxAffordable({ budget: 100, spent: 0, openSlots: 10, minCost: 1 })).toBe(91);
    });

    it("lets the last pick use everything that's left", () => {
        expect(maxAffordable({ budget: 100, spent: 88, openSlots: 1, minCost: 1 })).toBe(12);
    });

    it("accounts for a higher minimum cost", () => {
        expect(maxAffordable({ budget: 60, spent: 10, openSlots: 4, minCost: 3 })).toBe(41);
    });

    it("never treats zero open slots as negative slots", () => {
        expect(maxAffordable({ budget: 50, spent: 50, openSlots: 0, minCost: 1 })).toBe(0);
    });
});

describe("poolFeasibility", () => {
    const pool = (n1: number, others: number[] = []) => [...Array<number>(n1).fill(1), ...others];

    it("passes when the cheapest tier can fill every slot", () => {
        expect(poolFeasibility({ draftablePoints: pool(20, [10, 12]), coaches: 2, rosterSize: 10, budget: 100 })).toEqual({
            ok: true,
            minCost: 1,
        });
    });

    it("fails when there aren't enough draftable Pokémon", () => {
        const r = poolFeasibility({ draftablePoints: pool(5), coaches: 2, rosterSize: 3, budget: 100 });
        expect(r).toMatchObject({ ok: false });
        expect(!r.ok && r.reason).toMatch(/5 draftable.*6 are needed/);
    });

    it("fails when the cheapest tier is too small", () => {
        const r = poolFeasibility({ draftablePoints: pool(3, [5, 5, 5, 5]), coaches: 2, rosterSize: 2, budget: 100 });
        expect(!r.ok && r.reason).toMatch(/Only 3 Pokémon cost 1/);
    });

    it("fails when even the cheapest roster is over budget", () => {
        const r = poolFeasibility({ draftablePoints: Array<number>(10).fill(5), coaches: 2, rosterSize: 5, budget: 20 });
        expect(!r.ok && r.reason).toMatch(/costs 25, over the budget of 20/);
    });
});

describe("shuffle", () => {
    it("keeps every item and uses the random source", () => {
        const items = ["A", "B", "C", "D"];
        const out = shuffle(items, () => 0);
        expect([...out].sort()).toEqual(items);
        expect(out).not.toEqual(items);
        expect(items).toEqual(["A", "B", "C", "D"]); // input unchanged
    });
});

describe("addSeconds", () => {
    it("adds seconds to an ISO timestamp", () => {
        expect(addSeconds("2026-11-09T10:00:00.000Z", 90)).toBe("2026-11-09T10:01:30.000Z");
    });
});

describe("Showdown export", () => {
    it("maps the names Showdown spells differently", () => {
        expect(showdownName("Nidoran♀")).toBe("Nidoran-F");
        expect(showdownName("Nidoran♂")).toBe("Nidoran-M");
        expect(showdownName("Mr. Mime")).toBe("Mr. Mime");
    });

    it("writes one block per Pokémon with a blank line between", () => {
        expect(toShowdownText(["Garchomp", "Nidoran♀", "Type: Null"])).toBe("Garchomp\n\nNidoran-F\n\nType: Null\n");
        expect(toShowdownText([])).toBe("");
    });
});

describe("checkWebhookUrl", () => {
    const allowed = ["discord.com", "discordapp.com"];

    it("accepts an https Discord webhook, including subdomains", () => {
        expect(checkWebhookUrl("https://discord.com/api/webhooks/1/abc", allowed)).toMatchObject({ ok: true });
        expect(checkWebhookUrl("https://canary.discord.com/api/webhooks/1/abc", allowed)).toMatchObject({ ok: true });
    });

    it.each([
        ["not a url", /valid URL/],
        ["https://evil.example/api/webhooks/1/abc", /isn't allowed/],
        ["https://discord.com.evil.example/x", /isn't allowed/],
        ["http://discord.com/api/webhooks/1/abc", /https/],
        ["https://user:pass@discord.com/api/webhooks/1/abc", /username or password/],
        ["https://169.254.169.254/latest/meta-data", /isn't allowed/],
    ])("refuses %s", (url, reason) => {
        const r = checkWebhookUrl(url, allowed);
        expect(r.ok).toBe(false);
        expect(!r.ok && r.reason).toMatch(reason);
    });

    it("allows plain http only for a listed local address", () => {
        expect(checkWebhookUrl("http://127.0.0.1:9000/hook", ["127.0.0.1"])).toMatchObject({ ok: true });
        expect(checkWebhookUrl("http://localhost:9000/hook", ["localhost"])).toMatchObject({ ok: true });
        expect(checkWebhookUrl("http://10.0.0.5/hook", ["discord.com"])).toMatchObject({ ok: false });
    });
});

describe("maskWebhookUrl", () => {
    it("hides the token part of a Discord webhook", () => {
        expect(maskWebhookUrl("https://discord.com/api/webhooks/123/secret-token")).toBe("https://discord.com/api/webhooks/****");
    });

    it("keeps only the first path part of other URLs", () => {
        expect(maskWebhookUrl("http://localhost:9000/hooks/abc/def")).toBe("http://localhost:9000/hooks/****");
    });

    it("handles empty and broken values", () => {
        expect(maskWebhookUrl(null)).toBeNull();
        expect(maskWebhookUrl("::not-a-url")).toBe("****");
    });
});

describe("parsePoolCsv", () => {
    it("reads dex numbers, names and banned rows, skipping the header and comments", () => {
        const { rows, errors } = parsePoolCsv("dex,points\n445,18\n# comment\n\nGarchomp, 16\nMewtwo,BANNED\n");
        expect(errors).toEqual([]);
        expect(rows).toEqual([
            { line: 2, key: 445, points: 18, banned: false },
            { line: 5, key: "Garchomp", points: 16, banned: false },
            { line: 6, key: "Mewtwo", points: null, banned: true },
        ]);
    });

    it("reports each bad line with its number", () => {
        const { rows, errors } = parsePoolCsv("1,5\n2\n3,abc\n4,25\n,5");
        expect(rows).toHaveLength(1);
        expect(errors).toEqual([
            { line: 2, message: "Expected 2 values, found 1" },
            { line: 3, message: '"abc" isn\'t a number of points or "banned"' },
            { line: 4, message: "Points must be 1–20, got 25" },
            { line: 5, message: "The Pokémon is missing" },
        ]);
    });
});
