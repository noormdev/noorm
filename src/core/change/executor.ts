/**
 * Change executor.
 *
 * Orchestrates change execution by coordinating the parser, history,
 * and runner modules. Handles the full lifecycle from validation to
 * completion.
 *
 * WHY: Change execution is complex - it needs to parse files, check
 * status, acquire locks, execute SQL, and track results. The executor
 * centralizes this logic.
 *
 * @example
 * ```typescript
 * import { executeChange, revertChange } from './executor'
 *
 * // Execute a change
 * const result = await executeChange(context, change, options)
 *
 * // Revert a change
 * const revertResult = await revertChange(context, change, options)
 * ```
 */
import path from 'node:path';
import { readFile, writeFile as fsWriteFile, mkdir } from 'node:fs/promises';
import type { Kysely } from 'kysely';
import { sql } from 'kysely';

import { attempt, attemptSync } from '@logosdx/utils';

import { observer } from '../observer.js';
import { formatIdentity } from '../identity/resolver.js';
import { processFile, isTemplate } from '../template/index.js';
import { assertPolicy } from '../policy/index.js';
import type { Permission } from '../policy/index.js';
import type { Dialect } from '../connection/types.js';
import { computeChecksum, computeCombinedChecksum } from '../runner/checksum.js';
import { getSqlErrorMessage } from '../shared/index.js';
import type { NoormDatabase } from '../shared/index.js';
import { getLockManager } from '../lock/index.js';
import { ChangeHistory } from './history.js';
import { ChangeTracker } from './tracker.js';
import { resolveManifest, validateChange, hasRevertFiles } from './parser.js';
import type {
    Change,
    ChangeFile,
    ChangeContext,
    ChangeOptions,
    ChangeResult,
    ChangeFileResult,
} from './types.js';
import { ChangeNotAppliedError, ChangeValidationError } from './types.js';

// ─────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────

const DEFAULT_OPTIONS: Required<Omit<ChangeOptions, 'output'>> & { output: string | null } = {
    force: false,
    dryRun: false,
    preview: false,
    output: null,
};

/** Default SQL template - files with only this content are considered empty */
const SQL_TEMPLATE = '-- TODO: Add SQL statements here';

/**
 * Gate a change entrypoint against the config's access policy.
 *
 * The single enforcement seam for `executeChange`/`revertChange`: every
 * caller (SDK, TUI, CLI) funnels through one of these functions, so gating
 * here — rather than per-caller — closes the surface uniformly. Change
 * files are command-gated, not content-classified.
 *
 * @throws Error carrying the policy's blockedReason when the channel's
 * role denies the permission.
 */
function assertChangePolicy(context: ChangeContext, permission: Permission): void {

    assertPolicy(context.channel, { name: context.configName, access: context.access }, permission);

}

// ─────────────────────────────────────────────────────────────
// Execute Change (Change Direction)
// ─────────────────────────────────────────────────────────────

/**
 * Execute a change (apply changes).
 *
 * @param context - Execution context
 * @param change - Change to execute
 * @param options - Execution options
 * @returns Execution result
 *
 * @example
 * ```typescript
 * const result = await executeChange(context, change, {
 *     force: false,
 *     dryRun: false,
 * })
 *
 * if (result.status === 'success') {
 *     console.log('Change applied successfully')
 * }
 * ```
 */
