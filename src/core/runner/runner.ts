/**
 * SQL file runner.
 *
 * Executes SQL files against a database connection with:
 * - Checksum-based change detection (skip unchanged files)
 * - Template rendering for .sql.tmpl files
 * - Execution tracking in __noorm_change__ / __noorm_executions__
 * - Preview mode for inspecting rendered SQL
 *
 * WHY: Build systems need idempotent execution. Running unchanged
 * files wastes time and can cause issues with non-idempotent DDL.
 * The runner tracks what has run and skips unchanged files.
 *
 * @example
 * ```typescript
 * import { runBuild, runFile, runDir } from './runner'
 *
 * // Execute all files in schema directory
 * const result = await runBuild(context, '/project/sql', options)
 *
 * // Execute a single file
 * const fileResult = await runFile(context, '/project/sql/001.sql', options)
 *
 * // Execute all files in a directory
 * const dirResult = await runDir(context, '/project/sql/migrations', options)
 * ```
 */
import path from 'node:path';
import { readFile, readdir, writeFile as fsWriteFile, mkdir } from 'node:fs/promises';
import { sql } from 'kysely';

import { attempt, attemptSync } from '@logosdx/utils';

import { observer } from '../observer.js';
import { formatIdentity } from '../identity/resolver.js';
import { processFile, isTemplate } from '../template/index.js';
import { computeChecksum, computeChecksumFromContent, computeCombinedChecksum } from './checksum.js';
import { Tracker } from './tracker.js';
import type {
    RunOptions,
    RunContext,
    FileResult,
    BatchResult,
    BatchStatus,
    FileInput,
    ExecuteFilesOptions,
    ChangeType,
} from './types.js';

// ─────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────

const SQL_EXTENSIONS = ['.sql', '.sql.tmpl'];

const FILE_HEADER_TEMPLATE = `-- ============================================================
-- File: %FILE%
-- ============================================================

`;

// ─────────────────────────────────────────────────────────────
// Build Mode
// ─────────────────────────────────────────────────────────────

/**
 * Execute all SQL files in a schema directory.
 *
 * Files are discovered recursively, sorted alphabetically, and
 * executed in order. Use numeric prefixes (001_, 002_) to control
 * execution order.
 *
 * @param context - Run context (db, identity, config)
 * @param sqlPath - Path to SQL files directory
 * @param options - Run options
 * @returns Batch result with all file results
 *
 * @example
 * ```typescript
 * const result = await runBuild(context, '/project/sql')
 *
 * console.log(`Ran ${result.filesRun} files in ${result.durationMs}ms`)
 * ```
 */
export async function runBuild(
    context: RunContext,
    sqlPath: string,
    options: RunOptions = {},
): Promise<BatchResult> {

    const start = performance.now();
    const opts = { ...DEFAULT_RUN_OPTIONS_INTERNAL, ...options };

    // Discover files
    const [files, discoverErr] = await attempt(() => discoverFiles(sqlPath));

    if (discoverErr) {

        observer.emit('error', {
            source: 'runner',
            error: discoverErr,
            context: { sqlPath, operation: 'discover-files' },
        });

        return createFailedBatchResult(discoverErr.message, performance.now() - start);

    }

    observer.emit('build:start', {
        sqlPath,
        fileCount: files.length,
    });

    // Execute files
    const result = await executeFilesInternal(context, files, opts, 'build');

    observer.emit('build:complete', {
        status: result.status,
        filesRun: result.filesRun,
        filesSkipped: result.filesSkipped,
        filesFailed: result.filesFailed,
        durationMs: result.durationMs,
    });

    return result;

}

// ─────────────────────────────────────────────────────────────
// File Mode
// ─────────────────────────────────────────────────────────────

/**
 * Execute a single SQL file.
 *
 * @param context - Run context
 * @param filepath - Path to SQL file
 * @param options - Run options
 * @returns File result
 *
 * @example
 * ```typescript
 * const result = await runFile(context, '/project/sql/001_users.sql')
 *
 * if (result.status === 'success') {
 *     console.log('File executed successfully')
 * }
 * ```
 */
