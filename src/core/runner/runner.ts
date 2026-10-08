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

import { attempt } from '@logosdx/utils';

import { observer } from '../observer.js';
import { formatIdentity } from '../identity/resolver.js';
import { processFile, isTemplate } from '../template/index.js';
import { assertPolicy } from '../policy/index.js';
import type { Permission } from '../policy/index.js';
import { computeChecksum, computeChecksumFromContent, computeCombinedChecksum } from './checksum.js';
import { executeSqlBody } from './mssql-batches.js';
import { StatementWatcher } from './statement-watcher.js';
import { Tracker, decideNeedsRun } from './tracker.js';
import { getSqlErrorMessage } from '../shared/index.js';
import { OperationAbortedError } from '../shared/abort.js';
import type { NoormDatabase } from '../shared/index.js';
import type {
    RunOptions,
    RunContext,
    FileResult,
    BatchResult,
    BatchStatus,
    FileInput,
    ExecuteFilesOptions,
    FilesStatusResult,
    FileStatusResult,
    FileStatusCategory,
    NeedsRunResult,
    SkipReason,
} from './types.js';

// ─────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────

const SQL_EXTENSIONS = ['.sql', '.sql.tmpl'];

const FILE_HEADER_TEMPLATE = `-- ============================================================
-- File: %FILE%
-- ============================================================

`;

/**
 * Gate a run entrypoint against the config's access policy.
 *
 * The single enforcement seam for `runBuild`/`runFile`/`runDir`/`runFiles`:
 * every caller (SDK, TUI, CLI) funnels through one of these functions, so
 * gating here — rather than per-caller — closes the surface uniformly.
 * Run files are command-gated, not content-classified.
 *
 * @throws Error carrying the policy's blockedReason when the channel's
 * role denies the permission.
 */
