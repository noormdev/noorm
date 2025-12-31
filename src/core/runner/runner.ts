/**
 * SQL file runner.
 *
 * Executes SQL files against a database connection with:
 * - Checksum-based change detection (skip unchanged files)
 * - Template rendering for .sql.tmpl files
 * - Execution tracking in __noorm_changeset__ / __noorm_executions__
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

import { attempt } from '@logosdx/utils';

import { observer } from '../observer.js';
import { processFile, isTemplate } from '../template/index.js';
import { computeChecksum, computeCombinedChecksum } from './checksum.js';
import { Tracker } from './tracker.js';
import type {
    RunOptions,
    RunContext,
    FileResult,
    BatchResult,
    BatchStatus,
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
 * @param schemaPath - Path to schema directory
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
    schemaPath: string,
    options: RunOptions = {},
): Promise<BatchResult> {

    const start = performance.now();
    const opts = { ...DEFAULT_RUN_OPTIONS_INTERNAL, ...options };

    // Discover files
    const [files, discoverErr] = await attempt(() => discoverFiles(schemaPath));

    if (discoverErr) {

        observer.emit('error', {
            source: 'runner',
            error: discoverErr,
            context: { schemaPath, operation: 'discover-files' },
        });

        return createFailedBatchResult(discoverErr.message, performance.now() - start);

    }

    observer.emit('build:start', {
        schemaPath,
        fileCount: files.length,
    });

    // Execute files
    const result = await executeFiles(context, files, opts, 'build');

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
    return executeFiles(context, files, opts, 'run');

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
    return executeFiles(context, files, opts, 'run');

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
 */
async function executeFiles(
    context: RunContext,
    files: string[],
    options: Required<Omit<RunOptions, 'output'>> & { output: string | null },
    changeType: 'build' | 'run',
): Promise<BatchResult> {

    const start = performance.now();

    // Handle preview mode
    if (options.preview) {

        const results = await preview(context, files, options.output);
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
    if (options.dryRun) {

        const results = await executeDryRun(context, files);
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

    // Create tracker and operation
    const tracker = new Tracker(context.db, context.configName);
    const operationName = `${changeType}:${new Date().toISOString()}`;

    const [operationId, createErr] = await attempt(() =>
        tracker.createOperation({
            name: operationName,
            changeType,
            configName: context.configName,
            executedBy: formatIdentity(context.identity),
        }),
    );

    if (createErr) {

        observer.emit('error', {
            source: 'runner',
            error: createErr,
            context: { operation: 'create-operation' },
        });

        return createFailedBatchResult(createErr.message, performance.now() - start);

    }

    // Execute files sequentially (concurrency is typically 1 for DDL safety)
    const results: FileResult[] = [];

    for (const filepath of files) {

        const result = await executeSingleFile(context, filepath, options, tracker, operationId!);
        results.push(result);

        // Abort on error if configured
        if (result.status === 'failed' && options.abortOnError) {

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

    if (filesFailed > 0) {

        status = filesRun > 0 ? 'partial' : 'failed';

    }

    // Compute combined checksum
    const checksums = results.filter((r) => r.checksum).map((r) => r.checksum);
    const combinedChecksum = computeCombinedChecksum(checksums);

    // Finalize operation
    await tracker.finalizeOperation(
        operationId!,
        status === 'failed' ? 'failed' : 'success',
        Math.round(durationMs),
        combinedChecksum,
    );

    return {
        status,
        files: results,
        filesRun,
        filesSkipped,
        filesFailed,
        durationMs,
        changesetId: operationId,
    };

}

/**
 * Execute a single file.
 */
async function executeSingleFile(
    context: RunContext,
    filepath: string,
    options: Required<Omit<RunOptions, 'output'>> & { output: string | null },
    tracker: Tracker,
    operationId: number,
): Promise<FileResult> {

    const start = performance.now();

    // Compute checksum
    const [checksum, checksumErr] = await attempt(() => computeChecksum(filepath));

    if (checksumErr) {

        const result: FileResult = {
            filepath,
            checksum: '',
            status: 'failed',
            error: checksumErr.message,
            durationMs: performance.now() - start,
        };

        await tracker.recordExecution({
            changesetId: operationId,
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
            changesetId: operationId,
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

    observer.emit('file:before', {
        filepath,
        checksum,
        configName: context.configName,
    });

    // Load and render file
    const [sqlContent, loadErr] = await attempt(() => loadAndRenderFile(context, filepath));

    if (loadErr) {

        const durationMs = performance.now() - start;
        const result: FileResult = {
            filepath,
            checksum,
            status: 'failed',
            error: loadErr.message,
            durationMs,
        };

        await tracker.recordExecution({
            changesetId: operationId,
            filepath,
            checksum,
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
            changesetId: operationId,
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
        changesetId: operationId,
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
 * const files = await discoverFiles('/project/schema')
 * // ['/project/schema/tables/users.sql', '/project/schema/views/active_users.sql']
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
 * Format identity for tracking.
 */
function formatIdentity(identity: { name: string; email?: string }): string {

    if (identity.email) {

        return `${identity.name} <${identity.email}>`;

    }

    return identity.name;

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
