/** Point costs in a league's tier list. */
export const POINTS_MIN = 1;
export const POINTS_MAX = 20;

// [minimum base stat total, points], highest first
const BST_TIERS: ReadonlyArray<readonly [number, number]> = [
    [600, 20],
    [580, 18],
    [550, 16],
    [520, 14],
    [500, 12],
    [480, 10],
    [450, 8],
    [400, 5],
    [350, 3],
];

/** A new league's default cost for a Pokémon, from its base stat total (the commissioner can change it). */
export function defaultPoints(bst: number): number {
    for (const [min, points] of BST_TIERS) if (bst >= min) return points;
    return POINTS_MIN;
}

/** Legendary and mythical Pokémon start banned, a common draft-league rule. */
export function defaultBanned(p: { isLegendary: boolean; isMythical: boolean }): boolean {
    return p.isLegendary || p.isMythical;
}