export async function runFile(
    context: RunContext,
    filepath: string,
    options: RunOptions = {},
): Promise<FileResult> {

    const opts = { ...DEFAULT_RUN_OPTIONS_INTERNAL, ...options };

    observer.emit('run:file', {
        filepath,
        configName: context.configName,
    });

    // For single file, we still create an operation record for tracking
    const tracker = new Tracker(context.db, context.configName);
    const operationName = `run:${new Date().toISOString()}`;

    const [operationId, createErr] = await attempt(() =>
        tracker.createOperation({
            name: operationName,
            changeType: 'run',
            configName: context.configName,
            executedBy: formatIdentity(context.identity),
        }),
    );

    if (createErr) {

        observer.emit('error', {
            source: 'runner',
            error: createErr,
            context: { filepath, operation: 'create-operation' },
        });

        return {
            filepath,
            checksum: '',
            status: 'failed',
            error: createErr.message,
        };

    }

    const result = await executeSingleFile(context, filepath, opts, tracker, operationId!);

    // Finalize operation
    await tracker.finalizeOperation(
        operationId!,
        result.status === 'failed' ? 'failed' : 'success',
        Math.round(result.durationMs ?? 0),
        result.checksum,
        result.error,
    );

    return result;

}

// ─────────────────────────────────────────────────────────────
// Dir Mode
// ─────────────────────────────────────────────────────────────

/**
 * Execute all SQL files in a directory.
 *
 * Similar to build mode but for a specific directory.
 *
 * @param context - Run context
 * @param dirpath - Path to directory
 * @param options - Run options
 * @returns Batch result
 *
 * @example
 * ```typescript
 * const result = await runDir(context, '/project/sql/migrations')
 * ```
 */
export async function runDir(
    context: RunContext,
    dirpath: string,
    options: RunOptions = {},
): Promise<BatchResult> {

    const start = performance.now();
    const opts = { ...DEFAULT_RUN_OPTIONS_INTERNAL, ...options };

    // Discover files
    const [files, discoverErr] = await attempt(() => discoverFiles(dirpath));

    if (discoverErr) {

        observer.emit('error', {
            source: 'runner',
            error: discoverErr,
            context: { dirpath, operation: 'discover-files' },
        });

        return createFailedBatchResult(discoverErr.message, performance.now() - start);

    }

    observer.emit('run:dir', {
        dirpath,
        fileCount: files.length,
        configName: context.configName,
    });

    // Execute files
    return executeFilesInternal(context, files, opts, 'run');

}

/**
 * Run specific SQL files.
 *
 * Executes the given list of files in order.
 *
 * @param context - Run context
 * @param files - Array of file paths to execute
 * @param options - Run options
 * @returns Batch result
 */
export async function runFiles(
    context: RunContext,
    files: string[],
    options: RunOptions = {},
): Promise<BatchResult> {

    const opts = { ...DEFAULT_RUN_OPTIONS_INTERNAL, ...options };

    observer.emit('run:files', {
        fileCount: files.length,
        configName: context.configName,
    });

    // Execute files
    return executeFilesInternal(context, files, opts, 'run');

}

// ─────────────────────────────────────────────────────────────
// Preview Mode
// ─────────────────────────────────────────────────────────────

/**
 * Preview rendered SQL without executing.
 *
 * Useful for debugging templates and verifying SQL before execution.
 *
 * @param context - Run context
 * @param filepaths - Files to preview
 * @param output - Optional output file path
 * @returns Array of file results with rendered SQL
 */
export async function preview(
    context: RunContext,
    filepaths: string[],
    output?: string | null,
): Promise<FileResult[]> {

    const results: FileResult[] = [];
    const rendered: string[] = [];

    for (const filepath of filepaths) {

        const [sqlContent, err] = await attempt(() => loadAndRenderFile(context, filepath));

        if (err) {

            results.push({
                filepath,
                checksum: '',
                status: 'failed',
                error: err.message,
            });
            continue;

        }

        const checksum = await computeChecksum(filepath);

        results.push({
            filepath,
            checksum,
            status: 'success',
            renderedSql: sqlContent,
        });

        rendered.push(FILE_HEADER_TEMPLATE.replace('%FILE%', filepath) + sqlContent);

    }

    // Output results
    const combinedSql = rendered.join('\n\n');

    if (output) {

        const [, writeErr] = await attempt(() => fsWriteFile(output, combinedSql, 'utf-8'));

        if (writeErr) {

            observer.emit('error', {
                source: 'runner',
                error: writeErr,
                context: { output, operation: 'write-preview' },
            });

        }

    }
    else {
        // In a real CLI, this would go to stdout
        // For the core module, we just return the results
    }

    return results;

}

// ─────────────────────────────────────────────────────────────
// Internal Helpers
// ─────────────────────────────────────────────────────────────

