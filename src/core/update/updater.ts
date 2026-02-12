/**
 * Background updater supporting npm and binary install modes.
 *
 * Routes to the correct update strategy based on how noorm was installed:
 * - npm: spawns `npm install -g @noormdev/cli@{version}` in background
 * - binary: downloads replacement binary from GitHub releases, atomic swap
 *
 * @example
 * ```typescript
 * const result = await installUpdate('1.2.0');
 * if (result.success) {
 *     console.log(`Updated from ${result.previousVersion} to ${result.newVersion}`);
 * }
 * ```
 */
import { spawn } from 'child_process';
import { writeFile, rename, unlink, chmod } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

import { attempt } from '@logosdx/utils';

import { observer } from '../observer.js';
import { getCurrentVersion } from './checker.js';
import { detectInstallMode, getBinaryDownloadUrl } from './install-mode.js';
import type { UpdateResult } from './types.js';

// =============================================================================
// Constants
// =============================================================================

/** NPM package name to install */
const PACKAGE_NAME = '@noormdev/cli';

// =============================================================================
// npm Updater
// =============================================================================

/**
 * Install update via npm in background.
 *
 * Runs `npm install -g @noormdev/cli@{version}` as a child process.
 */
function installViaNpm(version: string, previousVersion: string): Promise<UpdateResult> {

    return new Promise((resolve) => {

        // Spawn npm install process
        const child = spawn('npm', ['install', '-g', `${PACKAGE_NAME}@${version}`], {
            detached: false, // Stay attached to show progress
            stdio: 'pipe',
            shell: true, // Required on Windows
        });

        let stderr = '';

        // We don't use stdout but need to consume the stream
        child.stdout?.on('data', () => {});

        child.stderr?.on('data', (data: Buffer) => {

            stderr += data.toString();

        });

        child.on('error', (err) => {

            observer.emit('update:failed', {
                version,
                error: err.message,
            });

            resolve({
                success: false,
                previousVersion,
                newVersion: version,
                error: err.message,
            });

        });

        child.on('close', (code) => {

            if (code === 0) {

                observer.emit('update:complete', {
                    previousVersion,
                    newVersion: version,
                });

                resolve({
                    success: true,
                    previousVersion,
                    newVersion: version,
                });

            }
            else {

                const errorMsg = stderr.trim() || `npm exited with code ${code}`;

                observer.emit('update:failed', {
                    version,
                    error: errorMsg,
                });

                resolve({
                    success: false,
                    previousVersion,
                    newVersion: version,
                    error: errorMsg,
                });

            }

        });

    });

}

// =============================================================================
// Binary Updater
// =============================================================================

/**
 * Install update by downloading a replacement binary from GitHub releases.
 *
 * Downloads the platform-appropriate binary, writes to a temp file,
 * then atomically replaces the current executable.
 */
async function installViaBinary(version: string, previousVersion: string): Promise<UpdateResult> {

    const url = getBinaryDownloadUrl(version);

    const [response, fetchErr] = await attempt(() => fetch(url));

    if (fetchErr || !response || !response.ok) {

        const errorMsg = fetchErr?.message ?? `HTTP ${response?.status} downloading binary`;

        observer.emit('update:failed', { version, error: errorMsg });

        return {
            success: false,
            previousVersion,
            newVersion: version,
            error: errorMsg,
        };

    }

    const [buffer, readErr] = await attempt(() => response.arrayBuffer());

    if (readErr || !buffer) {

        const errorMsg = readErr?.message ?? 'Failed to read binary response';

        observer.emit('update:failed', { version, error: errorMsg });

        return {
            success: false,
            previousVersion,
            newVersion: version,
            error: errorMsg,
        };

    }

    // Write to temp file, then atomic rename to current executable path
    const currentExe = process.execPath;
    const tmpPath = join(tmpdir(), `noorm-update-${version}-${Date.now()}`);

    const [, writeErr] = await attempt(async () => {

        await writeFile(tmpPath, Buffer.from(buffer));
        await chmod(tmpPath, 0o755);

    });

    if (writeErr) {

        observer.emit('update:failed', { version, error: writeErr.message });

        return {
            success: false,
            previousVersion,
            newVersion: version,
            error: writeErr.message,
        };

    }

    // Atomic replace: rename old → backup, rename new → current, remove backup
    const backupPath = `${currentExe}.backup`;

    const [, swapErr] = await attempt(async () => {

        await rename(currentExe, backupPath);
        await rename(tmpPath, currentExe);

    });

    if (swapErr) {

        // Try to restore backup
        await attempt(() => rename(backupPath, currentExe));
        await attempt(() => unlink(tmpPath));

        observer.emit('update:failed', { version, error: swapErr.message });

        return {
            success: false,
            previousVersion,
            newVersion: version,
            error: swapErr.message,
        };

    }

    // Clean up backup
    await attempt(() => unlink(backupPath));

    observer.emit('update:complete', { previousVersion, newVersion: version });

    return {
        success: true,
        previousVersion,
        newVersion: version,
    };

}

// =============================================================================
// Public API
// =============================================================================

/**
 * Install update via the appropriate channel.
 *
 * Automatically detects install mode and routes to the correct updater:
 * - npm mode: runs `npm install -g @noormdev/cli@{version}`
 * - binary mode: downloads replacement binary from GitHub releases
 *
 * @param version - Version to install
 * @returns Promise that resolves when install completes
 *
 * @example
 * ```typescript
 * observer.on('update:installing', ({ version }) => {
 *     showProgress(`Installing ${version}...`);
 * });
 *
 * const result = await installUpdate('1.2.0');
 *
 * if (result.success) {
 *     showToast('Update complete! Restart to apply.');
 * }
 * else {
 *     showError(result.error);
 * }
 * ```
 */
export function installUpdate(version: string): Promise<UpdateResult> {

    const previousVersion = getCurrentVersion();
    const mode = detectInstallMode();

    observer.emit('update:installing', { version });

    if (mode === 'binary') {

        return installViaBinary(version, previousVersion);

    }

    return installViaNpm(version, previousVersion);

}
