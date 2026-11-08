import { defineConfig } from 'tsup';
import { resolve } from 'path';
import { writeFile } from 'node:fs/promises';

// Peer dependencies — consumers install these themselves
const EXTERNAL_PACKAGES = [
    'kysely',
    'better-sqlite3',
    'bun:sqlite',
    'pg',
    'mysql2',
    'tedious',
];

let sdkExports: string[] | undefined;

export default defineConfig({
    entry: ['src/sdk/index.ts'],
    format: ['cjs'],
    outExtension: () => ({ js: '.cjs' }),
    target: 'node22',
    platform: 'node',
    sourcemap: true,
    clean: true,
    // Keep the ESM intermediate so its metadata contains the named exports.
    // tsup's Rollup pass writes the single canonical CommonJS runtime.
    treeshake: true,
    outDir: 'packages/sdk/dist',
    // Bundle internal dependencies, including Tarn for MySQL/MSSQL pools.
    noExternal: [/.*/],
    esbuildPlugins: [{
        name: 'sdk-commonjs-peers',
        setup(build) {

            // Static driver imports must stay inside their lazy dialect initializers.
            // Nonliteral imports (template file URLs) retain native ESM loading.
            build.onResolve({ filter: /.*/ }, args => {

                if (!EXTERNAL_PACKAGES.some(
                    name => name !== 'kysely'
                        && (args.path === name || args.path.startsWith(`${name}/`)),
                )) return;

                return { path: args.path, namespace: 'sdk-commonjs-peer' };

            });
            build.onLoad({ filter: /.*/, namespace: 'sdk-commonjs-peer' }, args => ({
                // Keep esbuild from turning optional requires into hoisted ESM imports.
                contents: `module.exports = __noormSdkRequire(${JSON.stringify(args.path)});`,
                loader: 'js',
            }));
            build.onEnd(result => {

                const entry = Object.values(result.metafile?.outputs ?? {}).find(
                    output => output.entryPoint
                        && resolve(output.entryPoint) === resolve('src/sdk/index.ts'),
                );
                sdkExports = entry?.exports;

            });

        },
    }],
    async onSuccess() {

        if (!sdkExports?.length) {

            throw new Error('SDK build did not expose its runtime export metadata');

        }
        const bindings = sdkExports.map((name, index) => ({
            local: `export${index}`,
            name: JSON.stringify(name),
        }));
        const facade = [
            '// Generated from the SDK runtime exports. Do not edit.',
            "import runtime from './index.cjs';",
            ...bindings.map(({ local, name }) => `const ${local} = runtime[${name}];`),
            `export { ${bindings.map(({ local, name }) => `${local} as ${name}`).join(', ')} };`,
            '',
        ].join('\n');
        await writeFile(resolve('packages/sdk/dist/index.js'), facade);

    },
    esbuildOptions(options) {

        // Override: mark peer dependencies as external
        options.external = EXTERNAL_PACKAGES;
        // import.meta must describe the CJS runtime, including whole-object uses.
        options.define = { ...options.define, 'import.meta': '__noormSdkImportMeta' };
        options.banner = {
            js: [
                'const __noormSdkRequire = require;',
                'const __noormSdkImportMeta = { url: require("node:url").pathToFileURL(__filename).href };',
            ].join('\n'),
        };
        // Stub ansis — SDK doesn't need terminal colors
        options.alias = {
            'ansis': resolve('src/sdk/stubs/ansis.ts'),
        };

    },
});