/**
 * Internal default options (avoids import cycle with types).
 */
const DEFAULT_RUN_OPTIONS_INTERNAL = {
    force: false,
    concurrency: 1,
    abortOnError: true,
    dryRun: false,
    preview: false,
    output: null as string | null,
};

/**
 * Execute multiple files with tracking.
 *
 * This is the unified execution function used by both runner and change modules.
 * It creates pending records upfront for full batch visibility, then executes
 * files sequentially, updating records as it goes.
 *
 * @param context - Run context
 * @param files - Files to execute (gathered externally)
 * @param runOptions - Execution options (force, dryRun, etc.)
 * @param execOptions - Operation metadata (changeType, operationName, etc.)
 * @returns Batch result with all file results
 */
export async function executeFiles(
    context: RunContext,
    files: FileInput[],
    runOptions: RunOptions,
    execOptions: ExecuteFilesOptions,
): Promise<BatchResult> {

    const start = performance.now();
    const opts = { ...DEFAULT_RUN_OPTIONS_INTERNAL, ...runOptions };

    // Convert FileInput[] to string[] for preview/dryRun modes
    const filepaths = files.map((f) => f.path);

    // Handle preview mode
    if (opts.preview) {

        const results = await preview(context, filepaths, opts.output);
        const durationMs = performance.now() - start;

        return {
            status: results.every((r) => r.status !== 'failed') ? 'success' : 'failed',
            files: results,
            filesRun: 0,
            filesSkipped: 0,
            filesFailed: results.filter((r) => r.status === 'failed').length,
            durationMs,
        };

    }

    // Handle dry run mode - no tracking, just render and write to tmp/
    if (opts.dryRun) {

        const results = await executeDryRun(context, filepaths);
        const durationMs = performance.now() - start;

        return {
            status: results.every((r) => r.status !== 'failed') ? 'success' : 'failed',
            files: results,
            filesRun: results.filter((r) => r.status === 'success').length,
            filesSkipped: 0,
            filesFailed: results.filter((r) => r.status === 'failed').length,
            durationMs,
        };

    }

    // Use provided tracker or create new one
    const tracker = (execOptions.tracker as Tracker) ?? new Tracker(context.db, context.configName);

    // Create operation record
    const [operationId, createErr] = await attempt(() =>
        tracker.createOperation({
            name: execOptions.operationName,
            changeType: execOptions.changeType,
            direction: execOptions.direction,
            configName: context.configName,
            executedBy: formatIdentity(context.identity),
        }),
    );

    if (createErr) {

        observer.emit('error', {
            source: 'runner:create-operation',
            error: createErr,
            context: { operationName: execOptions.operationName },
        });

        return createFailedBatchResult(createErr.message, performance.now() - start);

    }

    // Compute checksums for files that don't have them
    const fileRecords: Array<{ filepath: string; fileType: 'sql' | 'txt'; checksum: string }> = [];

    for (const file of files) {

        let checksum = file.checksum;

        if (!checksum) {

            const [computed, err] = await attempt(() => computeChecksum(file.path));
            checksum = err ? '' : computed;

        }

        fileRecords.push({
            filepath: file.path,
            fileType: file.type,
            checksum,
        });

    }

    // Create ALL file records upfront (pending status)
    // This gives full visibility into the batch before execution starts
    const createRecordsErr = await tracker.createFileRecords(operationId!, fileRecords);

    if (createRecordsErr) {

        observer.emit('error', {
            source: 'runner:create-file-records',
            error: new Error(createRecordsErr),
            context: { operationId: operationId! },
        });

        await tracker.finalizeOperation(operationId!, 'failed', 0, '', createRecordsErr);

        return createFailedBatchResult(createRecordsErr, performance.now() - start);

    }

    // Execute files sequentially (concurrency is typically 1 for DDL safety)
    const results: FileResult[] = [];
    let failed = false;

    for (let i = 0; i < files.length; i++) {

        const file = files[i]!;
        const fileRecord = fileRecords[i]!;

        const result = await executeSingleFileWithUpdate(
            context,
            file.path,
            fileRecord.checksum,
            opts,
            tracker,
            operationId!,
            execOptions.changeType,
        );

        results.push(result);

        // Abort on error if configured
        if (result.status === 'failed' && opts.abortOnError) {

            failed = true;

            // Mark remaining files as skipped
            const skipErr = await tracker.skipRemainingFiles(
                operationId!,
                `Skipped due to failure in ${file.path}`,
            );

            if (skipErr) {

                observer.emit('error', {
                    source: 'runner:skip-remaining',
                    error: new Error(skipErr),
                    context: { operationId: operationId! },
                });

            }

            break;

        }

    }

    // Compute stats
    const filesRun = results.filter((r) => r.status === 'success').length;
    const filesSkipped = results.filter((r) => r.status === 'skipped').length;
    const filesFailed = results.filter((r) => r.status === 'failed').length;
    const durationMs = performance.now() - start;

    // Determine overall status
    let status: BatchStatus = 'success';

    if (filesFailed > 0 || failed) {

        status = filesRun > 0 ? 'partial' : 'failed';

    }

    // Compute combined checksum (or use provided)
    const combinedChecksum =
        execOptions.checksum ?? computeCombinedChecksum(fileRecords.map((f) => f.checksum));

    // Finalize operation (partial failures count as failed)
    // Compute final status AFTER all operations
    const finalStatus = status === 'success' ? 'success' : 'failed';

    const finalizeErr = await tracker.finalizeOperation(
        operationId!,
        finalStatus,
        Math.round(durationMs),
        combinedChecksum,
        failed ? results.find((r) => r.status === 'failed')?.error : undefined,
    );

    if (finalizeErr) {

        observer.emit('error', {
            source: 'runner:finalize',
            error: new Error(finalizeErr),
            context: { operationId: operationId! },
        });

    }

    return {
        status,
        files: results,
        filesRun,
        filesSkipped,
        filesFailed,
        durationMs,
        changeId: operationId,
    };

}

