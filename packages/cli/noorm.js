#!/usr/bin/env node

/**
 * Thin shim that execs the platform-specific noorm binary.
 *
 * npm points `bin.noorm` here. On postinstall, the real binary is
 * downloaded to the same directory. This shim finds and execs it,
 * passing through all arguments and signals.
 */

import { execFileSync } from 'child_process';
import { existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const binaryName = process.platform === 'win32' ? 'noorm.exe' : 'noorm';
const binaryPath = resolve(__dirname, 'bin', binaryName);

if (!existsSync(binaryPath)) {

    console.error('noorm binary not found. Try reinstalling:');
    console.error('  npm install -g @noormdev/cli');
    process.exit(1);

}

try {

    execFileSync(binaryPath, process.argv.slice(2), {
        stdio: 'inherit',
        env: process.env,
    });

}
catch (err) {

    // execFileSync throws on non-zero exit — forward the exit code
    process.exit(err.status ?? 1);

}
