import { z } from "zod";
import { LEAGUE_FORMATS, UI_VARIANTS, USER_ROLES } from "@/lib/db/schema";
import { POINTS_MAX, POINTS_MIN } from "@/lib/domain/tiers";

/** Every request body and query the API accepts. Unknown keys are refused (`.strict()`). */

const email = z.string().trim().toLowerCase().pipe(z.email("Enter a valid email").max(200));
const displayName = z.string().trim().min(2, "At least 2 characters").max(40, "At most 40 characters");
const password = z
    .string()
    .min(8, "At least 8 characters")
    .max(100)
    .regex(/[A-Za-z]/, "Include a letter")
    .regex(/\d/, "Include a number");

const page = z.coerce.number().int().min(1).default(1);
const pageSize = (max: number, def: number) => z.coerce.number().int().min(1).max(max).default(def);

export const SignupSchema = z.object({ email, password, displayName }).strict();
export const LoginSchema = z.object({ email, password: z.string().min(1, "Enter your password").max(100) }).strict();
export const UpdateMeSchema = z.object({ displayName: displayName.optional(), uiVariant: z.enum(UI_VARIANTS).optional() }).strict();

export const AdminCreateUserSchema = z.object({ email, password, displayName, role: z.enum(USER_ROLES) }).strict();
export const AdminUpdateUserSchema = z.object({ displayName: displayName.optional(), role: z.enum(USER_ROLES).optional() }).strict();
export const UsersQuerySchema = z.object({
    page,
    pageSize: pageSize(50, 10),
    role: z.enum(USER_ROLES).optional(),
    q: z.string().trim().min(1).max(200).optional(),
});

export const PokemonQuerySchema = z.object({
    page,
    pageSize: pageSize(100, 24),
    q: z.string().trim().min(1).max(50).optional(),
    type: z.string().trim().toLowerCase().max(20).optional(),
    generation: z.coerce.number().int().min(1).max(9).optional(),
});

export const LeagueSettingsSchema = z
    .object({
        budget: z.number().int().min(10).max(500),
        rosterSize: z.number().int().min(3).max(15),
        maxCoaches: z.number().int().min(2).max(16),
        entryFee: z.number().int().min(0).max(1000),
        pickTimerSeconds: z
            .number()
            .int()
            .refine((v) => v === 0 || (v >= 10 && v <= 86_400), "Use 0 (no timer) or 10–86400 seconds"),
        prizeSplit: z
            .array(z.number().int().min(0).max(100))
            .min(1)
            .max(3)
            .refine((a) => a.reduce((s, x) => s + x, 0) === 100, "The split must add up to 100"),
    })
    .strict();

const leagueName = z.string().trim().min(3, "At least 3 characters").max(60, "At most 60 characters");

export const CreateLeagueSchema = z
    .object({
        name: leagueName,
        format: z.enum(LEAGUE_FORMATS).default("singles"),
        settings: LeagueSettingsSchema.partial().default({}),
    })
    .strict();

export const UpdateLeagueSchema = z
    .object({
        name: leagueName.optional(),
        format: z.enum(LEAGUE_FORMATS).optional(),
        settings: LeagueSettingsSchema.partial().optional(),
    })
    .strict();

export const LeaguesQuerySchema = z.object({
    page,
    pageSize: pageSize(50, 20),
    status: z.enum(["setup", "registration", "drafting", "season", "completed", "cancelled"]).optional(),
    mine: z
        .enum(["true", "false"])
        .transform((v) => v === "true")
        .optional(),
});

export const PoolQuerySchema = z.object({
    page,
    pageSize: pageSize(200, 50),
    q: z.string().trim().min(1).max(50).optional(),
    type: z.string().trim().toLowerCase().max(20).optional(),
    status: z.enum(["all", "available", "taken", "banned"]).default("all"),
    minPoints: z.coerce.number().int().min(POINTS_MIN).max(POINTS_MAX).optional(),
    maxPoints: z.coerce.number().int().min(POINTS_MIN).max(POINTS_MAX).optional(),
    sort: z.enum(["points", "dex", "name", "bst"]).default("points"),
});

export const PoolUpdateSchema = z
    .object({
        changes: z
            .array(
                z
                    .object({
                        pokemonId: z.number().int().positive(),
                        points: z.number().int().min(POINTS_MIN).max(POINTS_MAX).optional(),
                        banned: z.boolean().optional(),
                    })
                    .strict()
                    .refine((c) => c.points !== undefined || c.banned !== undefined, "Give points, banned or both"),
            )
            .min(1)
            .max(2000),
    })
    .strict();

export const PoolImportSchema = z.object({ csv: z.string().min(1, "The CSV is empty").max(200_000) }).strict();

export const ApplySchema = z
    .object({ teamName: z.string().trim().min(3, "At least 3 characters").max(40, "At most 40 characters") })
    .strict();

export const StartDraftSchema = z.object({ order: z.array(z.string().min(1)).min(2).max(16).optional() }).strict();

export const PickSchema = z.object({ pokemonId: z.number().int().positive() }).strict();

export const WebhookSchema = z.object({ url: z.string().trim().max(500).nullable() }).strict();

export const EmptySchema = z.object({}).strict();

const games = z.number().int("Whole games only");

export const ReportResultSchema = z
    .object({
        homeWins: games,
        awayWins: games,
        replayUrl: z.string().trim().max(300).nullable().optional(),
    })
    .strict();

export const DisputeSchema = z.object({ reason: z.string().trim().min(5, "Say what's wrong (at least 5 characters)").max(300) }).strict();

export const ResolveSchema = z.object({ homeWins: games, awayWins: games }).strict();

const tradeSide = z.array(z.number().int().positive()).min(1, "Pick at least one Pokémon").max(3, "At most 3 Pokémon each way");

export const ProposeTradeSchema = z
    .object({
        toEntryId: z.string().min(1),
        give: tradeSide,
        get: tradeSide,
        note: z.string().trim().max(200).optional(),
    })
    .strict();
