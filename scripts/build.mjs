#!/usr/bin/env zx

import { $, chalk } from 'zx';
import { readFile, writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';

// Read root package.json for version
const rootPkg = JSON.parse(await readFile('package.json', 'utf8'));
const version = rootPkg.version;

console.log(chalk.blue(`Building @noormdev packages v${version}...`));

// Ensure output directories exist
await mkdir('packages/cli/dist', { recursive: true });
await mkdir('packages/sdk/dist', { recursive: true });

// Build CLI
console.log(chalk.yellow('\nBuilding @noormdev/cli...'));

await $`npx tsup src/cli/index.tsx \
  --format esm \
  --target node18 \
  --platform node \
  --minify \
  --clean \
  --out-dir packages/cli/dist \
  --external better-sqlite3 \
  --external pg \
  --external mysql2 \
  --external tedious \
  --external tarn`;

// Add shebang to CLI output
const cliBundlePath = 'packages/cli/dist/index.js';
const cliContent = await readFile(cliBundlePath, 'utf8');
if (!cliContent.startsWith('#!')) {
    await writeFile(cliBundlePath, `#!/usr/bin/env node\n${cliContent}`);
    console.log(chalk.gray('  Added shebang to CLI bundle'));
}

// Build SDK
console.log(chalk.yellow('\nBuilding @noormdev/sdk...'));
await $`npx tsup src/sdk/index.ts \
  --format esm \
  --target node18 \
  --platform node \
  --sourcemap \
  --clean \
  --treeshake \
  --out-dir packages/sdk/dist \
  --external kysely \
  --external better-sqlite3 \
  --external pg \
  --external mysql2 \
  --external tedious \
  --external tarn`;

// Generate bundled types
console.log(chalk.yellow('\nGenerating bundled types...'));
await $`npx dts-bundle-generator src/sdk/index.ts -o packages/sdk/dist/index.d.ts --no-check --external-inlines @logosdx/observer --external-inlines @logosdx/utils`;

console.log(chalk.green('\nBuild complete!'));
console.log(chalk.gray('  packages/cli/dist/ - CLI bundle'));
console.log(chalk.gray('  packages/sdk/dist/ - SDK bundle + types'));
