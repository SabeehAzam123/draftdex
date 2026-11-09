/** Season rules with no database: schedule, scores, standings, prizes. */

export type Fixture = { week: number; home: string; away: string };

/**
 * Round robin by the circle method: every team plays every other team exactly once.
 * n teams → n-1 weeks (n even) or n weeks with one team resting each week (n odd).
 *
 * Home and away: number the teams 0…n-1 in the order given; in each pairing the lower number is home
 * when the two numbers add up to an odd number, otherwise the higher. Every team then gets the same
 * number of home games (n odd) or within one of it (n even), whatever order the weeks run in.
 */
export function roundRobin(entryIds: readonly string[]): Fixture[] {
    if (new Set(entryIds).size !== entryIds.length) throw new Error("duplicate team in the schedule");
    if (entryIds.length < 2) return [];
    const BYE = "\u0000bye";
    const index = new Map(entryIds.map((t, i) => [t, i]));
    const teams = entryIds.length % 2 === 0 ? [...entryIds] : [...entryIds, BYE];
    const n = teams.length;
    const fixtures: Fixture[] = [];
    for (let week = 1; week < n; week++) {
        for (let i = 0; i < n / 2; i++) {
            const a = teams[i]!;
            const b = teams[n - 1 - i]!;
            if (a === BYE || b === BYE) continue;
            const [lo, hi] = index.get(a)! < index.get(b)! ? [a, b] : [b, a];
            const loHome = (index.get(lo)! + index.get(hi)!) % 2 === 1;
            fixtures.push({ week, home: loHome ? lo : hi, away: loHome ? hi : lo });
        }
        // rotate everyone but the first team
        teams.splice(1, 0, teams.pop()!);
    }
    return fixtures;
}

export const GAMES_TO_WIN = 2; // best of three

export type ScoreCheck = { ok: true } | { ok: false; reason: string };

/** A best-of-three result: the winner has 2 games, the loser 0 or 1. */
export function checkScore(homeWins: number, awayWins: number): ScoreCheck {
    for (const n of [homeWins, awayWins]) {
        if (!Number.isInteger(n) || n < 0 || n > GAMES_TO_WIN) return { ok: false, reason: `Each side has 0 to ${GAMES_TO_WIN} game wins` };
    }
    const winners = [homeWins, awayWins].filter((n) => n === GAMES_TO_WIN).length;
    if (winners !== 1) return { ok: false, reason: `Exactly one side must reach ${GAMES_TO_WIN} wins (best of three)` };
    return { ok: true };
}

const REPLAY = /^https:\/\/replay\.pokemonshowdown\.com\/[a-z0-9]+-\d+(-[a-z0-9]+)?\/?$/;

/** A Pokémon Showdown replay link, e.g. https://replay.pokemonshowdown.com/gen9ou-2101234567 */
export function isReplayUrl(url: string): boolean {
    return REPLAY.test(url.trim());
}

export type FinalResult = { home: string; away: string; homeWins: number; awayWins: number };

export type StandingRow = {
    entryId: string;
    played: number;
    wins: number;
    losses: number;
    gamesWon: number;
    gamesLost: number;
    gameDiff: number;
    rank: number;
};

/**
 * Ranks teams by: wins, then game difference, then (for two teams level on both) their head-to-head
 * result, then team name. Teams that haven't played yet still appear, with zeros.
 */
export function computeStandings(teams: readonly { entryId: string; teamName: string }[], results: readonly FinalResult[]): StandingRow[] {
    const rows = new Map<string, StandingRow>(
        teams.map((t) => [t.entryId, { entryId: t.entryId, played: 0, wins: 0, losses: 0, gamesWon: 0, gamesLost: 0, gameDiff: 0, rank: 0 }]),
    );
    for (const r of results) {
        const home = rows.get(r.home);
        const away = rows.get(r.away);
        if (!home || !away) continue;
        home.played++;
        away.played++;
        home.gamesWon += r.homeWins;
        home.gamesLost += r.awayWins;
        away.gamesWon += r.awayWins;
        away.gamesLost += r.homeWins;
        if (r.homeWins > r.awayWins) {
            home.wins++;
            away.losses++;
        } else {
            away.wins++;
            home.losses++;
        }
    }
    for (const row of rows.values()) row.gameDiff = row.gamesWon - row.gamesLost;

    const name = (id: string) => teams.find((t) => t.entryId === id)?.teamName ?? id;
    const headToHead = (a: string, b: string): number => {
        const game = results.find((r) => (r.home === a && r.away === b) || (r.home === b && r.away === a));
        if (!game) return 0;
        const aWon = game.home === a ? game.homeWins > game.awayWins : game.awayWins > game.homeWins;
        return aWon ? -1 : 1;
    };
    const sorted = [...rows.values()].sort((a, b) => b.wins - a.wins || b.gameDiff - a.gameDiff);
    // head-to-head only settles a tie between exactly two teams
    const out: StandingRow[] = [];
    for (let i = 0; i < sorted.length; ) {
        let j = i + 1;
        while (j < sorted.length && sorted[j]!.wins === sorted[i]!.wins && sorted[j]!.gameDiff === sorted[i]!.gameDiff) j++;
        const group = sorted.slice(i, j);
        group.sort((a, b) => (group.length === 2 ? headToHead(a.entryId, b.entryId) : 0) || name(a.entryId).localeCompare(name(b.entryId)));
        out.push(...group);
        i = j;
    }
    out.forEach((row, i) => (row.rank = i + 1));
    return out;
}

/**
 * Splits the prize pool by place. Shares are rounded down; the credits left over by rounding, and the
 * shares of places with no team (e.g. a 3rd-place share in a 2-team league), go to 1st place.
 * The amounts always add up to the pool exactly.
 */
export function splitPrize(pool: number, split: readonly number[], teams: number): number[] {
    if (teams <= 0 || pool <= 0) return [];
    const places = Math.min(teams, split.length);
    const amounts = Array.from({ length: places }, (_, i) => Math.floor((pool * split[i]!) / 100));
    amounts[0]! += pool - amounts.reduce((s, x) => s + x, 0);
    return amounts;
}