/**
 * Internal wrapper for legacy callers.
 *
 * Converts string[] to FileInput[] and creates ExecuteFilesOptions.
 */
async function executeFilesInternal(
    context: RunContext,
    files: string[],
    options: Required<Omit<RunOptions, 'output'>> & { output: string | null },
    changeType: 'build' | 'run',
): Promise<BatchResult> {

    // Convert string[] to FileInput[]
    const fileInputs: FileInput[] = files.map((f) => ({
        path: f,
        type: 'sql' as const,
    }));

    // Create ExecuteFilesOptions
    const execOptions: ExecuteFilesOptions = {
        changeType,
        direction: 'commit',
        operationName: `${changeType}:${new Date().toISOString()}`,
    };

    return executeFiles(context, fileInputs, options, execOptions);

}

/**
 * Execute a single file with upfront record update.
 *
 * This version uses updateFileExecution (records created upfront)
 * instead of recordExecution (insert on execution).
 *
 * @param context - Run context
 * @param filepath - File to execute
 * @param checksum - Pre-computed checksum
 * @param options - Run options
 * @param tracker - Tracker instance
 * @param operationId - Parent operation ID
 * @param changeType - Type of operation (affects needsRun behavior)
 */
async function executeSingleFileWithUpdate(
    context: RunContext,
    filepath: string,
    checksum: string,
    options: Required<Omit<RunOptions, 'output'>> & { output: string | null },
    tracker: Tracker,
    operationId: number,
    changeType: ChangeType,
): Promise<FileResult> {

    const start = performance.now();

    // Load and render file
    const [sqlContent, loadErr] = await attempt(() => loadAndRenderFile(context, filepath));

    if (loadErr) {

        const durationMs = performance.now() - start;
        const result: FileResult = {
            filepath,
            checksum: checksum || '',
            status: 'failed',
            error: loadErr.message,
            durationMs,
        };

        await tracker.updateFileExecution(
            operationId,
            filepath,
            'failed',
            Math.round(durationMs),
            loadErr.message,
        );

        observer.emit('file:after', {
            filepath,
            status: 'failed',
            durationMs,
            error: loadErr.message,
        });

        return result;

    }

    // Recompute checksum from rendered content for templates
    const [renderedChecksum, checksumErr] = attemptSync(() => computeChecksumFromContent(sqlContent));
    const finalChecksum = checksumErr ? checksum : renderedChecksum;

    observer.emit('file:before', {
        filepath,
        checksum: finalChecksum,
        configName: context.configName,
    });

    // For 'build' and 'run', check if individual file needs to run
    // For 'change', the change-level check was already done by the caller
    if (changeType !== 'change') {

        const needsRunResult = await tracker.needsRun(filepath, finalChecksum, options.force);

        if (!needsRunResult.needsRun) {

            const result: FileResult = {
                filepath,
                checksum: finalChecksum,
                status: 'skipped',
                skipReason: needsRunResult.skipReason,
            };

            await tracker.updateFileExecution(
                operationId,
                filepath,
                'skipped',
                0,
                undefined,
                needsRunResult.skipReason,
            );

            observer.emit('file:skip', {
                filepath,
                reason: needsRunResult.skipReason!,
            });

            return result;

        }

    }

    // Execute SQL
    const [, execErr] = await attempt(() => sql.raw(sqlContent).execute(context.db));

    const durationMs = performance.now() - start;

    if (execErr) {

        const result: FileResult = {
            filepath,
            checksum: finalChecksum,
            status: 'failed',
            error: execErr.message,
            durationMs,
        };

        await tracker.updateFileExecution(
            operationId,
            filepath,
            'failed',
            Math.round(durationMs),
            execErr.message,
        );

        observer.emit('file:after', {
            filepath,
            status: 'failed',
            durationMs,
            error: execErr.message,
        });

        return result;

    }

    // Success
    const result: FileResult = {
        filepath,
        checksum: finalChecksum,
        status: 'success',
        durationMs,
    };

    await tracker.updateFileExecution(
        operationId,
        filepath,
        'success',
        Math.round(durationMs),
    );

    observer.emit('file:after', {
        filepath,
        status: 'success',
        durationMs,
    });

    return result;

}

