import { index, integer, primaryKey, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import {
    ENTRY_STATUSES,
    LEAGUE_FORMATS,
    LEAGUE_STATUSES,
    LEDGER_KINDS,
    MATCH_STATUSES,
    NOTIFICATION_STATUSES,
    SLOT_KINDS,
    SLOT_STATUSES,
    TRADE_STATUSES,
    UI_VARIANTS,
    USER_ROLES,
    type LeagueSettings,
    type PokemonStats,
} from "@/lib/domain/enums";

// The value lists and their types live in lib/domain/enums.ts (browser-safe); re-exported for server code
export * from "@/lib/domain/enums";

/** Timestamps are ISO-8601 strings (UTC): readable in the API and in the database. */

export const users = sqliteTable("users", {
    id: text("id").primaryKey(),
    email: text("email").notNull().unique(),
    displayName: text("display_name").notNull(),
    passwordHash: text("password_hash").notNull(),
    role: text("role", { enum: USER_ROLES }).notNull().default("user"),
    uiVariant: text("ui_variant", { enum: UI_VARIANTS }).notNull().default("new"),
    createdAt: text("created_at").notNull(),
});

/** One row per species (default form), loaded from data/pokemon.json (PokéAPI). */
export const pokemon = sqliteTable(
    "pokemon",
    {
        id: integer("id").primaryKey(), // national dex number
        slug: text("slug").notNull().unique(),
        name: text("name").notNull(),
        types: text("types", { mode: "json" }).$type<string[]>().notNull(),
        stats: text("stats", { mode: "json" }).$type<PokemonStats>().notNull(),
        bst: integer("bst").notNull(),
        generation: integer("generation").notNull(),
        isLegendary: integer("is_legendary", { mode: "boolean" }).notNull(),
        isMythical: integer("is_mythical", { mode: "boolean" }).notNull(),
    },
    (t) => [index("pokemon_name_idx").on(t.name)],
);

export const leagues = sqliteTable("leagues", {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    format: text("format", { enum: LEAGUE_FORMATS }).notNull(),
    status: text("status", { enum: LEAGUE_STATUSES }).notNull().default("setup"),
    commissionerId: text("commissioner_id")
        .notNull()
        .references(() => users.id),
    settings: text("settings", { mode: "json" }).$type<LeagueSettings>().notNull(),
    webhookUrl: text("webhook_url"),
    /** Entry ids in round-1 order, set when the draft starts. */
    draftOrder: text("draft_order", { mode: "json" }).$type<string[]>(),
    createdAt: text("created_at").notNull(),
});

/** The league's tier list: what each Pokémon costs, or banned. One row per species per league. */
export const leaguePool = sqliteTable(
    "league_pool",
    {
        leagueId: text("league_id")
            .notNull()
            .references(() => leagues.id, { onDelete: "cascade" }),
        pokemonId: integer("pokemon_id")
            .notNull()
            .references(() => pokemon.id),
        points: integer("points").notNull(),
        banned: integer("banned", { mode: "boolean" }).notNull().default(false),
    },
    (t) => [primaryKey({ columns: [t.leagueId, t.pokemonId] })],
);

/** A coach's place in a league (their team). */
export const entries = sqliteTable(
    "entries",
    {
        id: text("id").primaryKey(),
        leagueId: text("league_id")
            .notNull()
            .references(() => leagues.id, { onDelete: "cascade" }),
        userId: text("user_id")
            .notNull()
            .references(() => users.id),
        teamName: text("team_name").notNull(),
        status: text("status", { enum: ENTRY_STATUSES }).notNull().default("pending"),
        createdAt: text("created_at").notNull(),
    },
    (t) => [uniqueIndex("entries_league_user_uq").on(t.leagueId, t.userId), index("entries_league_idx").on(t.leagueId)],
);

/** The draft's pick order, precomputed (snake). Makeup slots are added at the end when a timer skips a turn. */
export const draftSlots = sqliteTable(
    "draft_slots",
    {
        leagueId: text("league_id")
            .notNull()
            .references(() => leagues.id, { onDelete: "cascade" }),
        slotNo: integer("slot_no").notNull(),
        entryId: text("entry_id")
            .notNull()
            .references(() => entries.id),
        round: integer("round").notNull(),
        kind: text("kind", { enum: SLOT_KINDS }).notNull().default("regular"),
        status: text("status", { enum: SLOT_STATUSES }).notNull().default("open"),
        /** When this slot's timer runs out (set when the slot becomes current; null without a timer). */
        deadline: text("deadline"),
    },
    (t) => [primaryKey({ columns: [t.leagueId, t.slotNo] })],
);

export const picks = sqliteTable(
    "picks",
    {
        id: text("id").primaryKey(),
        leagueId: text("league_id")
            .notNull()
            .references(() => leagues.id, { onDelete: "cascade" }),
        entryId: text("entry_id")
            .notNull()
            .references(() => entries.id),
        pokemonId: integer("pokemon_id")
            .notNull()
            .references(() => pokemon.id),
        points: integer("points").notNull(),
        slotNo: integer("slot_no").notNull(),
        /** The user who made the pick, or "timer" for an auto-pick. */
        pickedBy: text("picked_by").notNull(),
        createdAt: text("created_at").notNull(),
        /**
         * The entry that owns the Pokémon now, when an approved trade moved it; null = still the drafter
         * (`entryId`). Keeping `entryId` untouched keeps the draft's history true.
         */
        ownerEntryId: text("owner_entry_id").references(() => entries.id),
    },
    (t) => [
        // A Pokémon can be drafted once per league; this also settles two coaches picking it at the same moment.
        uniqueIndex("picks_league_pokemon_uq").on(t.leagueId, t.pokemonId),
        uniqueIndex("picks_league_slot_uq").on(t.leagueId, t.slotNo),
        index("picks_entry_idx").on(t.entryId),
    ],
);

/**
 * Double-entry credits ledger. Every movement writes two rows that cancel out
 * (e.g. user −100 / league +100), so the sum of all rows is always 0.
 * Accounts: "user:<id>", "league:<id>", "system".
 */
export const ledger = sqliteTable(
    "ledger",
    {
        id: integer("id").primaryKey({ autoIncrement: true }),
        txId: text("tx_id").notNull(),
        account: text("account").notNull(),
        amount: integer("amount").notNull(),
        kind: text("kind", { enum: LEDGER_KINDS }).notNull(),
        ref: text("ref"),
        memo: text("memo").notNull(),
        createdAt: text("created_at").notNull(),
    },
    (t) => [index("ledger_account_idx").on(t.account), index("ledger_tx_idx").on(t.txId)],
);

/** One row per webhook delivery attempt (shown to the commissioner). */
/** The season's round robin: every team plays every other team once. Best of three. */
export const matches = sqliteTable(
    "matches",
    {
        id: text("id").primaryKey(),
        leagueId: text("league_id")
            .notNull()
            .references(() => leagues.id, { onDelete: "cascade" }),
        week: integer("week").notNull(),
        homeEntryId: text("home_entry_id")
            .notNull()
            .references(() => entries.id),
        awayEntryId: text("away_entry_id")
            .notNull()
            .references(() => entries.id),
        status: text("status", { enum: MATCH_STATUSES }).notNull().default("scheduled"),
        homeWins: integer("home_wins"),
        awayWins: integer("away_wins"),
        /** A Pokémon Showdown replay of the match (optional) */
        replayUrl: text("replay_url"),
        reportedByEntryId: text("reported_by_entry_id").references(() => entries.id),
        reportedAt: text("reported_at"),
        disputeReason: text("dispute_reason"),
        /** When it became final (confirmed or resolved) */
        decidedAt: text("decided_at"),
        resolvedBy: text("resolved_by").references(() => users.id),
    },
    (t) => [index("matches_league_idx").on(t.leagueId, t.week)],
);

/** An n-for-n swap of Pokémon between two coaches in the same league. */
export const trades = sqliteTable(
    "trades",
    {
        id: text("id").primaryKey(),
        leagueId: text("league_id")
            .notNull()
            .references(() => leagues.id, { onDelete: "cascade" }),
        fromEntryId: text("from_entry_id")
            .notNull()
            .references(() => entries.id),
        toEntryId: text("to_entry_id")
            .notNull()
            .references(() => entries.id),
        /** Pokémon ids the proposer gives */
        give: text("give", { mode: "json" }).$type<number[]>().notNull(),
        /** Pokémon ids the proposer gets */
        get: text("get", { mode: "json" }).$type<number[]>().notNull(),
        note: text("note"),
        status: text("status", { enum: TRADE_STATUSES }).notNull().default("proposed"),
        createdAt: text("created_at").notNull(),
        updatedAt: text("updated_at").notNull(),
    },
    (t) => [index("trades_league_idx").on(t.leagueId)],
);

export const notifications = sqliteTable(
    "notifications",
    {
        id: integer("id").primaryKey({ autoIncrement: true }),
        leagueId: text("league_id")
            .notNull()
            .references(() => leagues.id, { onDelete: "cascade" }),
        event: text("event").notNull(),
        status: text("status", { enum: NOTIFICATION_STATUSES }).notNull(),
        httpStatus: integer("http_status"),
        error: text("error"),
        createdAt: text("created_at").notNull(),
    },
    (t) => [index("notifications_league_idx").on(t.leagueId)],
);
