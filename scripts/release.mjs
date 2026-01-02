#!/usr/bin/env zx

import { $, chalk } from 'zx';

console.log(chalk.blue('Starting release process...'));

// Build first
console.log(chalk.yellow('\nStep 1: Building packages...'));

await $`zx scripts/build.mjs`;

// Publish packages
console.log(chalk.yellow('\nStep 2: Publishing packages...'));

await $`cd packages/cli && npm publish --access public`;
await $`cd packages/sdk && npm publish --access public`;

console.log(chalk.green('\nRelease complete!'));
