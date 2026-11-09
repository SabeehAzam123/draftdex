import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll } from "vitest";
import { resetConfigForTests } from "@/lib/config";
import { closeDbForTests } from "@/lib/db/client";

// Runs before each test file: a fresh SQLite file per file, so files run in parallel without sharing data.
const file = join(tmpdir(), `draftdex-test-${randomUUID()}.db`);
process.env.DATABASE_URL = `file:${file}`;
process.env.WEBHOOK_ALLOWED_HOSTS = "discord.com,discordapp.com,hooks.test";
resetConfigForTests();

afterAll(() => {
    closeDbForTests();
    // Best effort: Windows can keep the file locked for a moment after closing; it's a temp file either way
    for (const suffix of ["", "-wal", "-shm"]) {
        try {
            rmSync(file + suffix, { force: true });
        } catch {
            /* left for the OS to clean */
        }
    }
});
