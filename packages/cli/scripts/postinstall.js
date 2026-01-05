#!/usr/bin/env node

/**
 * Creates a stable symlink in /usr/local/bin for Node version independence.
 *
 * When using nvm/fnm, npm bin directories are version-specific. This script
 * creates a symlink in /usr/local/bin so `noorm` works across version switches.
 */

import { symlink, unlink, readlink } from 'fs/promises';
import { existsSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BIN_PATH = '/usr/local/bin/noorm';
const SOURCE = resolve(__dirname, '../dist/index.js');

async function main() {

    // Skip on Windows
    if (process.platform === 'win32') {

        return;

    }

    // Skip if not a global install (local node_modules)
    if (__dirname.includes('node_modules') && !__dirname.includes('/lib/node_modules/')) {

        return;

    }

    // Check if symlink already exists and points to correct location
    if (existsSync(BIN_PATH)) {

        try {

            const existing = await readlink(BIN_PATH);

            if (existing === SOURCE) {

                return; // Already correct

            }

            await unlink(BIN_PATH);

        }
        catch {

            // Not a symlink or can't read - try to proceed anyway

        }

    }

    try {

        await symlink(SOURCE, BIN_PATH);
        console.log(`✓ Symlinked noorm to ${BIN_PATH}`);

    }
    catch (err) {

        if (err.code === 'EACCES') {

            console.log(`\nTo enable noorm globally (survives Node version switches):\n`);
            console.log(`  sudo ln -sf "${SOURCE}" ${BIN_PATH}\n`);

        }

        // Don't fail install on symlink errors

    }

}

main();
