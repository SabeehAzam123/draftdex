import { sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/libsql/migrator";
import { resolve } from "node:path";
import type { Db } from "./client";

const MIGRATIONS = resolve(process.cwd(), "drizzle");

/** Applies any pending migrations in drizzle/. Safe to run on every start. */
export async function runMigrations(db: Db, migrationsFolder = MIGRATIONS) {
    // WAL lets readers carry on while a pick is being written (local files only; Turso ignores it)
    await db.run(sql`PRAGMA journal_mode = WAL`).catch(() => undefined);
    await migrate(db, { migrationsFolder });
}