function assertRunPolicy(context: RunContext, permission: Permission): void {

    assertPolicy(context.channel, { name: context.configName, access: context.access }, permission);

}

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
 * @param preFilteredFiles - Optional pre-filtered file list to skip discovery
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
    preFilteredFiles?: string[],
): Promise<BatchResult> {

    assertRunPolicy(context, 'run:build');

    const start = performance.now();
    const opts = { ...DEFAULT_RUN_OPTIONS_INTERNAL, ...options };

    // Use pre-filtered files or discover from directory
    let files: string[];

    if (preFilteredFiles) {

        files = preFilteredFiles;

    }
    else {

        const [discovered, discoverErr] = await attempt(() => discoverFiles(sqlPath));

        if (discoverErr) {

            observer.emit('error', {
                source: 'runner',
                error: discoverErr,
                context: { sqlPath, operation: 'discover-files' },
            });

            return createFailedBatchResult(
                `${discoverErr.message} (${sqlPath})`,
                performance.now() - start,
            );

        }

        files = discovered;

    }

    observer.emit('build:start', {
        sqlPath,
        fileCount: files.length,
    });

    // Execute files
    const result = await executeFilesInternal(context, files, opts, 'build', sqlPath);

    observer.emit('build:complete', {
        status: result.status,
        filesRun: result.filesRun,
        filesSkipped: result.filesSkipped,
        filesFailed: result.filesFailed,
        durationMs: result.durationMs,
        error: result.error,
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

    assertRunPolicy(context, 'run:file');

    observer.emit('run:file', {
        filepath,
        configName: context.configName,
    });

    const batch = await executeFiles(context, [{ path: filepath, type: 'sql' }], options, {
        changeType: 'run',
        operationName: `run:${new Date().toISOString()}`,
    });

    return batch.files[0] ?? {
        filepath,
        checksum: '',
        status: batch.error === RUN_CANCELLED ? 'skipped' : 'failed',
        error: batch.error,
    };

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

    assertRunPolicy(context, 'run:dir');

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

        return createFailedBatchResult(
            `${discoverErr.message} (${dirpath})`,
            performance.now() - start,
        );

    }

    observer.emit('run:dir', {
        dirpath,
        fileCount: files.length,
        configName: context.configName,
    });

    // Execute files
    return executeFilesInternal(context, files, opts, 'run', dirpath);

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

    assertRunPolicy(context, 'run:dir');

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
 * "Without executing" describes the *SQL*, not the render: producing the
 * output resolves every secret tier into plaintext and runs whatever
 * `$helpers` and referenced side-car scripts the template pulls in. Gated
 * on `run:file` so the role denied every `run:*` permission cannot reach
 * either. `run:file` is the closest existing cell — a dedicated
 * `run:preview` row (viewer deny, operator/admin allow) belongs in the
 * matrix so a read-only path stops inheriting `run:file`'s confirm
 * semantics.
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

    assertRunPolicy(context, 'run:file');

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
// File Status Check (Pre-execution)
// ─────────────────────────────────────────────────────────────

/**
 * Check status of files before execution.
 *
 * Determines which files are new, previously run, changed, or failed
 * without actually executing them. Useful for showing confirmation
 * dialogs before re-running files.
 *
 * @param context - Run context (db, configName required)
 * @param files - File paths to check
 * @returns Categorized file statuses
 *
 * @example
 * ```typescript
 * const status = await checkFilesStatus(context, ['/sql/seed.sql'])
 *
 * if (status.previouslyRunFiles.length > 0) {
 *     // Show confirmation dialog
 *     console.log(`${status.previouslyRunFiles.length} file(s) were previously run`)
 * }
 * ```
 */
export async function checkFilesStatus(
    context: RunContext,
    files: string[],
): Promise<FilesStatusResult> {

    // Renders every file to compute its checksum, so it carries the same
    // secret-resolution and script-execution exposure as `preview`.
    assertRunPolicy(context, 'run:file');

    const tracker = new Tracker(context.db, context.configName, context.dialect ?? 'postgres');
    const prepared = await prepareFiles(context, files.map((filepath): FileInput => ({ path: filepath, type: 'sql' })));
    const [latest, latestErr] = await tracker.latestExecutions();

    const results = prepared.map((entry): FileStatusResult => {

        if (entry.loadError) {

            return { filepath: entry.file.path, checksum: '', category: 'new', wouldSkip: false };

        }

        const decision = decideNeedsRun(latestErr ?? latest.get(entry.relFilepath), entry.checksum, false);

        return {
            filepath: entry.file.path,
            checksum: entry.checksum,
            category: statusCategory(decision),
            wouldSkip: !decision.needsRun,
        };

    });

    // Categorize results
    const newFiles = results.filter((r) => r.category === 'new').map((r) => r.filepath);
    const previouslyRunFiles = results.filter((r) => r.category === 'previously-run').map((r) => r.filepath);
    const changedFiles = results.filter((r) => r.category === 'changed').map((r) => r.filepath);
    const failedFiles = results.filter((r) => r.category === 'failed').map((r) => r.filepath);
    const wouldSkipCount = results.filter((r) => r.wouldSkip).length;

    return {
        files: results,
        newFiles,
        previouslyRunFiles,
        changedFiles,
        failedFiles,
        wouldSkipCount,
    };

}

/** Stale and error reasons have no category of their own, so they read as new. */
function statusCategory(decision: NeedsRunResult): FileStatusCategory {

    if (!decision.needsRun) return 'previously-run';

    if (decision.reason === 'changed' || decision.reason === 'failed') return decision.reason;

    return 'new';

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

/** Error and skip reason for a run stopped by `context.signal`. */
const RUN_CANCELLED = 'Run cancelled';

function createWatcher(context: RunContext): StatementWatcher<NoormDatabase> {

    return new StatementWatcher(context.db, {
        dialect: context.dialect ?? 'postgres',
        signal: context.signal,
    });

}

/** Returned by `runWatched` when the run was cancelled before the file's SQL was sent. */
const NOT_STARTED = Symbol('not-started');

/**
 * Execute a file's SQL through the watcher.
 *
 * The connection checkout sits outside `executeSqlBody`'s own error handling,
 * so its failure is turned into the file's error here rather than escaping the
 * batch unfinalized. A file the watcher refused to start is not a failure.
 */
async function runWatched(
    context: RunContext,
    watcher: StatementWatcher<NoormDatabase>,
    filepath: string,
    sqlContent: string,
): Promise<string | null | typeof NOT_STARTED> {

    const [execErrMsg, err] = await attempt(() =>
        watcher.run(filepath, context.db, (conn) => executeSqlBody({ ...context, db: conn }, sqlContent)),
    );

    if (err instanceof OperationAbortedError) return NOT_STARTED;

    return err ? getSqlErrorMessage(err) : execErrMsg;

}

async function skipRemaining(tracker: Tracker, operationId: number, reason: string): Promise<void> {

    const skipErr = await tracker.skipRemainingFiles(operationId, reason.slice(0, 100));

    if (skipErr) {

        observer.emit('error', {
            source: 'runner:skip-remaining',
            error: new Error(skipErr),
            context: { operationId },
        });

    }

}

/**
 * Execute multiple files with tracking.
 *
 * Every file is rendered and hashed once, then a single history prefetch
 * decides skip-or-run for the whole batch before any tracking write, so a
 * skipped file costs no round trip and leaves no row. The operation and its
 * pending rows exist only when something runs. `change` callers decide per
 * change, so the per-file gate does not apply.
 *
 * @param context - Run context
 * @param files - Files to execute (gathered externally)
 * @param runOptions - Execution options (force, dryRun, etc.)
 * @param execOptions - Operation metadata (changeType, operationName, etc.)
 * @returns Batch result with all file results; no `changeId` when every file skipped
 *
 * @example
 * ```typescript
 * const result = await executeFiles(context, [{ path: '/project/sql/001.sql', type: 'sql' }], {}, {
 *     changeType: 'run',
 *     operationName: `run:${new Date().toISOString()}`,
 * })
 * ```
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

    // A duplicate filepath would make updateFileExecution's
    // WHERE change_id = ? AND filepath = ? match more than one row later
    // in this same operation -- silently updating N records instead of
    // failing. Uniqueness of the discovered batch is an invariant this
    // function depends on, not something that happens to hold today.
    const duplicateFilepaths = findDuplicates(filepaths);

    if (duplicateFilepaths.length > 0) {

        const error = `Duplicate files in execution batch: ${duplicateFilepaths.join(', ')}`;

        observer.emit('error', {
            source: 'runner:duplicate-files',
            error: new Error(error),
            context: { duplicates: duplicateFilepaths },
        });

        return createFailedBatchResult(error, performance.now() - start);

    }

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
    const tracker = (execOptions.tracker as Tracker) ?? new Tracker(context.db, context.configName, context.dialect ?? 'postgres');
    const isChange = execOptions.changeType === 'change';

    const prepared = await prepareFiles(context, files);
    const gated: GatedFile[] = isChange ? prepared : await applyRunGate(tracker, prepared, opts.force);

    if (!isChange && gated.every((entry): entry is SkippedFile => entry.skipReason !== undefined)) {

        return {
            status: 'success',
            files: gated.map(skipFile),
            filesRun: 0,
            filesSkipped: gated.length,
            filesFailed: 0,
            durationMs: performance.now() - start,
        };

    }

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
            context: { operationName: execOptions.operationName, sqlPath: execOptions.sqlPath },
        });

        return createFailedBatchResult(
            formatErrorChain(createErr),
            performance.now() - start,
        );

    }

    const runSet = gated.filter((entry) => !entry.skipReason);
    const createRecordsErr = await tracker.createFileRecords(
        operationId!,
        runSet.map((entry) => ({ filepath: entry.relFilepath, fileType: entry.file.type, checksum: entry.checksum })),
    );

    if (createRecordsErr) {

        observer.emit('error', {
            source: 'runner:create-file-records',
            error: new Error(createRecordsErr),
            context: { operationId: operationId! },
        });

        await tracker.finalizeOperation(operationId!, 'failed', 0, '', createRecordsErr);

        return createFailedBatchResult(
            createRecordsErr,
            performance.now() - start,
        );

    }

    // Execute files sequentially (concurrency is typically 1 for DDL safety)
    const results: FileResult[] = [];
    let failed = false;
    let cancelled = false;
    const watcher = createWatcher(context);
    const lastRunIndex = gated.map((entry) => !entry.skipReason).lastIndexOf(true);

    try {

        for (let i = 0; i < gated.length; i++) {

            const entry = gated[i]!;

            if (entry.skipReason) {

                results.push(skipFile(entry));
                continue;

            }

            if (context.signal?.aborted) {

                failed = true;
                cancelled = true;
                await skipRemaining(tracker, operationId!, RUN_CANCELLED);

                break;

            }

            const result = await executeSingleFileWithUpdate(context, entry, tracker, operationId!, watcher);

            // Refused before its SQL was sent: its pending row is skipped with the rest.
            if (!result) {

                failed = true;
                cancelled = true;
                await skipRemaining(tracker, operationId!, RUN_CANCELLED);

                break;

            }

            results.push(result);

            // The last file that runs finished despite the abort (mssql, sqlite, or a missed
            // cancel), and every file after it is a skip, so nothing was cut short.
            cancelled = (context.signal?.aborted ?? false)
                && (i < lastRunIndex || result.status === 'failed');

            if (cancelled || (result.status === 'failed' && opts.abortOnError)) {

                failed = true;

                await skipRemaining(
                    tracker,
                    operationId!,
                    cancelled ? RUN_CANCELLED : `Skipped: failure in ${path.basename(entry.file.path)}`,
                );

                break;

            }

        }

    }
    finally {

        await watcher.close();

    }

    // One result per file holds only for a full pass: after a cancel or abortOnError
    // break, later gate-skipped files are not in results and have no row.
    if (!failed && results.length !== files.length) {

        throw new Error(
            `Execution accounting mismatch: expected ${files.length} results, got ${results.length}`,
        );

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
        execOptions.checksum ?? computeCombinedChecksum(gated.map((entry) => entry.checksum));

    // Finalize operation (partial failures count as failed)
    // Compute final status AFTER all operations
    const finalStatus = status === 'success' ? 'success' : 'failed';

    const finalizeErr = await tracker.finalizeOperation(
        operationId!,
        finalStatus,
        Math.round(durationMs),
        combinedChecksum,
        cancelled ? RUN_CANCELLED : failed ? results.find((r) => r.status === 'failed')?.error : undefined,
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
        error: cancelled ? RUN_CANCELLED : undefined,
    };

}

interface PreparedFile {
    file: FileInput;
    relFilepath: string;
    checksum: string;
    sql: string;
    loadError?: Error;
}

type SkippedFile = PreparedFile & { skipReason: SkipReason };
type GatedFile = (PreparedFile & { skipReason?: undefined }) | SkippedFile;

/** Renders each file once: the gate keys a template on its rendered output, and execution reuses the render. */
async function prepareFiles(context: RunContext, files: FileInput[]): Promise<PreparedFile[]> {

    const prepared: PreparedFile[] = [];

    for (const file of files) {

        const relFilepath = path.relative(context.projectRoot, file.path);
        const [loaded, loadError] = await attempt(async () => {

            const sql = await loadAndRenderFile(context, file.path);

            return { sql, checksum: computeChecksumFromContent(sql) };

        });

        if (loadError) {

            prepared.push({ file, relFilepath, checksum: '', sql: '', loadError });
            continue;

        }

        prepared.push({ file, relFilepath, ...loaded });

    }

    return prepared;

}

/** A file that failed to load never skips, so its error surfaces at its turn in the walk. */
async function applyRunGate(tracker: Tracker, prepared: PreparedFile[], force: boolean): Promise<GatedFile[]> {

    if (force) return prepared;

    const [latest, latestErr] = await tracker.latestExecutions();

    return prepared.map((entry) => {

        if (entry.loadError) return entry;

        const decision = decideNeedsRun(latestErr ?? latest.get(entry.relFilepath), entry.checksum, false);

        return decision.skipReason ? { ...entry, skipReason: decision.skipReason } : entry;

    });

}

/** Deliberately writes nothing: a skipped file leaves no tracking row. */
function skipFile(entry: SkippedFile): FileResult {

    observer.emit('file:skip', {
        filepath: entry.file.path,
        reason: entry.skipReason,
    });

    return {
        filepath: entry.file.path,
        checksum: entry.checksum,
        status: 'skipped',
        skipReason: entry.skipReason,
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
    sqlPath?: string,
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
        sqlPath,
    };

    return executeFiles(context, fileInputs, options, execOptions);

}

/**
 * Execute one run-set file's pre-rendered SQL and update its pending row.
 *
 * @param context - Run context
 * @param entry - Prepared file carrying its rendered SQL or load error
 * @param tracker - Tracker instance
 * @param operationId - Parent operation ID
 * @param watcher - Statement watcher the SQL runs through
 * @returns null when the run was cancelled before the file's SQL was sent
 */
async function executeSingleFileWithUpdate(
    context: RunContext,
    entry: PreparedFile,
    tracker: Tracker,
    operationId: number,
    watcher: StatementWatcher<NoormDatabase>,
): Promise<FileResult | null> {

    const start = performance.now();
    const { file: { path: filepath }, relFilepath, checksum } = entry;

    if (entry.loadError) {

        const durationMs = performance.now() - start;
        const result: FileResult = {
            filepath,
            checksum,
            status: 'failed',
            error: entry.loadError.message,
            durationMs,
        };

        await tracker.updateFileExecution(
            operationId,
            relFilepath,
            'failed',
            Math.round(durationMs),
            entry.loadError.message,
        );

        observer.emit('file:after', {
            filepath,
            status: 'failed',
            durationMs,
            error: entry.loadError.message,
        });

        return result;

    }

    observer.emit('file:before', {
        filepath,
        checksum,
        configName: context.configName,
    });

    // Execute SQL (MSSQL splits on `GO` batches; other dialects run as one)
    const execErrMsg = await runWatched(context, watcher, filepath, entry.sql);

    if (execErrMsg === NOT_STARTED) return null;

    const durationMs = performance.now() - start;

    if (execErrMsg) {

        const error = execErrMsg + (await describePriorSuccesses(tracker, relFilepath, operationId));

        const result: FileResult = {
            filepath,
            checksum,
            status: 'failed',
            error,
            durationMs,
        };

        await tracker.updateFileExecution(
            operationId,
            relFilepath,
            'failed',
            Math.round(durationMs),
            error,
        );

        observer.emit('file:after', {
            filepath,
            status: 'failed',
            durationMs,
            error,
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

    await tracker.updateFileExecution(
        operationId,
        relFilepath,
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

            observer.emit('file:dry-run', {
                filepath,
                status: 'failed',
                error: checksumErr.message,
            });

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

            observer.emit('file:dry-run', {
                filepath,
                status: 'failed',
                error: loadErr.message,
            });

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
            status: 'success',
            outputPath,
        });

        results.push({
            filepath,
            checksum,
            status: 'success',
            durationMs,
            renderedSql: sqlContent,
            outputPath,
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
 *
 * Owner-only permissions on both the file and any directory created for
 * it: the rendered output contains every secret the template resolved, in
 * plaintext, and `noorm init` does not gitignore `tmp/`. Nothing about a
 * dry run should be more readable than `.noorm/state/state.enc`.
 */
async function writeDryRunOutput(
    projectRoot: string,
    filepath: string,
    content: string,
): Promise<void> {

    const outputPath = getDryRunOutputPath(projectRoot, filepath);

    // Ensure directory exists
    const outputDir = path.dirname(outputPath);
    await mkdir(outputDir, { recursive: true, mode: 0o700 });

    // Write file
    await fsWriteFile(outputPath, content, { encoding: 'utf-8', mode: 0o600 });

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
        error,
    };

}

/**
 * Format an error with its cause chain into a single string.
 */
function formatErrorChain(err: Error): string {

    const parts = [err.message];

    let current = err.cause;

    while (current instanceof Error) {

        parts.push(current.message);
        current = current.cause;

    }

    return parts.join(': ');

}

/**
 * Find values that occur more than once, without depending on discovery
 * order. Used to reject a duplicate discovered file loudly rather than let
 * it silently update the same execution record twice.
 */
function findDuplicates(values: string[]): string[] {

    const seen = new Set<string>();
    const duplicates = new Set<string>();

    for (const value of values) {

        if (seen.has(value)) duplicates.add(value);
        seen.add(value);

    }

    return [...duplicates];

}

/**
 * Build a suffix describing prior successful executions of a file, for
 * appending to a failure message.
 *
 * @example
 * ```typescript
 * const error = execErrMsg + await describePriorSuccesses(tracker, relFilepath, operationId)
 * // "already exists; 1 prior successful execution (build:2026-07-24T…, operation 7)"
 * ```
 */
async function describePriorSuccesses(
    tracker: Tracker,
    relFilepath: string,
    excludeOperationId: number,
): Promise<string> {

    const prior = await tracker.priorSuccessfulExecutions(relFilepath, excludeOperationId);

    if (prior.length === 0) return '';

    const [latest] = prior;
    const plural = prior.length === 1 ? '' : 's';

    return `; ${prior.length} prior successful execution${plural} (${latest!.operationName}, operation ${latest!.operationId})`;

}