export async function executeChange(
    context: ChangeContext,
    change: Change,
    options: ChangeOptions = {},
): Promise<ChangeResult> {

    assertChangePolicy(context, 'change:run');

    const start = performance.now();
    const opts = { ...DEFAULT_OPTIONS, ...options };

    // Validate change structure
    const [, validateErr] = attemptSync(() => {

        validateChange(change);

    });

    if (validateErr) {

        observer.emit('error', {
            source: 'change',
            error: validateErr,
            context: { name: change.name, operation: 'validate' },
        });

        return createFailedResult(change.name, 'change', validateErr.message, start);

    }

    // Get files to execute
    const files = change.changeFiles;

    if (files.length === 0) {

        throw new ChangeValidationError(change.name, 'No files in change/ folder');

    }

    // Validate files have actual content (not empty or template-only)
    const [contentValid, contentErr] = await attempt(() => validateFilesHaveContent(files));

    if (contentErr || !contentValid) {

        throw new ChangeValidationError(
            change.name,
            'Files are empty or contain only template placeholders. Edit the SQL files before running.',
        );

    }

    // Compute checksum
    const [checksums, checksumErr] = await attempt(() =>
        computeFileChecksums(files, context.sqlDir),
    );

    if (checksumErr) {

        return createFailedResult(change.name, 'change', checksumErr.message, start);

    }

    const changeChecksum = computeCombinedChecksum(checksums);

    // Create history tracker
    const history = new ChangeHistory(context.db, context.configName, context.dialect ?? 'postgres');

    // Check if needs to run (unless dry run or preview)
    if (!opts.dryRun && !opts.preview) {

        const needsRunResult = await history.needsRun(
            change.name,
            changeChecksum,
            opts.force,
        );

        if (!needsRunResult.needsRun) {

            observer.emit('change:skip', {
                name: change.name,
                reason: needsRunResult.skipReason ?? 'already applied',
            });

            return {
                name: change.name,
                direction: 'change',
                status: 'success',
                files: [],
                durationMs: performance.now() - start,
            };

        }

    }

    // Handle dry run
    if (opts.dryRun) {

        return executeDryRun(context, change, files, 'change', start);

    }

    // Handle preview
    if (opts.preview) {

        return executePreview(context, change, files, 'change', opts.output, start);

    }

    // Acquire lock
    const lockManager = getLockManager();
    const identity = formatIdentity(context.identity);

    const [, lockErr] = await attempt(() =>
        lockManager.acquire(context.db, context.configName, identity, {
            reason: `Change: ${change.name}`,
            dialect: context.dialect ?? 'postgres',
        }),
    );

    if (lockErr) {

        // Lock error is thrown, not returned
        throw lockErr;

    }

    // Execute files (lock will be released after, regardless of outcome)
    const [result, execErr] = await attempt(() =>
        executeFiles(
            context,
            change,
            files,
            'change',
            changeChecksum,
            opts.force,
            history,
            start,
        ),
    );

    // Always release lock
    await attempt(() => lockManager.release(context.db, context.configName, identity, context.dialect ?? 'postgres'));

    if (execErr) {

        throw execErr;

    }

    return result;

}

// ─────────────────────────────────────────────────────────────
// Revert Change
// ─────────────────────────────────────────────────────────────

/**
 * Revert a change (apply revert files).
 *
 * @param context - Execution context
 * @param change - Change to revert
 * @param options - Execution options
 * @returns Execution result
 */
export async function revertChange(
    context: ChangeContext,
    change: Change,
    options: ChangeOptions = {},
): Promise<ChangeResult> {

    assertChangePolicy(context, 'change:revert');

    const start = performance.now();
    const opts = { ...DEFAULT_OPTIONS, ...options };

    // Check for revert files
    if (!hasRevertFiles(change)) {

        throw new ChangeValidationError(
            change.name,
            'No revert files (revert/ folder is empty or missing)',
        );

    }

    const files = change.revertFiles;

    // Compute checksum
    const [checksums, checksumErr] = await attempt(() =>
        computeFileChecksums(files, context.sqlDir),
    );

    if (checksumErr) {

        return createFailedResult(change.name, 'revert', checksumErr.message, start);

    }

    const revertChecksum = computeCombinedChecksum(checksums);

    // Create trackers
    const history = new ChangeHistory(context.db, context.configName, context.dialect ?? 'postgres');
    const tracker = new ChangeTracker(context.db, context.configName, context.dialect ?? 'postgres');

    // Check if can revert (unless dry run or preview)
    if (!opts.dryRun && !opts.preview) {

        const canRevertResult = await tracker.canRevert(change.name, opts.force);

        if (!canRevertResult.canRevert) {

            if (canRevertResult.reason === 'not applied') {

                throw new ChangeNotAppliedError(change.name);

            }

            observer.emit('change:skip', {
                name: change.name,
                reason: canRevertResult.reason ?? 'cannot revert',
            });

            return {
                name: change.name,
                direction: 'revert',
                status: 'success',
                files: [],
                durationMs: performance.now() - start,
            };

        }

    }

    // Handle dry run
    if (opts.dryRun) {

        return executeDryRun(context, change, files, 'revert', start);

    }

    // Handle preview
    if (opts.preview) {

        return executePreview(context, change, files, 'revert', opts.output, start);

    }

    // Acquire lock
    const lockManager = getLockManager();
    const identity = formatIdentity(context.identity);

    const [, lockErr] = await attempt(() =>
        lockManager.acquire(context.db, context.configName, identity, {
            reason: `Revert: ${change.name}`,
            dialect: context.dialect ?? 'postgres',
        }),
    );

    if (lockErr) {

        throw lockErr;

    }

    // Execute files (lock will be released after, regardless of outcome)
    const [result, execErr] = await attempt(() =>
        executeFiles(
            context,
            change,
            files,
            'revert',
            revertChecksum,
            opts.force,
            history,
            start,
        ),
    );

    // Always release lock
    await attempt(() => lockManager.release(context.db, context.configName, identity, context.dialect ?? 'postgres'));

    if (execErr) {

        throw execErr;

    }

    // If successful, mark original as reverted
    if (result.status === 'success') {

        await tracker.markAsReverted(change.name);

    }

    return result;

}