/**
 * Execute a single file (legacy version for runFile).
 *
 * Uses recordExecution (insert) instead of updateFileExecution.
 */
async function executeSingleFile(
    context: RunContext,
    filepath: string,
    options: Required<Omit<RunOptions, 'output'>> & { output: string | null },
    tracker: Tracker,
    operationId: number,
): Promise<FileResult> {

    const start = performance.now();

    // Load and render file
    // Needed before checksum to support templates
    const [sqlContent, loadErr] = await attempt(() => loadAndRenderFile(context, filepath));

    if (loadErr) {

        const durationMs = performance.now() - start;
        const result: FileResult = {
            filepath,
            checksum: '',
            status: 'failed',
            error: loadErr.message,
            durationMs,
        };

        await tracker.recordExecution({
            changeId: operationId,
            filepath,
            checksum: '',
            status: 'failed',
            errorMessage: loadErr.message,
            durationMs: Math.round(durationMs),
        });

        observer.emit('file:after', {
            filepath,
            status: 'failed',
            durationMs,
            error: loadErr.message,
        });

        return result;

    }

    // Compute checksum
    const [checksum, checksumErr] = attemptSync(() => computeChecksumFromContent(sqlContent));

    if (checksumErr) {

        const result: FileResult = {
            filepath,
            checksum: '',
            status: 'failed',
            error: checksumErr.message,
            durationMs: performance.now() - start,
        };

        await tracker.recordExecution({
            changeId: operationId,
            filepath,
            checksum: '',
            status: 'failed',
            errorMessage: checksumErr.message,
            durationMs: Math.round(result.durationMs ?? 0),
        });

        observer.emit('file:after', {
            filepath,
            status: 'failed',
            durationMs: result.durationMs ?? 0,
            error: checksumErr.message,
        });

        return result;

    }

    observer.emit('file:before', {
        filepath,
        checksum,
        configName: context.configName,
    });

    // Check if file needs to run
    const needsRunResult = await tracker.needsRun(filepath, checksum, options.force);

    if (!needsRunResult.needsRun) {

        const result: FileResult = {
            filepath,
            checksum,
            status: 'skipped',
            skipReason: needsRunResult.skipReason,
        };

        await tracker.recordExecution({
            changeId: operationId,
            filepath,
            checksum,
            status: 'skipped',
            skipReason: needsRunResult.skipReason,
        });

        observer.emit('file:skip', {
            filepath,
            reason: needsRunResult.skipReason!,
        });

        return result;

    }

    // Execute SQL
    const [, execErr] = await attempt(() => sql.raw(sqlContent).execute(context.db));

    const durationMs = performance.now() - start;

    if (execErr) {

        const result: FileResult = {
            filepath,
            checksum,
            status: 'failed',
            error: execErr.message,
            durationMs,
        };

        await tracker.recordExecution({
            changeId: operationId,
            filepath,
            checksum,
            status: 'failed',
            errorMessage: execErr.message,
            durationMs: Math.round(durationMs),
        });

        observer.emit('file:after', {
            filepath,
            status: 'failed',
            durationMs,
            error: execErr.message,
        });

        return result;

    }

    // Success
    const result: FileResult = {
        filepath,
        checksum,
        status: 'success',
        durationMs,
    };

    await tracker.recordExecution({
        changeId: operationId,
        filepath,
        checksum,
        status: 'success',
        durationMs: Math.round(durationMs),
    });

    observer.emit('file:after', {
        filepath,
        status: 'success',
        durationMs,
    });

    return result;

}

