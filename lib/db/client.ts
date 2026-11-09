import { createClient, type Client } from "@libsql/client";
import { drizzle, type LibSQLDatabase } from "drizzle-orm/libsql";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { getConfig } from "@/lib/config";
import * as schema from "./schema";

export type Db = LibSQLDatabase<typeof schema>;
/** A transaction handle; services accept `Db | Tx` so they can run inside a caller's transaction. */
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
export type DbOrTx = Db | Tx;

type Opened = { url: string; client: Client; db: Db };

// Survives Next's hot reloads in development, so each reload doesn't open another pool.
const g = globalThis as unknown as { __draftdexDb?: Opened };

/** Runs async functions one at a time, in call order. */
function createQueue() {
    let tail: Promise<unknown> = Promise.resolve();
    return <T>(fn: () => Promise<T>): Promise<T> => {
        const run = tail.then(fn, fn);
        tail = run.catch(() => undefined);
        return run;
    };
}

/**
 * Opens a database.
 *
 * **Every write must run inside `db.transaction(...)`.** The local SQLite driver is synchronous: if a
 * second write waited for SQLite's lock, it would block Node's only thread, so the first transaction
 * could never finish (a deadlock until the timeout). So write transactions queue here, in the app,
 * and never wait on each other inside SQLite. The 5 s busy timeout is only for another process
 * (e.g. `npm run db:reset` while the server runs).
 */
export function openDb(url: string, authToken?: string): Opened {
    if (url.startsWith("file:")) {
        const path = url.slice("file:".length);
        if (path && path !== ":memory:") mkdirSync(dirname(resolve(path)), { recursive: true });
    }
    const client = createClient({ url, authToken, timeout: 5000 });
    const db = drizzle(client, { schema });
    const queue = createQueue();
    const transaction = db.transaction.bind(db);
    db.transaction = ((fn, config) => queue(() => transaction(fn, config))) as Db["transaction"];
    return { url, client, db };
}

/** The app's database, from DATABASE_URL (a local SQLite file by default). */
export function getDb(): Db {
    const { databaseUrl, databaseAuthToken } = getConfig();
    if (g.__draftdexDb?.url === databaseUrl) return g.__draftdexDb.db;
    g.__draftdexDb?.client.close();
    g.__draftdexDb = openDb(databaseUrl, databaseAuthToken);
    return g.__draftdexDb.db;
}

/** Test hook: close the shared connection (each test file gets its own database). */
export function closeDbForTests() {
    g.__draftdexDb?.client.close();
    g.__draftdexDb = undefined;
}
