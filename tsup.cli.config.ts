import { defineConfig } from 'tsup';
import { readFileSync } from 'fs';

// Read CLI package version for injection at build time
const cliPkg = JSON.parse(readFileSync('packages/cli/package.json', 'utf8'));
const CLI_VERSION = cliPkg.version;

// Packages that MUST remain external (native bindings only)
const EXTERNAL_PACKAGES = [
    // Native C++ bindings - cannot be bundled
    'better-sqlite3',
    // Optional native pg driver (pure JS pg is bundled)
    'pg-native',
    // Optional devtools (not needed at runtime)
    'react-devtools-core',
];

export default defineConfig({
    entry: ['src/cli/index.tsx'],
    format: ['esm'],
    target: 'node18',
    platform: 'node',
    minify: true,
    clean: true,
    outDir: 'packages/cli/dist',
    // Bundle everything by default
    noExternal: [/.*/],
    esbuildOptions(options) {

        options.jsx = 'automatic';
        // Override: mark specific packages as external
        options.external = EXTERNAL_PACKAGES;
        // Inject shims for CJS packages that use require('process') etc
        options.banner = {
            js: `import { createRequire } from 'module'; const require = createRequire(import.meta.url);`,
        };
        // Inject version at build time (replaces __CLI_VERSION__ placeholder)
        options.define = {
            '__CLI_VERSION__': JSON.stringify(CLI_VERSION),
        };

    },
});
