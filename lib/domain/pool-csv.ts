import { POINTS_MAX, POINTS_MIN } from "./tiers";

/**
 * Parses a tier-list CSV: one Pokémon per line, `<dex number or name>,<points or "banned">`.
 * A header line, blank lines and lines starting with # are skipped.
 *
 *   dex,points
 *   445,18
 *   Garchomp,18
 *   Mewtwo,banned
 */
export type CsvRow = { line: number; key: number | string; points: number | null; banned: boolean };
export type CsvError = { line: number; message: string };

export function parsePoolCsv(text: string): { rows: CsvRow[]; errors: CsvError[] } {
    const rows: CsvRow[] = [];
    const errors: CsvError[] = [];
    const lines = text.split(/\r?\n/);
    lines.forEach((rawLine, i) => {
        const line = i + 1;
        const trimmed = rawLine.trim();
        if (!trimmed || trimmed.startsWith("#")) return;
        const cells = trimmed.split(",").map((c) => c.trim());
        if (cells.length !== 2) {
            errors.push({ line, message: `Expected 2 values, found ${cells.length}` });
            return;
        }
        const [keyText, value] = cells as [string, string];
        if (i === 0 && /^(dex|name|pokemon)$/i.test(keyText) && /^points$/i.test(value)) return; // header
        if (!keyText) {
            errors.push({ line, message: "The Pokémon is missing" });
            return;
        }
        const key = /^\d+$/.test(keyText) ? Number(keyText) : keyText;
        if (/^banned$/i.test(value)) {
            rows.push({ line, key, points: null, banned: true });
            return;
        }
        if (!/^\d+$/.test(value)) {
            errors.push({ line, message: `"${value}" isn't a number of points or "banned"` });
            return;
        }
        const points = Number(value);
        if (points < POINTS_MIN || points > POINTS_MAX) {
            errors.push({ line, message: `Points must be ${POINTS_MIN}–${POINTS_MAX}, got ${points}` });
            return;
        }
        rows.push({ line, key, points, banned: false });
    });
    return { rows, errors };
}