// ─────────────────────────────────────────────────────────────
// Internal: Execute Files
// ─────────────────────────────────────────────────────────────

/**
 * Dialects where wrapping a change's execution in a DB transaction
 * actually rolls back DDL alongside the history rows written for it.
 * Postgres only, for now: MySQL's DDL
 * implicitly commits (a wrapping transaction would silently do nothing),
 * MSSQL's GO-batch-split execution (`runner/mssql-batches.ts`) hasn't been
 * verified to compose safely with a wrapping transaction, and SQLite is
 * excluded on purpose so the per-file-skip scenario this ticket's unit
 * tests depend on (file A commits independently of file B's failure)
 * keeps working rather than collapsing into all-or-nothing.
 */
const TRANSACTIONAL_DIALECTS = new Set<Dialect>(['postgres']);

/**
 * Sentinel used to carry a failed `ChangeResult` out of a rolled-back
 * Postgres transaction.
 *
 * Thrown (never returned) from inside `context.db.transaction().execute()`
 * so Kysely rolls back everything issued in the callback — DDL and the
 * operation/file history rows alike. Caught immediately outside the
 * transaction and unwrapped back into the result the caller sees.
 */
class ChangeRollback extends Error {

    constructor(readonly result: ChangeResult) {

        super('change rolled back');

    }

}

/**
 * Execute files with tracking.
 *
 * Dispatches to `runFileBatch` either directly against `context.db`
 * (non-transactional dialects — identical to CP1's behavior) or inside a
 * `context.db.transaction()` (Postgres), so a failed Postgres change
 * leaves no partial state: neither the DDL nor the operation/file history
 * rows persist.
 */
async function executeFiles(
    context: ChangeContext,
    change: Change,
    files: ChangeFile[],
    direction: 'change' | 'revert',
    checksum: string,
    force: boolean,
    history: ChangeHistory,
    startTime: number,
): Promise<ChangeResult> {

    const dialect = context.dialect ?? 'postgres';
    const expandedFiles = await expandFiles(files, context.sqlDir);

    if (!TRANSACTIONAL_DIALECTS.has(dialect)) {

        return runFileBatch(
            context,
            change,
            expandedFiles,
            direction,
            checksum,
            force,
            history,
            context.db,
            startTime,
        );

    }

    // On Postgres a FAILED change leaves NO persisted history at all —
    // the operation and file rows created inside this transaction roll
    // back together with the DDL. The caller still sees the failure via
    // the returned ChangeResult (unwrapped from ChangeRollback below),
    // but it's invisible in the DB — intentional per spec (atomicity over
    // a persisted failure record). On retry, the top-level `needsRun`
    // finds no record for the change and reruns it fresh. Do NOT try to
    // persist a failure record outside the transaction — that would
    // defeat the guarantee this branch exists for.
    const [result, err] = await attempt(() =>
        context.db.transaction().execute(async (trx) => {

            const trxHistory = new ChangeHistory(trx, context.configName, dialect);

            const batchResult = await runFileBatch(
                context,
                change,
                expandedFiles,
                direction,
                checksum,
                force,
                trxHistory,
                trx,
                startTime,
            );

            if (batchResult.status !== 'success') {

                throw new ChangeRollback(batchResult);

            }

            return batchResult;

        }),
    );

    if (err) {

        if (err instanceof ChangeRollback) {

            return { ...err.result, operationId: undefined };

        }

        return createFailedResult(change.name, direction, err.message, startTime);

    }

    return result;

}

