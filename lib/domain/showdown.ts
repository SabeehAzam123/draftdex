/**
 * Pokémon Showdown import text. Showdown accepts one block per Pokémon, separated by blank lines;
 * a block can be just the species name (moves, items and abilities aren't part of a draft).
 */

// PokéAPI's English name → Showdown's spelling, where they differ
const SHOWDOWN_NAMES: Record<string, string> = {
    "Nidoran♀": "Nidoran-F",
    "Nidoran♂": "Nidoran-M",
};

export function showdownName(name: string): string {
    return SHOWDOWN_NAMES[name] ?? name;
}

export function toShowdownText(names: readonly string[]): string {
    if (names.length === 0) return "";
    return names.map(showdownName).join("\n\n") + "\n";
}
