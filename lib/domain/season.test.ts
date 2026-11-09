import { describe, expect, it } from "vitest";
import { checkScore, computeStandings, isReplayUrl, roundRobin, splitPrize } from "./season";

describe("roundRobin", () => {
    const pairs = (fx: { home: string; away: string }[]) => fx.map((f) => [f.home, f.away].sort().join("-")).sort();

    it.each([2, 3, 4, 5, 6, 8])("with %i teams every pair meets exactly once", (n) => {
        const teams = Array.from({ length: n }, (_, i) => `T${i + 1}`);
        const fx = roundRobin(teams);
        expect(fx).toHaveLength((n * (n - 1)) / 2);
        expect(new Set(pairs(fx)).size).toBe(fx.length);
        const weeks = n % 2 === 0 ? n - 1 : n;
        expect(Math.max(...fx.map((f) => f.week))).toBe(weeks);
    });

    it("never schedules a team twice in one week", () => {
        const fx = roundRobin(["A", "B", "C", "D", "E", "F"]);
        for (let w = 1; w <= 5; w++) {
            const playing = fx.filter((f) => f.week === w).flatMap((f) => [f.home, f.away]);
            expect(new Set(playing).size).toBe(playing.length);
        }
    });

    it("rests one team per week when the count is odd", () => {
        const fx = roundRobin(["A", "B", "C"]);
        expect(fx.filter((f) => f.week === 1)).toHaveLength(1);
    });

    it.each([4, 5, 6, 8])("spreads home games out evenly (%i teams)", (n) => {
        const teams = Array.from({ length: n }, (_, i) => `T${i + 1}`);
        const fx = roundRobin(teams);
        const homes = teams.map((t) => fx.filter((f) => f.home === t).length);
        expect(Math.max(...homes) - Math.min(...homes)).toBeLessThanOrEqual(1);
    });

    it("handles fewer than two teams and refuses duplicates", () => {
        expect(roundRobin(["A"])).toEqual([]);
        expect(() => roundRobin(["A", "A"])).toThrow(/duplicate/);
    });
});

describe("checkScore", () => {
    it.each([
        [2, 0],
        [2, 1],
        [0, 2],
        [1, 2],
    ])("accepts %i-%i", (h, a) => expect(checkScore(h, a)).toEqual({ ok: true }));

    it.each([
        [2, 2, /Exactly one side/],
        [1, 1, /Exactly one side/],
        [0, 0, /Exactly one side/],
        [3, 0, /0 to 2/],
        [-1, 2, /0 to 2/],
        [1.5, 2, /0 to 2/],
    ])("refuses %s-%s", (h, a, reason) => {
        const r = checkScore(h, a);
        expect(r.ok).toBe(false);
        expect(!r.ok && r.reason).toMatch(reason);
    });
});

describe("isReplayUrl", () => {
    it.each(["https://replay.pokemonshowdown.com/gen9ou-2101234567", "https://replay.pokemonshowdown.com/gen9doublesou-2101234567-abc123xyzpw"])(
        "accepts %s",
        (url) => expect(isReplayUrl(url)).toBe(true),
    );
    it.each(["http://replay.pokemonshowdown.com/gen9ou-1", "https://evil.example/gen9ou-1", "https://replay.pokemonshowdown.com/", "not a url"])(
        "refuses %s",
        (url) => expect(isReplayUrl(url)).toBe(false),
    );
});

describe("computeStandings", () => {
    const teams = ["Ants", "Bees", "Cats", "Dogs"].map((n) => ({ entryId: n[0]!, teamName: n }));
    const r = (home: string, away: string, homeWins: number, awayWins: number) => ({ home, away, homeWins, awayWins });

    it("ranks by wins, then game difference", () => {
        const rows = computeStandings(teams, [r("A", "B", 2, 0), r("C", "D", 2, 1), r("A", "C", 2, 1), r("B", "D", 2, 0)]);
        expect(rows.map((x) => [x.entryId, x.wins, x.gameDiff, x.rank])).toEqual([
            ["A", 2, 3, 1],
            ["B", 1, 0, 2],
            ["C", 1, 0, 3], // level with B on wins and difference: alphabetical (three-way ties don't use head-to-head)
            ["D", 0, -3, 4],
        ]);
    });

    it("breaks a two-team tie by their head-to-head result", () => {
        // B and C both end on 1 win and +0, and C beat B; alphabetically B would come first
        const results = [r("B", "C", 1, 2), r("B", "D", 2, 1), r("A", "C", 2, 1)];
        const rows = computeStandings(teams, results);
        expect(rows.map((x) => [x.entryId, x.wins, x.gameDiff])).toEqual([
            ["A", 1, 1],
            ["C", 1, 0],
            ["B", 1, 0],
            ["D", 0, -1],
        ]);
    });

    it("lists teams that haven't played, with zeros", () => {
        const rows = computeStandings(teams, []);
        expect(rows).toHaveLength(4);
        expect(rows.every((x) => x.played === 0 && x.wins === 0)).toBe(true);
        expect(rows.map((x) => x.entryId)).toEqual(["A", "B", "C", "D"]);
    });
});

describe("splitPrize", () => {
    it("splits by place and gives rounding leftovers to 1st", () => {
        expect(splitPrize(1000, [60, 30, 10], 8)).toEqual([600, 300, 100]);
        const odd = splitPrize(333, [60, 30, 10], 8);
        expect(odd).toEqual([201, 99, 33]);
        expect(odd.reduce((s, x) => s + x, 0)).toBe(333);
    });

    it("gives the share of a place no team can take to 1st", () => {
        expect(splitPrize(200, [60, 30, 10], 2)).toEqual([140, 60]);
    });

    it("pays nothing from an empty pool", () => {
        expect(splitPrize(0, [60, 30, 10], 4)).toEqual([]);
        expect(splitPrize(100, [100], 0)).toEqual([]);
    });
});