/**
 * Run one execution batch — operation creation, per-file execution with
 * history tracking, and finalization — against a given executor handle.
 *
 * Extracted from `executeFiles` so the identical batch logic runs either
 * directly against `context.db` (non-transactional dialects) or inside a
 * `context.db.transaction()` callback against `trx` (Postgres): only the
 * `executor` (where SQL runs) and `history` (where tracking rows are
 * written) vary between the two call sites.
 */
async function runFileBatch(
    context: ChangeContext,
    change: Change,
    expandedFiles: ChangeFile[],
    direction: 'change' | 'revert',
    checksum: string,
    force: boolean,
    history: ChangeHistory,
    executor: Kysely<NoormDatabase>,
    startTime: number,
): Promise<ChangeResult> {

    // Create operation record
    const [operationId, createErr] = await attempt(() =>
        history.createOperation({
            name: change.name,
            direction,
            executedBy: formatIdentity(context.identity),
        }),
    );

    if (createErr) {

        observer.emit('error', {
            source: 'change',
            error: createErr,
            context: { name: change.name, operation: 'create-operation' },
        });

        return createFailedResult(change.name, direction, createErr.message, startTime);

    }

    // Compute checksums for all files
    const fileChecksums = new Map<string, string>();

    for (const file of expandedFiles) {

        const [cs] = await attempt(() => computeChecksum(file.path));
        fileChecksums.set(file.path, cs ?? '');

    }

    // Create pending file records (use relative paths to avoid leaking absolute paths)
    const createRecordsErr = await history.createFileRecords(
        operationId,
        expandedFiles.map((f) => ({
            filepath: path.relative(context.projectRoot, f.path),
            fileType: f.type,
            checksum: fileChecksums.get(f.path) ?? '',
        })),
    );

    if (createRecordsErr) {

        // File records couldn't be created - finalize as failed and return
        await history.finalizeOperation(operationId, 'failed', checksum, 0, createRecordsErr);

        return {
            name: change.name,
            direction,
            status: 'failed',
            files: [],
            durationMs: performance.now() - startTime,
            error: createRecordsErr,
            operationId,
        };

    }

    // Emit start event
    observer.emit('change:start', {
        name: change.name,
        direction,
        files: expandedFiles.map((f) => f.path),
    });

    // Execute each file
    const results: ChangeFileResult[] = [];
    let failed = false;
    let failedFile: string | undefined;
    let failureError: string | undefined;

    // Execute loop wrapped in attempt to catch unexpected errors
    const [, unexpectedErr] = await attempt(async () => {

        for (let i = 0; i < expandedFiles.length; i++) {

            const file = expandedFiles[i];

            if (!file) continue;

            observer.emit('change:file', {
                change: change.name,
                filepath: file.path,
                index: i,
                total: expandedFiles.length,
            });

            const fileStart = performance.now();
            const relPath = path.relative(context.projectRoot, file.path);
            const fileChecksum = fileChecksums.get(file.path) ?? '';

            // Per-file skip: a prior success with a matching checksum means this
            // file doesn't need to run again, even though the overall change's
            // checksum differs because another file needed fixing.
            const needsRunFileResult = await history.needsRunFile(
                change.name,
                direction,
                relPath,
                fileChecksum,
                force,
            );

            if (!needsRunFileResult.needsRun) {

                results.push({
                    filepath: file.path,
                    checksum: fileChecksum,
                    status: 'skipped',
                    skipReason: needsRunFileResult.skipReason,
                    durationMs: 0,
                });

                const skipUpdateErr = await history.updateFileExecution(
                    operationId,
                    relPath,
                    'skipped',
                    0,
                    undefined,
                    needsRunFileResult.skipReason,
                );

                if (skipUpdateErr) {

                    // Log but continue - the skip decision itself is sound
                    observer.emit('error', {
                        source: 'change',
                        error: new Error(skipUpdateErr),
                        context: { filepath: relPath, operation: 'update-skipped-record' },
                    });

                }

                continue;

            }

            // Load and render file
            const [sqlContent, loadErr] = await attempt(() => loadAndRenderFile(context, file.path));

            if (loadErr) {

                const durationMs = performance.now() - fileStart;

                // Capture error info FIRST
                failed = true;
                failedFile = file.path;
                failureError = loadErr.message;

                results.push({
                    filepath: file.path,
                    checksum: fileChecksum,
                    status: 'failed',
                    error: loadErr.message,
                    durationMs,
                });

                // Update DB record (use relative path to match createFileRecords)
                const updateErr = await history.updateFileExecution(
                    operationId,
                    relPath,
                    'failed',
                    durationMs,
                    loadErr.message,
                );

                if (updateErr) {

                    // Log but don't fail - we already have the error captured
                    observer.emit('error', {
                        source: 'change',
                        error: new Error(updateErr),
                        context: { filepath: relPath, operation: 'update-failed-record' },
                    });

                }

                break;

            }

            // Execute SQL
            const [, execErr] = await attempt(() => sql.raw(sqlContent).execute(executor));

            const durationMs = performance.now() - fileStart;

            if (execErr) {

                // Capture error info FIRST — use getSqlErrorMessage to preserve
                // TDS diagnostics (line numbers, error codes, procedure names)
                const errorMessage = getSqlErrorMessage(execErr);
                failed = true;
                failedFile = file.path;
                failureError = errorMessage;

                results.push({
                    filepath: file.path,
                    checksum: fileChecksum,
                    status: 'failed',
                    error: errorMessage,
                    durationMs,
                });

                // Update DB record (use relative path to match createFileRecords)
                const updateErr2 = await history.updateFileExecution(
                    operationId,
                    relPath,
                    'failed',
                    durationMs,
                    errorMessage,
                );

                if (updateErr2) {

                    // Log but don't fail - we already have the error captured
                    observer.emit('error', {
                        source: 'change',
                        error: new Error(updateErr2),
                        context: { filepath: relPath, operation: 'update-failed-record' },
                    });

                }

                break;

            }

            // Success
            results.push({
                filepath: file.path,
                checksum: fileChecksum,
                status: 'success',
                durationMs,
            });

            // Update DB record (use relative path to match createFileRecords)
            const updateErr = await history.updateFileExecution(
                operationId,
                relPath,
                'success',
                durationMs,
            );

            if (updateErr) {

                // Log but continue - the file was executed successfully
                observer.emit('error', {
                    source: 'change',
                    error: new Error(updateErr),
                    context: { filepath: relPath, operation: 'update-success-record' },
                });

            }

        }

    });

    // Handle unexpected errors from the execution loop
    if (unexpectedErr) {

        if (!failed) {

            failed = true;
            failureError = unexpectedErr.message;

        }

        observer.emit('error', {
            source: 'change',
            error: unexpectedErr,
            context: { name: change.name, operation: 'execute-files' },
        });

    }

    // Mark remaining pending files as skipped if there was a failure
    // This handles both normal failures and unexpected exceptions
    if (failed) {

        const skipReason = failedFile
            ? `${path.basename(failedFile)} failed: ${failureError ?? 'unknown error'}`
            : 'change failed';

        const skipError = await history.skipRemainingFiles(operationId, skipReason);

        if (skipError) {

            // Log skip failure but continue - the change already failed
            observer.emit('error', {
                source: 'change',
                error: new Error(skipError),
                context: { operationId, operation: 'skip-remaining-files' },
            });

        }

    }

    // Finalize operation
    const totalDurationMs = performance.now() - startTime;
    const executionStatus = failed ? 'failed' : 'success';

    // Build detailed error message for the change record
    const errorMessage = failedFile
        ? `${path.basename(failedFile)}: ${failureError ?? 'unknown error'}`
        : failureError;

    const finalizeError = await history.finalizeOperation(
        operationId,
        executionStatus,
        checksum,
        totalDurationMs,
        failed ? errorMessage : undefined,
    );

    // Final status accounts for BOTH execution AND finalization
    // If finalization failed, the change is effectively failed regardless of execution
    const finalStatus = finalizeError ? 'failed' : executionStatus;
    const combinedError = finalizeError
        ? `${errorMessage ?? 'Execution succeeded but finalization failed'}. Additionally: ${finalizeError}`
        : errorMessage;

    // Emit complete event
    observer.emit('change:complete', {
        name: change.name,
        direction,
        status: finalStatus,
        durationMs: totalDurationMs,
    });

    return {
        name: change.name,
        direction,
        status: finalStatus,
        files: results,
        durationMs: totalDurationMs,
        error: finalStatus === 'failed' ? combinedError : undefined,
        operationId,
    };

}

