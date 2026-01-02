import { defineConfig } from "vitest/config";

export default defineConfig({
    test: {
        globals: true,
        environment: "node",
        include: ["tests/**/*.test.{ts,tsx}"],
        globalSetup: "./tests/global-setup.ts",
        // Run tests sequentially to avoid resource contention
        // (integration tests spawn CLI processes that compete for resources)
        fileParallelism: false,
        sequence: {
            concurrent: false,
        },
        coverage: {
            provider: "v8",
            reporter: ["text", "json", "html"],
            exclude: ["node_modules/", "dist/", "tests/", "*.config.*"],
        },
    },
});
