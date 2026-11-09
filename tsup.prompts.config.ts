import { defineConfig } from 'tsup';
import { markdownText } from './tsup.markdown-plugin.js';

// tsc preserves text imports, which Node cannot load. Bundle the Markdown into
// this module so dist/cli/index.js works without a custom loader or asset copies.
export default defineConfig({
    entry: ['src/mcp/prompts.ts'],
    format: ['esm'],
    target: 'node22',
    platform: 'node',
    outDir: 'dist/mcp',
    clean: false,
    splitting: false,
    esbuildPlugins: [markdownText],
});