// ─────────────────────────────────────────────────────────────
// Internal: Preview
// ─────────────────────────────────────────────────────────────

/**
 * Execute preview mode.
 */
async function executePreview(
    context: ChangeContext,
    change: Change,
    files: ChangeFile[],
    direction: 'change' | 'revert',
    output: string | null,
    startTime: number,
): Promise<ChangeResult> {

    const expandedFiles = await expandFiles(files, context.sqlDir);
    const results: ChangeFileResult[] = [];
    const rendered: string[] = [];

    for (const file of expandedFiles) {

        const fileStart = performance.now();

        // Compute checksum
        const [checksum] = await attempt(() => computeChecksum(file.path));

        // Load and render file
        const [sqlContent, loadErr] = await attempt(() => loadAndRenderFile(context, file.path));

        if (loadErr) {

            results.push({
                filepath: file.path,
                checksum: checksum ?? '',
                status: 'failed',
                error: loadErr.message,
                durationMs: performance.now() - fileStart,
            });

            continue;

        }

        rendered.push(formatPreviewHeader(file.path) + sqlContent);

        results.push({
            filepath: file.path,
            checksum: checksum ?? '',
            status: 'success',
            durationMs: performance.now() - fileStart,
            renderedSql: sqlContent,
        });

    }

    // Write to output file if specified
    if (output) {

        const { writeFile } = await import('node:fs/promises');

        const combinedSql = rendered.join('\n\n');
        await writeFile(output, combinedSql, 'utf-8');

    }

    return {
        name: change.name,
        direction,
        status: results.every((r) => r.status === 'success') ? 'success' : 'failed',
        files: results,
        durationMs: performance.now() - startTime,
    };

}

