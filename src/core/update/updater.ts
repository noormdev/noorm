/**
 * Background updater using child process.
 *
 * Spawns npm install in background without blocking TUI.
 * Emits observer events for progress tracking.
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

import { observer } from '../observer.js';
import { getCurrentVersion } from './checker.js';
import type { UpdateResult } from './types.js';

// =============================================================================
// Constants
// =============================================================================

/** NPM package name to install */
const PACKAGE_NAME = '@noormdev/cli';

// =============================================================================
// Updater
// =============================================================================

/**
 * Install update via npm in background.
 *
 * Runs `npm install -g @noormdev/cli@{version}` as a child process.
 * Emits observer events for progress tracking.
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

    return new Promise((resolve) => {

        const previousVersion = getCurrentVersion();

        observer.emit('update:installing', { version });

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
