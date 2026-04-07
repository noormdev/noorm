#!/usr/bin/env bun

/**
 * Cross-platform binary builder using bun build --compile.
 *
 * Produces standalone executables for all supported platforms.
 * Each binary embeds the Bun runtime — no external dependencies needed.
 */
import { readFile } from 'fs/promises';
import { $ } from 'bun';

// Read version from CLI package (the one that gets published)
const cliPkg = JSON.parse(await readFile('packages/cli/package.json', 'utf8'));
const version = cliPkg.version;

console.log(`\nBuilding noorm binaries v${version}...\n`);

const targets = [
    { bun: 'bun-darwin-arm64', suffix: 'darwin-arm64' },
    { bun: 'bun-darwin-x64', suffix: 'darwin-x64' },
    { bun: 'bun-linux-x64', suffix: 'linux-x64' },
    { bun: 'bun-linux-arm64', suffix: 'linux-arm64' },
    { bun: 'bun-windows-x64', suffix: 'windows-x64.exe' },
];

for (const { bun: target, suffix } of targets) {

    const outfile = `packages/cli/bin/noorm-${suffix}`;
    console.log(`  Building ${outfile} (${target})...`);

    await $`bun build --compile --target=${target} --minify src/cli/index.ts src/workers/connection.ts src/workers/compute.ts --outfile ${outfile} --define __CLI_VERSION__=\"${version}\"`.quiet();

    console.log(`  ✓ ${outfile}`);

}

console.log(`\nDone! Binaries in packages/cli/bin/\n`);