// ─────────────────────────────────────────────────────────────
// Internal Helpers
// ─────────────────────────────────────────────────────────────

/**
 * Expand .txt manifest files to actual SQL paths.
 */
async function expandFiles(files: ChangeFile[], sqlDir: string): Promise<ChangeFile[]> {

    const expanded: ChangeFile[] = [];

    for (const file of files) {

        if (file.type === 'txt') {

            // .txt files reference other SQL files
            if (file.resolvedPaths) {

                for (const resolvedPath of file.resolvedPaths) {

                    expanded.push({
                        filename: path.basename(resolvedPath),
                        path: resolvedPath,
                        type: 'sql',
                    });

                }

            }
            else {

                // Resolve now if not already resolved
                const resolved = await resolveManifest(file.path, sqlDir);

                for (const resolvedPath of resolved) {

                    expanded.push({
                        filename: path.basename(resolvedPath),
                        path: resolvedPath,
                        type: 'sql',
                    });

                }

            }

        }
        else {

            expanded.push(file);

        }

    }

    return expanded;

}

/**
 * Compute checksums for all files, including expanded manifests.
 */
async function computeFileChecksums(files: ChangeFile[], sqlDir: string): Promise<string[]> {

    const checksums: string[] = [];

    for (const file of files) {

        // Compute checksum of the file itself
        const fileChecksum = await computeChecksum(file.path);
        checksums.push(fileChecksum);

        // For .txt files, also include checksums of referenced files
        if (file.type === 'txt') {

            const resolved = file.resolvedPaths ?? (await resolveManifest(file.path, sqlDir));

            for (const resolvedPath of resolved) {

                const refChecksum = await computeChecksum(resolvedPath);
                checksums.push(refChecksum);

            }

        }

    }

    return checksums;

}

/**
 * Format preview header for a file.
 */
function formatPreviewHeader(filepath: string): string {

    return `-- ============================================================
-- File: ${filepath}
-- ============================================================

`;

}

/**
 * Validate that at least one file has actual content (not empty or template-only).
 * Returns true if valid, false if all files are empty/template.
 */
