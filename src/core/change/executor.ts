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
import { sql } from 'kysely';

import { attempt, attemptSync } from '@logosdx/utils';

import { observer } from '../observer.js';
import { formatIdentity } from '../identity/resolver.js';
import { processFile, isTemplate } from '../template/index.js';
import { computeChecksum, computeCombinedChecksum } from '../runner/checksum.js';
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
    const history = new ChangeHistory(context.db, context.configName);

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
            dialect: context.dialect,
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
            history,
            start,
        ),
    );

    // Always release lock
    await attempt(() => lockManager.release(context.db, context.configName, identity));

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
    const history = new ChangeHistory(context.db, context.configName);
    const tracker = new ChangeTracker(context.db, context.configName);

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
            dialect: context.dialect,
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
            history,
            start,
        ),
    );

    // Always release lock
    await attempt(() => lockManager.release(context.db, context.configName, identity));

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
 * Execute files with tracking.
 */
async function executeFiles(
    context: ChangeContext,
    change: Change,
    files: ChangeFile[],
    direction: 'change' | 'revert',
    checksum: string,
    history: ChangeHistory,
    startTime: number,
): Promise<ChangeResult> {

    // Expand .txt manifests to actual file list
    const expandedFiles = await expandFiles(files, context.sqlDir);

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

    // Create pending file records
    const createRecordsErr = await history.createFileRecords(
        operationId,
        expandedFiles.map((f) => ({
            filepath: f.path,
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
                    checksum: fileChecksums.get(file.path) ?? '',
                    status: 'failed',
                    error: loadErr.message,
                    durationMs,
                });

                // Update DB record
                const updateErr = await history.updateFileExecution(
                    operationId,
                    file.path,
                    'failed',
                    durationMs,
                    loadErr.message,
                );

                if (updateErr) {

                    // Log but don't fail - we already have the error captured
                    observer.emit('error', {
                        source: 'change',
                        error: new Error(updateErr),
                        context: { filepath: file.path, operation: 'update-failed-record' },
                    });

                }

                break;

            }

            // Execute SQL
            const [, execErr] = await attempt(() => sql.raw(sqlContent).execute(context.db));

            const durationMs = performance.now() - fileStart;

            if (execErr) {

                // Capture error info FIRST
                failed = true;
                failedFile = file.path;
                failureError = execErr.message;

                results.push({
                    filepath: file.path,
                    checksum: fileChecksums.get(file.path) ?? '',
                    status: 'failed',
                    error: execErr.message,
                    durationMs,
                });

                // Update DB record
                const updateErr = await history.updateFileExecution(
                    operationId,
                    file.path,
                    'failed',
                    durationMs,
                    execErr.message,
                );

                if (updateErr) {

                    // Log but don't fail - we already have the error captured
                    observer.emit('error', {
                        source: 'change',
                        error: new Error(updateErr),
                        context: { filepath: file.path, operation: 'update-failed-record' },
                    });

                }

                break;

            }

            // Success
            results.push({
                filepath: file.path,
                checksum: fileChecksums.get(file.path) ?? '',
                status: 'success',
                durationMs,
            });

            // Update DB record
            const updateErr = await history.updateFileExecution(
                operationId,
                file.path,
                'success',
                durationMs,
            );

            if (updateErr) {

                // Log but continue - the file was executed successfully
                observer.emit('error', {
                    source: 'change',
                    error: new Error(updateErr),
                    context: { filepath: file.path, operation: 'update-success-record' },
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
