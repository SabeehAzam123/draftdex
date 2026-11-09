import { z } from "zod";

/** The product's name, in one place so it can change. */
export const APP_NAME = "DraftDex";

/** Credits a new account starts with (fake currency for entry fees and prizes). */
export const SIGNUP_BONUS = 1000;

const DEV_JWT_SECRET = "draftdex-local-dev-secret-not-for-production-0000";

const EnvSchema = z.object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    /** libSQL URL: a local file by default, or a Turso URL for the hosted demo. */
    DATABASE_URL: z.string().min(1).default("file:./data/draftdex.db"),
    DATABASE_AUTH_TOKEN: z.string().min(1).optional(),
    JWT_SECRET: z.string().min(32, "JWT_SECRET must be at least 32 characters").optional(),
    JWT_EXPIRES_IN: z.string().default("8h"),
    /** Hosts the server may POST league notifications to (comma-separated). Subdomains count. */
    WEBHOOK_ALLOWED_HOSTS: z.string().default("discord.com,discordapp.com"),
});

export type AppConfig = {
    env: "development" | "test" | "production";
    databaseUrl: string;
    databaseAuthToken: string | undefined;
    jwtSecret: string;
    jwtExpiresIn: string;
    webhookAllowedHosts: string[];
};

let cached: AppConfig | null = null;
let warned = false;

/**
 * Reads and validates the environment once. Every default works locally with no `.env` file;
 * production must set JWT_SECRET.
 */
export function getConfig(): AppConfig {
    if (cached) return cached;
    const parsed = EnvSchema.safeParse({
        NODE_ENV: process.env.NODE_ENV,
        DATABASE_URL: process.env.DATABASE_URL || undefined,
        DATABASE_AUTH_TOKEN: process.env.DATABASE_AUTH_TOKEN || undefined,
        JWT_SECRET: process.env.JWT_SECRET || undefined,
        JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN || undefined,
        WEBHOOK_ALLOWED_HOSTS: process.env.WEBHOOK_ALLOWED_HOSTS || undefined,
    });
    if (!parsed.success) {
        const lines = parsed.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`).join("\n");
        throw new Error(`Invalid environment:\n${lines}`);
    }
    const e = parsed.data;
    if (!e.JWT_SECRET && e.NODE_ENV === "production") {
        throw new Error("JWT_SECRET is required in production");
    }
    if (!e.JWT_SECRET && e.NODE_ENV === "development" && !warned) {
        warned = true;
        console.warn(`[${APP_NAME}] JWT_SECRET not set: using the local development secret`);
    }
    cached = {
        env: e.NODE_ENV,
        databaseUrl: e.DATABASE_URL,
        databaseAuthToken: e.DATABASE_AUTH_TOKEN,
        jwtSecret: e.JWT_SECRET ?? DEV_JWT_SECRET,
        jwtExpiresIn: e.JWT_EXPIRES_IN,
        webhookAllowedHosts: e.WEBHOOK_ALLOWED_HOSTS.split(",")
            .map((h) => h.trim().toLowerCase())
            .filter(Boolean),
    };
    return cached;
}

/** Test hook: forget the cached config so a test can change process.env. */
export function resetConfigForTests() {
    cached = null;
}
