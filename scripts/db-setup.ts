/**
 * Prepares the database. Runs before `npm run dev`, so a fresh clone works with no setup.
 *
 *   npm run db:setup     migrate, load the Pokémon, add the demo data if the database is empty
 *   npm run db:reset     the same, but first delete all data (users, leagues, …; the Pokémon stay)
 */
import { existsSync } from "node:fs";
import { getDb } from "@/lib/db/client";
import { runMigrations } from "@/lib/db/migrate";
import { seedPokemon } from "@/lib/services/pokemon";
import { clearData, DEMO_ADMIN, DEMO_COACH_PASSWORD, isEmpty, seedDemo } from "@/lib/services/seed";

async function main() {
    if (existsSync(".env.local")) process.loadEnvFile(".env.local");
    const reset = process.argv.includes("--reset");
    const db = getDb();

    await runMigrations(db);
    const loaded = await seedPokemon(db);
    if (loaded) console.log(`Loaded ${loaded} Pokémon species`);

    if (reset) await clearData(db);
    if (reset || (await isEmpty(db))) {
        const summary = await seedDemo(db);
        console.log("\nDemo data ready. Sign in with (local demo accounts only):");
        console.log(`  admin   ${DEMO_ADMIN.email} / ${DEMO_ADMIN.password}`);
        console.log(`  coaches ${summary.coaches[0]} … ${summary.coaches.at(-1)} / ${DEMO_COACH_PASSWORD}`);
        for (const l of summary.leagues) console.log(`  league  ${l.name} (${l.status})`);
        console.log("");
    } else {
        console.log("Database ready (existing data kept; `npm run db:reset` starts over)");
    }
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
