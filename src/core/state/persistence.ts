/**
 * Durable, serialized writes for the encrypted state file.
 *
 * state.enc holds every config, every secret and every DB password in a
 * project, and every mutation rewrites the whole file. A plain
 * `writeFileSync` opens with O_TRUNC, so an interrupted write leaves a
 * truncated file with no previous generation to fall back on, and two
 * processes writing at once silently overwrite each other. These helpers
 * are the seam that makes both cases safe.
 */
import { createHash, randomBytes } from 'crypto';
import {
    chmodSync,
    closeSync,
    copyFileSync,
    existsSync,
    fsyncSync,
    openSync,
    renameSync,
    statSync,
    unlinkSync,
    writeSync,
} from 'fs';
import { dirname } from 'path';
import { attemptSync } from '@logosdx/utils';

/** How long a writer waits for a competing writer to finish. */
const LOCK_TIMEOUT_MS = 5_000;

/**
 * How old a lock file must be before it is assumed to belong to a process
 * that died without releasing it. A held lock never lives this long — the
 * work it guards is one encrypt plus one write.
 */
const LOCK_STALE_MS = 30_000;

const LOCK_POLL_MS = 25;

/** Suffix of the previous-generation copy kept beside the state file. */
export const BACKUP_SUFFIX = '.bak';

/** Suffix of the lock file guarding writes to the state file. */
export const LOCK_SUFFIX = '.lock';

/**
 * Raised when another process held the state write lock for longer than a
 * write should ever take. Surfacing this beats writing anyway and losing
 * whatever the other process committed.
 *
 * @example
 * ```typescript
 * const [, err] = await attempt(() => state.setSecret('dev', 'K', 'v'));
 * if (err instanceof StateLockTimeoutError) {
 *     console.error('Another noorm process is writing state.');
 * }
 * ```
 */
export class StateLockTimeoutError extends Error {

    override readonly name = 'StateLockTimeoutError' as const;

    constructor(
        public readonly lockPath: string,
        public readonly timeoutMs: number,
    ) {

        super(
            `Timed out after ${timeoutMs}ms waiting for the state write lock at ${lockPath}. ` +
            'Another noorm process may still be writing.',
        );

    }

}

/**
 * Content fingerprint used to detect that the state file changed underneath
 * a writer that loaded it earlier.
 *
 * @example
 * ```typescript
 * const seen = fingerprintContents(readFileSync(statePath, 'utf8'));
 * // ...later, before overwriting:
 * if (fingerprintContents(readFileSync(statePath, 'utf8')) !== seen) reconcile();
 * ```
 */
export function fingerprintContents(contents: string): string {

    return createHash('sha256').update(contents).digest('hex');

}

function sleep(ms: number): Promise<void> {

    return new Promise((resolve) => setTimeout(resolve, ms));

}

/**
 * Take an exclusive advisory lock beside the state file.
 *
 * O_EXCL creation is the only cross-platform primitive that is atomic on
 * every filesystem noorm runs on, including the network mounts where
 * `flock` silently degrades to a no-op.
 *
 * @returns a release function the caller must invoke, including on failure
 *
 * @example
 * ```typescript
 * const release = await acquireWriteLock(`${statePath}.lock`);
 * const [, err] = attemptSync(() => writeStateFile(statePath, contents));
 * release();
 * if (err) throw err;
 * ```
 */
export async function acquireWriteLock(
    lockPath: string,
    timeoutMs: number = LOCK_TIMEOUT_MS,
): Promise<() => void> {

    const deadline = Date.now() + timeoutMs;

    for (;;) {

        const [fd, openErr] = attemptSync(() => openSync(lockPath, 'wx', 0o600));

        if (fd !== null && fd !== undefined) {

            attemptSync(() => writeSync(fd, String(process.pid)));
            attemptSync(() => closeSync(fd));

            return () => {

                attemptSync(() => unlinkSync(lockPath));

            };

        }

        // Anything other than "already locked" is a real filesystem problem
        // (missing directory, no permission) and retrying cannot fix it.
        if ((openErr as NodeJS.ErrnoException | undefined)?.code !== 'EEXIST') {

            throw openErr;

        }

        const [stats] = attemptSync(() => statSync(lockPath));

        if (stats && Date.now() - stats.mtimeMs > LOCK_STALE_MS) {

            attemptSync(() => unlinkSync(lockPath));
            continue;

        }

        if (Date.now() >= deadline) {

            throw new StateLockTimeoutError(lockPath, timeoutMs);

        }

        await sleep(LOCK_POLL_MS);

    }

}

/**
 * Replace a file's contents atomically and durably.
 *
 * Stages into a sibling temp file, flushes it, then renames over the
 * target. `rename` within a directory is atomic, so a reader sees either
 * the whole previous file or the whole new one — never a partial write, and
 * never a zero-length file if the process dies mid-write.
 *
 * @example
 * ```typescript
 * writeFileAtomicSync(statePath, JSON.stringify(payload, null, 2), 0o600);
 * ```
 */
export function writeFileAtomicSync(path: string, contents: string, mode: number): void {

    const tmpPath = `${path}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`;

    const [, err] = attemptSync(() => {

        const fd = openSync(tmpPath, 'wx', mode);

        const [, writeErr] = attemptSync(() => {

            writeSync(fd, contents);

            // rename only orders the directory entry; without this the file
            // contents can still be lost to a crash after the rename lands.
            fsyncSync(fd);

        });

        attemptSync(() => closeSync(fd));

        if (writeErr) throw writeErr;

        renameSync(tmpPath, path);

    });

    if (err) {

        attemptSync(() => unlinkSync(tmpPath));

        throw err;

    }

    syncDirectory(dirname(path));

}

/**
 * Copy the current state file aside as the previous generation.
 *
 * Without this a damaged state.enc is total, unrecoverable loss of every
 * config and secret in the project — there is no other backup anywhere.
 *
 * @example
 * ```typescript
 * backupExisting(statePath, 0o600); // -> statePath + '.bak'
 * ```
 */
export function backupExisting(path: string, mode: number): void {

    if (!existsSync(path)) return;

    const backupPath = `${path}${BACKUP_SUFFIX}`;

    // A failed backup must not block the write it precedes; that write is
    // atomic on its own, so the worst case is losing one generation of
    // history rather than losing the state file.
    attemptSync(() => {

        copyFileSync(path, backupPath);
        chmodSync(backupPath, mode);

    });

}

/**
 * Flush the directory entry so a completed rename survives a crash.
 *
 * Best effort: some platforms and filesystems reject opening a directory
 * for fsync, and the write itself has already landed by this point.
 */
function syncDirectory(dir: string): void {

    const [fd] = attemptSync(() => openSync(dir, 'r'));

    if (fd === null || fd === undefined) return;

    attemptSync(() => fsyncSync(fd));
    attemptSync(() => closeSync(fd));

}
