/**
 * The app's fixed value lists. A plain module (no database code), so browser components can import it.
 */
export const USER_ROLES = ["admin", "user"] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const UI_VARIANTS = ["new", "classic"] as const;
export type UiVariant = (typeof UI_VARIANTS)[number];

export const LEAGUE_STATUSES = ["setup", "registration", "drafting", "season", "completed", "cancelled"] as const;
export type LeagueStatus = (typeof LEAGUE_STATUSES)[number];

export const LEAGUE_FORMATS = ["singles", "doubles"] as const;
export type LeagueFormat = (typeof LEAGUE_FORMATS)[number];

export const ENTRY_STATUSES = ["pending", "approved", "rejected", "withdrawn"] as const;
export type EntryStatus = (typeof ENTRY_STATUSES)[number];

export const SLOT_KINDS = ["regular", "makeup"] as const;
export const SLOT_STATUSES = ["open", "picked", "skipped", "auto", "forfeited"] as const;
export type SlotStatus = (typeof SLOT_STATUSES)[number];

export const LEDGER_KINDS = ["signup_bonus", "entry_fee", "refund", "prize"] as const;
export type LedgerKind = (typeof LEDGER_KINDS)[number];

export const NOTIFICATION_STATUSES = ["sent", "failed"] as const;

/** scheduled → reported → confirmed, or → disputed → resolved. The commissioner can resolve at any point. */
export const MATCH_STATUSES = ["scheduled", "reported", "confirmed", "disputed", "resolved"] as const;
export type MatchStatus = (typeof MATCH_STATUSES)[number];
/** A match's result counts once it's confirmed or resolved. */
export const FINAL_MATCH_STATUSES: readonly MatchStatus[] = ["confirmed", "resolved"];

/** proposed → accepted (by the other coach) → approved | rejected (by the commissioner); or declined / cancelled. */
export const TRADE_STATUSES = ["proposed", "accepted", "approved", "rejected", "declined", "cancelled"] as const;
export type TradeStatus = (typeof TRADE_STATUSES)[number];

export const POKEMON_TYPES = [
    "normal", "fire", "water", "electric", "grass", "ice", "fighting", "poison", "flying",
    "psychic", "bug", "rock", "ghost", "dragon", "dark", "steel", "fairy", "ground",
] as const;

export type LeagueSettings = {
    /** Points each coach may spend in the draft. */
    budget: number;
    /** Pokémon per roster = draft rounds. */
    rosterSize: number;
    maxCoaches: number;
    /** Credits charged when a coach applies; refunded on reject/withdraw/cancel. */
    entryFee: number;
    /** Seconds per pick; 0 = no timer. */
    pickTimerSeconds: number;
    /** Prize pool split by final place, in percent (sums to 100). */
    prizeSplit: number[];
};

export type PokemonStats = { hp: number; atk: number; def: number; spa: number; spd: number; spe: number };