/**
 * Load and optionally render a SQL file.
 */
async function loadAndRenderFile(context: RunContext, filepath: string): Promise<string> {

    if (isTemplate(filepath)) {

        const result = await processFile(filepath, {
            projectRoot: context.projectRoot,
            config: context.config,
            secrets: context.secrets,
            globalSecrets: context.globalSecrets,
        });

        return result.sql;

    }

    const [content, err] = await attempt(() => readFile(filepath, 'utf-8'));

    if (err) {

        throw new Error(`Failed to read file: ${filepath}`, { cause: err });

    }

    return content;

}

/**
 * Execute dry run for multiple files.
 *
 * Renders templates and writes to tmp/ without tracking or executing.
 */
async function executeDryRun(context: RunContext, files: string[]): Promise<FileResult[]> {

    const results: FileResult[] = [];

    for (const filepath of files) {

        const start = performance.now();

        // Compute checksum
        const [checksum, checksumErr] = await attempt(() => computeChecksum(filepath));

        if (checksumErr) {

            results.push({
                filepath,
                checksum: '',
                status: 'failed',
                error: checksumErr.message,
                durationMs: performance.now() - start,
            });
            continue;

        }

        // Load and render file
        const [sqlContent, loadErr] = await attempt(() => loadAndRenderFile(context, filepath));

        if (loadErr) {

            results.push({
                filepath,
                checksum,
                status: 'failed',
                error: loadErr.message,
                durationMs: performance.now() - start,
            });
            continue;

        }

        // Write to tmp/
        const [, writeErr] = await attempt(() =>
            writeDryRunOutput(context.projectRoot, filepath, sqlContent),
        );

        const durationMs = performance.now() - start;

        if (writeErr) {

            observer.emit('error', {
                source: 'runner',
                error: writeErr,
                context: { filepath, operation: 'dry-run-write' },
            });

        }

        const outputPath = getDryRunOutputPath(context.projectRoot, filepath);

        observer.emit('file:dry-run', {
            filepath,
            outputPath,
        });

        results.push({
            filepath,
            checksum,
            status: 'success',
            durationMs,
            renderedSql: sqlContent,
        });

    }

    return results;

}

/**
 * Get the output path for a dry run file.
 *
 * Mirrors the source path structure under tmp/, stripping .tmpl extension.
 * Example: sql/views/my_view.sql.tmpl → tmp/sql/views/my_view.sql
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
 * Discover SQL files in a directory recursively.
 *
 * Finds all `.sql` and `.sql.tmpl` files, sorted alphabetically
 * for deterministic execution order.
 *
 * @param dirpath - Directory to scan
 * @returns Sorted array of absolute file paths
 *
 * @example
 * ```typescript
 * const files = await discoverFiles('/project/sql')
 * // ['/project/sql/tables/users.sql', '/project/sql/views/active_users.sql']
 * ```
 */
export async function discoverFiles(dirpath: string): Promise<string[]> {

    const files: string[] = [];

    async function scan(dir: string): Promise<void> {

        const [entries, err] = await attempt(() => readdir(dir, { withFileTypes: true }));

        if (err) {

            throw new Error(`Failed to read directory: ${dir}`, { cause: err });

        }

        for (const entry of entries) {

            const fullPath = path.join(dir, entry.name);

            if (entry.isDirectory()) {

                await scan(fullPath);

            }
            else if (entry.isFile() && isSqlFile(entry.name)) {

                files.push(fullPath);

            }

        }

    }

    await scan(dirpath);

    // Sort alphabetically for deterministic order
    return files.sort();

}

/**
 * Check if a filename is a SQL file.
 */
function isSqlFile(filename: string): boolean {

    return SQL_EXTENSIONS.some((ext) => filename.endsWith(ext));

}

/**
 * Create a failed batch result.
 */
function createFailedBatchResult(error: string, durationMs: number): BatchResult {

    return {
        status: 'failed',
        files: [],
        filesRun: 0,
        filesSkipped: 0,
        filesFailed: 0,
        durationMs,
    };

}
