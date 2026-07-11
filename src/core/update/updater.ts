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
import { open, rename, unlink, chmod } from 'fs/promises';

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

/**
 * Abort the download if no bytes arrive for this long. A bare `fetch()` has no
 * timeout, so a stalled connection would otherwise hang the process forever
 * with no error to surface — this converts a silent hang into a real failure.
 */
const DOWNLOAD_STALL_MS = 30_000;

/** Emit a progress event at most once per this many bytes, to avoid spamming. */
const PROGRESS_EMIT_BYTES = 512 * 1024;

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
 * Stream a URL to a file, emitting `update:progress` as bytes arrive and
 * aborting if the transfer stalls (no data for `stallMs`).
 *
 * Streaming instead of buffering the whole ~70MB into memory lets the caller
 * show real progress, and the stall-abort guarantees the download either
 * completes, errors, or times out — never hangs indefinitely on a dead socket.
 *
 * @param stallMs - Abort if no chunk arrives within this window. Overridable
 * for tests; production uses `DOWNLOAD_STALL_MS`.
 * @throws Error on a non-OK response, an empty body, a stall, or a write failure.
 */
export async function downloadToFile(
    url: string,
    destPath: string,
    version: string,
    stallMs: number = DOWNLOAD_STALL_MS,
): Promise<void> {

    const controller = new AbortController();

    let stallTimer: ReturnType<typeof setTimeout> | undefined;

    const armStall = () => {

        clearTimeout(stallTimer);
        stallTimer = setTimeout(
            () => controller.abort(new Error(`download stalled — no data for ${stallMs / 1000}s`)),
            stallMs,
        );

    };

    const response = await fetch(url, { signal: controller.signal });

    if (!response.ok || !response.body) {

        clearTimeout(stallTimer);

        throw new Error(`HTTP ${response.status} downloading binary`);

    }

    const total = Number(response.headers.get('content-length')) || 0;
    let received = 0;
    let sinceLastEmit = 0;

    const handle = await open(destPath, 'w');

    // A stall or write failure must still close the handle and clear the timer,
    // so wrap the streaming loop and clean up in both outcomes.
    const [, streamErr] = await attempt(async () => {

        armStall();

        for await (const chunk of response.body as AsyncIterable<Uint8Array>) {

            await handle.write(chunk);

            received += chunk.byteLength;
            sinceLastEmit += chunk.byteLength;
            armStall();

            if (sinceLastEmit >= PROGRESS_EMIT_BYTES) {

                sinceLastEmit = 0;
                observer.emit('update:progress', { version, received, total });

            }

        }

        // Final tick so consumers see 100% even when the last chunk was small.
        observer.emit('update:progress', { version, received, total: total || received });

    });

    clearTimeout(stallTimer);
    await handle.close();

    if (streamErr) {

        // controller.abort(reason) surfaces the stall reason as the thrown
        // error's `cause`; prefer it so the message says "stalled", not "aborted".
        const cause = streamErr.cause;

        throw cause instanceof Error ? cause : streamErr;

    }

    await chmod(destPath, 0o755);

}

/**
 * Install update by downloading a replacement binary from GitHub releases.
 *
 * Streams the platform-appropriate binary to a temp file **in the target's own
 * directory** — a cross-filesystem `rename` (e.g. `os.tmpdir()` on a different
 * volume than `~/.local/bin`) throws `EXDEV`, so the swap must stage next to the
 * destination — then atomically replaces the current executable.
 */
async function installViaBinary(version: string, previousVersion: string): Promise<UpdateResult> {

    const url = getBinaryDownloadUrl(version);
    const currentExe = process.execPath;
    const tmpPath = `${currentExe}.download`;

    const fail = (error: string): UpdateResult => {

        observer.emit('update:failed', { version, error });

        return { success: false, previousVersion, newVersion: version, error };

    };

    const [, downloadErr] = await attempt(() => downloadToFile(url, tmpPath, version));

    if (downloadErr) {

        await attempt(() => unlink(tmpPath));

        return fail(downloadErr.message);

    }

    // Atomic replace: rename old → backup, rename new → current, remove backup.
    // All three paths share `currentExe`'s directory, so every rename is
    // same-filesystem and atomic.
    const backupPath = `${currentExe}.backup`;

    const [, swapErr] = await attempt(async () => {

        await rename(currentExe, backupPath);
        await rename(tmpPath, currentExe);

    });

    if (swapErr) {

        // Try to restore backup
        await attempt(() => rename(backupPath, currentExe));
        await attempt(() => unlink(tmpPath));

        return fail(swapErr.message);

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
