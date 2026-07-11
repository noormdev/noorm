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
import { open, rename, unlink, chmod, stat } from 'fs/promises';

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
 * Abort a download attempt if no bytes arrive for this long. A bare `fetch()`
 * has no timeout, so a stalled connection would otherwise hang the process
 * forever with no error to surface — this converts a silent hang into a real
 * failure that the retry loop can act on.
 */
const DOWNLOAD_STALL_MS = 30_000;

/**
 * How many times to (re)start a download before giving up. A stall or network
 * error resumes from the bytes already on disk via an HTTP range request, so
 * these are cheap — a flaky connection retries the tail, not the whole ~70MB.
 */
const DOWNLOAD_MAX_ATTEMPTS = 5;

/** Base backoff between attempts; scaled by attempt number. */
const RETRY_BACKOFF_MS = 500;

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

/** Tunables for `downloadToFile`; all optional, defaulting to the constants above. */
export interface DownloadOptions {
    /** Abort an attempt if no chunk arrives within this window. */
    stallMs?: number;

    /** Total (re)start budget before giving up. */
    maxAttempts?: number;

    /** Base backoff between attempts, scaled by attempt number. */
    backoffMs?: number;
}

/**
 * A download failure that knows whether retrying could help. A stalled or reset
 * connection is `retriable`; a `404`/`403` is not — no point re-pulling 70MB
 * five times for a permanent error.
 */
class DownloadError extends Error {

    override readonly name = 'DownloadError' as const;

    constructor(message: string, readonly retriable: boolean) {

        super(message);

    }

}

/** Mutable state threaded across attempts so a resume survives a thrown attempt. */
interface DownloadState {
    /** ETag of the asset, sent as `If-Range` so a resume is rejected if it changed. */
    etag?: string;

    /** Full size of the asset in bytes, once known from a response. */
    total: number;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Current size of a file, or 0 if it doesn't exist — the resume offset. */
async function fileSizeOrZero(path: string): Promise<number> {

    const [info] = await attempt(() => stat(path));

    return info?.size ?? 0;

}

/** Parse the total from a `Content-Range: bytes 200-1023/1024` header. */
function parseContentRangeTotal(header: string | null): number {

    const total = header?.split('/')[1];

    return total ? Number(total) || 0 : 0;

}

/**
 * Download `url` to `destPath`, resuming from bytes already on disk and
 * retrying transient failures, emitting `update:progress` throughout.
 *
 * Streaming (not buffering ~70MB into memory) lets the caller show progress;
 * the per-attempt stall-abort guarantees no indefinite hang; and the range-based
 * resume means a flaky connection retries the tail rather than the whole file.
 *
 * @throws DownloadError/Error when the retry budget is exhausted or the failure
 * is non-retriable (e.g. HTTP 404). On throw, the partial file is left in place
 * for the caller to clean up.
 */
export async function downloadToFile(
    url: string,
    destPath: string,
    version: string,
    options: DownloadOptions = {},
): Promise<void> {

    const stallMs = options.stallMs ?? DOWNLOAD_STALL_MS;
    const maxAttempts = options.maxAttempts ?? DOWNLOAD_MAX_ATTEMPTS;
    const backoffMs = options.backoffMs ?? RETRY_BACKOFF_MS;

    const state: DownloadState = { total: 0 };

    for (let attemptNo = 1; attemptNo <= maxAttempts; attemptNo++) {

        const offset = await fileSizeOrZero(destPath);

        // A prior attempt already pulled the whole asset — nothing left to do.
        if (state.total > 0 && offset >= state.total) break;

        const [, err] = await attempt(() => downloadAttempt(url, destPath, version, offset, state, stallMs));

        if (!err) break;

        const retriable = !(err instanceof DownloadError) || err.retriable;

        if (!retriable || attemptNo >= maxAttempts) throw err;

        observer.emit('update:retry', { version, attempt: attemptNo, maxAttempts, error: err.message });

        await sleep(backoffMs * attemptNo);

    }

    await chmod(destPath, 0o755);

}

/**
 * One download attempt: fetch (resuming from `offset` when possible), stream the
 * body to `destPath`, and emit progress. Mutates `state.etag`/`state.total` as
 * soon as headers arrive so the orchestrator can resume even if this attempt
 * later throws.
 *
 * @throws DownloadError on an HTTP error, or the underlying stall/stream error.
 */
async function downloadAttempt(
    url: string,
    destPath: string,
    version: string,
    offset: number,
    state: DownloadState,
    stallMs: number,
): Promise<void> {

    // Resume only when there are bytes on disk AND an ETag to guard against the
    // asset changing under us; otherwise start clean.
    const resuming = offset > 0 && state.etag !== undefined;
    const headers: Record<string, string> = resuming
        ? { Range: `bytes=${offset}-`, 'If-Range': state.etag! }
        : {};

    const controller = new AbortController();
    let stallTimer: ReturnType<typeof setTimeout> | undefined;

    const armStall = () => {

        clearTimeout(stallTimer);
        stallTimer = setTimeout(
            () => controller.abort(new Error(`download stalled — no data for ${stallMs / 1000}s`)),
            stallMs,
        );

    };

    const response = await fetch(url, { headers, signal: controller.signal });

    const etag = response.headers.get('etag');
    if (etag) state.etag = etag;

    // Decide where the write starts and in which mode. 206 = server honored the
    // range → append. 200 = server sent the whole asset (fresh, or If-Range
    // rejected because it changed) → truncate and start over.
    let received: number;
    let writeMode: 'a' | 'w';

    if (response.status === 206) {

        state.total = parseContentRangeTotal(response.headers.get('content-range')) || state.total;
        received = offset;
        writeMode = 'a';

    }
    else if (response.ok) {

        state.total = Number(response.headers.get('content-length')) || 0;
        received = 0;
        writeMode = 'w';

    }
    else {

        clearTimeout(stallTimer);

        // 408/429/5xx are transient; other 4xx (404/403/…) are permanent.
        const retriable = response.status === 408 || response.status === 429 || response.status >= 500;

        throw new DownloadError(`HTTP ${response.status} downloading binary`, retriable);

    }

    if (!response.body) {

        clearTimeout(stallTimer);

        throw new DownloadError('empty response body', true);

    }

    const handle = await open(destPath, writeMode);
    let sinceLastEmit = 0;

    const [, streamErr] = await attempt(async () => {

        armStall();

        for await (const chunk of response.body as AsyncIterable<Uint8Array>) {

            await handle.write(chunk);

            received += chunk.byteLength;
            sinceLastEmit += chunk.byteLength;
            armStall();

            if (sinceLastEmit >= PROGRESS_EMIT_BYTES) {

                sinceLastEmit = 0;
                observer.emit('update:progress', { version, received, total: state.total });

            }

        }

    });

    clearTimeout(stallTimer);
    await handle.close();

    if (streamErr) {

        // controller.abort(reason) surfaces the stall reason as the thrown
        // error's `cause`; prefer it so the message says "stalled", not "aborted".
        const cause = streamErr.cause;

        throw cause instanceof Error ? cause : streamErr;

    }

    // A clean end that's short of the advertised total means the connection
    // dropped without throwing — treat as retriable so the loop resumes.
    if (state.total > 0 && received < state.total) {

        throw new DownloadError(`connection closed early (${received}/${state.total} bytes)`, true);

    }

    observer.emit('update:progress', { version, received, total: state.total || received });

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
