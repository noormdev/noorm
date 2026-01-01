import { defineConfig } from "vitest/config";

export default defineConfig({
    test: {
        globals: true,
        environment: "node",
        include: ["tests/**/*.test.{ts,tsx}"],
        // Run integration tests sequentially to avoid resource contention
        // (they spawn CLI processes that compete for file system resources)
        fileParallelism: false,
        coverage: {
            provider: "v8",
            reporter: ["text", "json", "html"],
            exclude: ["node_modules/", "dist/", "tests/", "*.config.*"],
        },
    },
});