async function validateFilesHaveContent(files: ChangeFile[]): Promise<boolean> {

    for (const file of files) {

        // .txt manifest files are considered valid (they reference other files)
        if (file.type === 'txt') {

            return true;

        }

        const [content, err] = await attempt(() => readFile(file.path, 'utf-8'));

        if (err) {

            continue; // Skip files we can't read

        }

        const trimmed = content?.trim() ?? '';

        // Check if file has actual content (not empty, not just the template)
        if (trimmed && trimmed !== SQL_TEMPLATE) {

            return true;

        }

    }

    return false;

}

/**
 * Create a failed result.
 */
function createFailedResult(
    name: string,
    direction: 'change' | 'revert',
    error: string,
    startTime: number,
): ChangeResult {

    return {
        name,
        direction,
        status: 'failed',
        files: [],
        durationMs: performance.now() - startTime,
        error,
    };

}

/**
 * Execute dry run mode.
 *
 * Writes rendered SQL to tmp/ without executing or tracking.
 */
async function executeDryRun(
    context: ChangeContext,
    change: Change,
    files: ChangeFile[],
    direction: 'change' | 'revert',
    startTime: number,
): Promise<ChangeResult> {

    const expandedFiles = await expandFiles(files, context.sqlDir);
    const results: ChangeFileResult[] = [];

    for (const file of expandedFiles) {

        const fileStart = performance.now();

        // Compute checksum
        const [checksum] = await attempt(() => computeChecksum(file.path));

        // Load and render file
        const [sqlContent, loadErr] = await attempt(() => loadAndRenderFile(context, file.path));

        if (loadErr) {

            observer.emit('file:dry-run', {
                filepath: file.path,
                status: 'failed',
                error: loadErr.message,
            });

            results.push({
                filepath: file.path,
                checksum: checksum ?? '',
                status: 'failed',
                error: loadErr.message,
                durationMs: performance.now() - fileStart,
            });

            continue;

        }

        // Write to tmp/
        const [, writeErr] = await attempt(() =>
            writeDryRunOutput(context.projectRoot, file.path, sqlContent),
        );

        const durationMs = performance.now() - fileStart;

        if (writeErr) {

            observer.emit('error', {
                source: 'change',
                error: writeErr,
                context: { filepath: file.path, operation: 'dry-run-write' },
            });

        }

        const outputPath = getDryRunOutputPath(context.projectRoot, file.path);

        observer.emit('file:dry-run', {
            filepath: file.path,
            status: 'success',
            outputPath,
        });

        results.push({
            filepath: file.path,
            checksum: checksum ?? '',
            status: 'success',
            durationMs,
            renderedSql: sqlContent,
        });

    }

    return {
        name: change.name,
        direction,
        status: results.every((r) => r.status === 'success') ? 'success' : 'failed',
        files: results,
        durationMs: performance.now() - startTime,
    };

}

/**
 * Get the output path for a dry run file.
 *
 * Mirrors the source path structure under tmp/.
 */
function getDryRunOutputPath(projectRoot: string, filepath: string): string {

    const relativePath = path.relative(projectRoot, filepath);

    const outputRelativePath = relativePath.endsWith('.tmpl')
        ? relativePath.slice(0, -5)
        : relativePath;

    return path.join(projectRoot, 'tmp', outputRelativePath);

}

/**
 * Write rendered SQL to tmp/ directory for dry run.
 */
async function writeDryRunOutput(
    projectRoot: string,
    filepath: string,
    content: string,
): Promise<void> {

    const outputPath = getDryRunOutputPath(projectRoot, filepath);

    // Ensure directory exists
    const outputDir = path.dirname(outputPath);
    await mkdir(outputDir, { recursive: true });

    // Write file
    await fsWriteFile(outputPath, content, 'utf-8');

}

/**
 * Load and optionally render a SQL file.
 */
async function loadAndRenderFile(context: ChangeContext, filepath: string): Promise<string> {

    if (isTemplate(filepath)) {

        const result = await processFile(filepath, {
            projectRoot: context.projectRoot,
            config: undefined, // Change context doesn't have config
            secrets: undefined,
            globalSecrets: undefined,
        });

        return result.sql;

    }

    const [content, err] = await attempt(() => readFile(filepath, 'utf-8'));

    if (err) {

        throw new Error(`Failed to read file: ${filepath}`, { cause: err });

    }

    return content;

}
