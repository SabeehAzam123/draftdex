import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
    resolve: {
        alias: { "@": fileURLToPath(new URL(".", import.meta.url)) },
    },
    test: {
        environment: "node",
        include: ["lib/**/*.test.ts", "test/**/*.test.ts"],
        // Each test file gets its own SQLite file (test/setup.ts), so files can run in parallel
        setupFiles: ["./test/setup.ts"],
        testTimeout: 15_000,
        coverage: {
            provider: "v8",
            include: ["lib/**/*.ts", "app/api/**/*.ts"],
            exclude: ["lib/**/*.test.ts", "lib/client/**", "lib/db/schema.ts"],
            reporter: ["text-summary", "html"],
            thresholds: { lines: 85, statements: 85, functions: 85, branches: 75 },
        },
    },
});
