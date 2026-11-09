/** Draft rules with no database: order, budget and feasibility. */

export type PlannedSlot = { slotNo: number; entryId: string; round: number };

/**
 * Snake order: round 1 goes A B C, round 2 C B A, round 3 A B C, …
 * Slot numbers start at 1 and run through every round.
 */
export function snakeSlots(order: readonly string[], rounds: number): PlannedSlot[] {
    if (order.length === 0) throw new Error("draft order is empty");
    if (new Set(order).size !== order.length) throw new Error("draft order has duplicates");
    const slots: PlannedSlot[] = [];
    let slotNo = 1;
    for (let round = 1; round <= rounds; round++) {
        const line = round % 2 === 1 ? order : [...order].reverse();
        for (const entryId of line) slots.push({ slotNo: slotNo++, entryId, round });
    }
    return slots;
}

/**
 * The most a coach may spend on the pick they're making now, so they can still fill every
 * remaining slot with the cheapest Pokémon in the pool.
 *
 * @param openSlots the coach's open slots, counting the one being picked now
 */
export function maxAffordable(args: { budget: number; spent: number; openSlots: number; minCost: number }): number {
    const { budget, spent, openSlots, minCost } = args;
    const slotsAfterThis = Math.max(0, openSlots - 1);
    return budget - spent - slotsAfterThis * minCost;
}

export type Feasibility = { ok: true; minCost: number } | { ok: false; reason: string };

/**
 * Can every coach always complete a roster? True when the cheapest tier alone has enough Pokémon
 * for every slot in the draft, and a full roster of them fits the budget.
 */
export function poolFeasibility(args: {
    draftablePoints: readonly number[];
    coaches: number;
    rosterSize: number;
    budget: number;
}): Feasibility {
    const { draftablePoints, coaches, rosterSize, budget } = args;
    const needed = coaches * rosterSize;
    if (draftablePoints.length < needed) {
        return { ok: false, reason: `The pool has ${draftablePoints.length} draftable Pokémon; ${needed} are needed` };
    }
    const minCost = Math.min(...draftablePoints);
    const atMin = draftablePoints.filter((p) => p === minCost).length;
    if (atMin < needed) {
        return {
            ok: false,
            reason: `Only ${atMin} Pokémon cost ${minCost} point(s); ${needed} are needed so every coach can always fill a roster`,
        };
    }
    if (minCost * rosterSize > budget) {
        return { ok: false, reason: `A roster of the cheapest Pokémon costs ${minCost * rosterSize}, over the budget of ${budget}` };
    }
    return { ok: true, minCost };
}

/** Fisher–Yates shuffle with an injectable random source (tests pass a fixed one). */
export function shuffle<T>(items: readonly T[], random: () => number = Math.random): T[] {
    const out = [...items];
    for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(random() * (i + 1));
        [out[i], out[j]] = [out[j]!, out[i]!];
    }
    return out;
}

/** Adds seconds to an ISO timestamp. */
export function addSeconds(iso: string, seconds: number): string {
    return new Date(new Date(iso).getTime() + seconds * 1000).toISOString();
}
