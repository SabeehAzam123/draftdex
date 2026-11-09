import { defineConfig } from "drizzle-kit";

// `npm run db:generate` writes a new SQL migration to drizzle/ after a change to lib/db/schema.ts.
// Migrations are committed; the app applies them on start (scripts/db-setup.ts).
export default defineConfig({
    dialect: "sqlite",
    schema: "./lib/db/schema.ts",
    out: "./drizzle",
});
