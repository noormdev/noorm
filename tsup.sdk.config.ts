import { defineConfig } from 'tsup';
import { resolve } from 'path';

// Peer dependencies — consumers install these themselves
const EXTERNAL_PACKAGES = [
    'kysely',
    'better-sqlite3',
    'bun:sqlite',
    'pg',
    'mysql2',
    'tedious',
];

export default defineConfig({
    entry: ['src/sdk/index.ts'],
    format: ['esm'],
    target: 'node22',
    platform: 'node',
    sourcemap: true,
    clean: true,
    treeshake: true,
    outDir: 'packages/sdk/dist',
    // Bundle internal dependencies, including Tarn for MySQL/MSSQL pools.
    noExternal: [/.*/],
    esbuildOptions(options) {

        // Override: mark peer dependencies as external
        options.external = EXTERNAL_PACKAGES;
        // Shim require() for CJS packages that use require('process') etc
        options.banner = {
            js: `import { createRequire } from 'module'; const require = createRequire(import.meta.url);`,
        };
        // Stub ansis — SDK doesn't need terminal colors
        options.alias = {
            'ansis': resolve('src/sdk/stubs/ansis.ts'),
        };

    },
});
