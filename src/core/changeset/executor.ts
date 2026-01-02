/**
 * Changeset executor.
 *
 * Orchestrates changeset execution by coordinating the parser, history,
 * and runner modules. Handles the full lifecycle from validation to
 * completion.
 *
 * WHY: Changeset execution is complex - it needs to parse files, check
 * status, acquire locks, execute SQL, and track results. The executor
 * centralizes this logic.
 *
 * @example
 * ```typescript
 * import { executeChangeset, revertChangeset } from './executor'
 *
 * // Execute a changeset
 * const result = await executeChangeset(context, changeset, options)
 *
 * // Revert a changeset
 * const revertResult = await revertChangeset(context, changeset, options)
 * ```
 */
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { sql } from 'kysely';

import { attempt, attemptSync } from '@logosdx/utils';

import { observer } from '../observer.js';
import { formatIdentity } from '../identity/resolver.js';
import { processFile, isTemplate } from '../template/index.js';
import { computeChecksum, computeCombinedChecksum } from '../runner/checksum.js';
import { getLockManager } from '../lock/index.js';
import { ChangesetHistory } from './history.js';
import { resolveManifest, validateChangeset, hasRevertFiles } from './parser.js';
import type {
    Changeset,
    ChangesetFile,
    ChangesetContext,
    ChangesetOptions,
    ChangesetResult,
    ChangesetFileResult,
} from './types.js';
import { ChangesetNotAppliedError, ChangesetValidationError } from './types.js';

// ─────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────

const DEFAULT_OPTIONS: Required<Omit<ChangesetOptions, 'output'>> & { output: string | null } = {
    force: false,
    dryRun: false,
    preview: false,
    output: null,
};

// ─────────────────────────────────────────────────────────────
// Execute Changeset (Change Direction)
// ─────────────────────────────────────────────────────────────

/**
 * Execute a changeset (apply changes).
 *
 * @param context - Execution context
 * @param changeset - Changeset to execute
 * @param options - Execution options
 * @returns Execution result
 *
 * @example
 * ```typescript
 * const result = await executeChangeset(context, changeset, {
 *     force: false,
 *     dryRun: false,
 * })
 *
 * if (result.status === 'success') {
 *     console.log('Changeset applied successfully')
 * }
 * ```
 */
export async function executeChangeset(
    context: ChangesetContext,
    changeset: Changeset,
    options: ChangesetOptions = {},
): Promise<ChangesetResult> {

    const start = performance.now();
    const opts = { ...DEFAULT_OPTIONS, ...options };

    // Validate changeset structure
    const [, validateErr] = attemptSync(() => {

        validateChangeset(changeset);

    });

    if (validateErr) {

        observer.emit('error', {
            source: 'changeset',
            error: validateErr,
            context: { name: changeset.name, operation: 'validate' },
        });

        return createFailedResult(changeset.name, 'change', validateErr.message, start);

    }

    // Get files to execute
    const files = changeset.changeFiles;

    if (files.length === 0) {

        throw new ChangesetValidationError(changeset.name, 'No files in change/ folder');

    }

    // Compute checksum
    const [checksums, checksumErr] = await attempt(() =>
        computeFileChecksums(files, context.schemaDir),
    );

    if (checksumErr) {

        return createFailedResult(changeset.name, 'change', checksumErr.message, start);

    }

    const changesetChecksum = computeCombinedChecksum(checksums);

    // Create history tracker
    const history = new ChangesetHistory(context.db, context.configName);

    // Check if needs to run (unless dry run or preview)
    if (!opts.dryRun && !opts.preview) {

        const needsRunResult = await history.needsRun(
            changeset.name,
            changesetChecksum,
            opts.force,
        );

        if (!needsRunResult.needsRun) {

            observer.emit('changeset:skip', {
                name: changeset.name,
                reason: needsRunResult.skipReason ?? 'already applied',
            });

            return {
                name: changeset.name,
                direction: 'change',
                status: 'success',
                files: [],
                durationMs: performance.now() - start,
            };

        }

    }

    // Handle dry run
    if (opts.dryRun) {

        return executeDryRun(context, changeset, files, 'change', start);

    }

    // Handle preview
    if (opts.preview) {

        return executePreview(context, changeset, files, 'change', opts.output, start);

    }

    // Acquire lock
    const lockManager = getLockManager();
    const identity = formatIdentity(context.identity);

    const [, lockErr] = await attempt(() =>
        lockManager.acquire(context.db, context.configName, identity, {
            reason: `Changeset: ${changeset.name}`,
        }),
    );

    if (lockErr) {

        // Lock error is thrown, not returned
        throw lockErr;

    }

    try {

        // Execute files
        const result = await executeFiles(
            context,
            changeset,
            files,
            'change',
            changesetChecksum,
            history,
            start,
        );

        return result;

    }
    finally {

        // Always release lock
        await attempt(() => lockManager.release(context.db, context.configName, identity));

    }

}

// ─────────────────────────────────────────────────────────────
// Revert Changeset
// ─────────────────────────────────────────────────────────────

/**
 * Revert a changeset (apply revert files).
 *
 * @param context - Execution context
 * @param changeset - Changeset to revert
 * @param options - Execution options
 * @returns Execution result
 */
export async function revertChangeset(
    context: ChangesetContext,
    changeset: Changeset,
    options: ChangesetOptions = {},
): Promise<ChangesetResult> {

    const start = performance.now();
    const opts = { ...DEFAULT_OPTIONS, ...options };

    // Check for revert files
    if (!hasRevertFiles(changeset)) {

        throw new ChangesetValidationError(
            changeset.name,
            'No revert files (revert/ folder is empty or missing)',
        );

    }

    const files = changeset.revertFiles;

    // Compute checksum
    const [checksums, checksumErr] = await attempt(() =>
        computeFileChecksums(files, context.schemaDir),
    );

    if (checksumErr) {

        return createFailedResult(changeset.name, 'revert', checksumErr.message, start);

    }

    const revertChecksum = computeCombinedChecksum(checksums);

    // Create history tracker
    const history = new ChangesetHistory(context.db, context.configName);

    // Check if can revert (unless dry run or preview)
    if (!opts.dryRun && !opts.preview) {

        const canRevertResult = await history.canRevert(changeset.name, opts.force);

        if (!canRevertResult.canRevert) {

            if (canRevertResult.reason === 'not applied') {

                throw new ChangesetNotAppliedError(changeset.name);

            }

            observer.emit('changeset:skip', {
                name: changeset.name,
                reason: canRevertResult.reason ?? 'cannot revert',
            });

            return {
                name: changeset.name,
                direction: 'revert',
                status: 'success',
                files: [],
                durationMs: performance.now() - start,
            };

        }

    }

    // Handle dry run
    if (opts.dryRun) {

        return executeDryRun(context, changeset, files, 'revert', start);

    }

    // Handle preview
    if (opts.preview) {

        return executePreview(context, changeset, files, 'revert', opts.output, start);

    }

    // Acquire lock
    const lockManager = getLockManager();
    const identity = formatIdentity(context.identity);

    const [, lockErr] = await attempt(() =>
        lockManager.acquire(context.db, context.configName, identity, {
            reason: `Revert: ${changeset.name}`,
        }),
    );

    if (lockErr) {

        throw lockErr;

    }

    try {

        // Execute files
        const result = await executeFiles(
            context,
            changeset,
            files,
            'revert',
            revertChecksum,
            history,
            start,
        );

        // If successful, mark original as reverted
        if (result.status === 'success') {

            await history.markAsReverted(changeset.name);

        }

        return result;

    }
    finally {

        // Always release lock
        await attempt(() => lockManager.release(context.db, context.configName, identity));

    }

}

// ─────────────────────────────────────────────────────────────
// Internal: Execute Files
// ─────────────────────────────────────────────────────────────

/**
 * Execute files with tracking.
 */
async function executeFiles(
    context: ChangesetContext,
    changeset: Changeset,
    files: ChangesetFile[],
    direction: 'change' | 'revert',
    checksum: string,
    history: ChangesetHistory,
    startTime: number,
): Promise<ChangesetResult> {

    // Expand .txt manifests to actual file list
    const expandedFiles = await expandFiles(files, context.schemaDir);

    // Create operation record
    const [operationId, createErr] = await attempt(() =>
        history.createOperation({
            name: changeset.name,
            direction,
            executedBy: formatIdentity(context.identity),
        }),
    );

    if (createErr) {

        observer.emit('error', {
            source: 'changeset',
            error: createErr,
            context: { name: changeset.name, operation: 'create-operation' },
        });

        return createFailedResult(changeset.name, direction, createErr.message, startTime);

    }

    // Compute checksums for all files
    const fileChecksums = new Map<string, string>();

    for (const file of expandedFiles) {

        const [cs] = await attempt(() => computeChecksum(file.path));
        fileChecksums.set(file.path, cs ?? '');

    }

    // Create pending file records
    await history.createFileRecords(
        operationId,
        expandedFiles.map((f) => ({
            filepath: f.path,
            fileType: f.type,
            checksum: fileChecksums.get(f.path) ?? '',
        })),
    );

    // Emit start event
    observer.emit('changeset:start', {
        name: changeset.name,
        direction,
        files: expandedFiles.map((f) => f.path),
    });

    // Execute each file
    const results: ChangesetFileResult[] = [];
    let failed = false;

    for (let i = 0; i < expandedFiles.length; i++) {

        const file = expandedFiles[i];

        if (!file) continue;

        observer.emit('changeset:file', {
            changeset: changeset.name,
            filepath: file.path,
            index: i,
            total: expandedFiles.length,
        });

        const fileStart = performance.now();

        // Load and render file
        const [sqlContent, loadErr] = await attempt(() => loadAndRenderFile(context, file.path));

        if (loadErr) {

            const durationMs = performance.now() - fileStart;

            results.push({
                filepath: file.path,
                checksum: fileChecksums.get(file.path) ?? '',
                status: 'failed',
                error: loadErr.message,
                durationMs,
            });

            await history.updateFileExecution(
                operationId,
                file.path,
                'failed',
                durationMs,
                loadErr.message,
            );

            failed = true;
            break;

        }

        // Execute SQL
        const [, execErr] = await attempt(() => sql.raw(sqlContent).execute(context.db));

        const durationMs = performance.now() - fileStart;

        if (execErr) {

            results.push({
                filepath: file.path,
                checksum: fileChecksums.get(file.path) ?? '',
                status: 'failed',
                error: execErr.message,
                durationMs,
            });

            await history.updateFileExecution(
                operationId,
                file.path,
                'failed',
                durationMs,
                execErr.message,
            );

            failed = true;
            break;

        }

        // Success
        results.push({
            filepath: file.path,
            checksum: fileChecksums.get(file.path) ?? '',
            status: 'success',
            durationMs,
        });

        await history.updateFileExecution(operationId, file.path, 'success', durationMs);

    }

    // If failed, skip remaining files
    if (failed) {

        await history.skipRemainingFiles(operationId, 'changeset failed');

    }

    // Finalize operation
    const finalStatus = failed ? 'failed' : 'success';
    const totalDurationMs = performance.now() - startTime;

    await history.finalizeOperation(
        operationId,
        finalStatus,
        checksum,
        totalDurationMs,
        failed ? results.find((r) => r.error)?.error : undefined,
    );

    // Emit complete event
    observer.emit('changeset:complete', {
        name: changeset.name,
        direction,
        status: finalStatus,
        durationMs: totalDurationMs,
    });

    return {
        name: changeset.name,
        direction,
        status: finalStatus,
        files: results,
        durationMs: totalDurationMs,
        error: failed ? results.find((r) => r.error)?.error : undefined,
        operationId,
    };

}

// ─────────────────────────────────────────────────────────────
// Internal: Dry Run
// ─────────────────────────────────────────────────────────────

/**
 * Execute dry run mode.
 */
async function executeDryRun(
    context: ChangesetContext,
    changeset: Changeset,
    files: ChangesetFile[],
    direction: 'change' | 'revert',
    startTime: number,
): Promise<ChangesetResult> {

    const { mkdir, writeFile } = await import('node:fs/promises');

    const expandedFiles = await expandFiles(files, context.schemaDir);
    const results: ChangesetFileResult[] = [];

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

        // Write to tmp/
        const outputPath = getDryRunOutputPath(context.projectRoot, file.path);
        const outputDir = path.dirname(outputPath);

        await mkdir(outputDir, { recursive: true });
        await writeFile(outputPath, sqlContent, 'utf-8');

        observer.emit('file:dry-run', {
            filepath: file.path,
            outputPath,
        });

        results.push({
            filepath: file.path,
            checksum: checksum ?? '',
            status: 'success',
            durationMs: performance.now() - fileStart,
            renderedSql: sqlContent,
        });

    }

    return {
        name: changeset.name,
        direction,
        status: results.every((r) => r.status === 'success') ? 'success' : 'failed',
        files: results,
        durationMs: performance.now() - startTime,
    };

}

// ─────────────────────────────────────────────────────────────
// Internal: Preview
// ─────────────────────────────────────────────────────────────

/**
 * Execute preview mode.
 */
async function executePreview(
    context: ChangesetContext,
    changeset: Changeset,
    files: ChangesetFile[],
    direction: 'change' | 'revert',
    output: string | null,
    startTime: number,
): Promise<ChangesetResult> {

    const expandedFiles = await expandFiles(files, context.schemaDir);
    const results: ChangesetFileResult[] = [];
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
        name: changeset.name,
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
async function expandFiles(files: ChangesetFile[], schemaDir: string): Promise<ChangesetFile[]> {

    const expanded: ChangesetFile[] = [];

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
                const resolved = await resolveManifest(file.path, schemaDir);

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
async function computeFileChecksums(files: ChangesetFile[], schemaDir: string): Promise<string[]> {

    const checksums: string[] = [];

    for (const file of files) {

        // Compute checksum of the file itself
        const fileChecksum = await computeChecksum(file.path);
        checksums.push(fileChecksum);

        // For .txt files, also include checksums of referenced files
        if (file.type === 'txt') {

            const resolved = file.resolvedPaths ?? (await resolveManifest(file.path, schemaDir));

            for (const resolvedPath of resolved) {

                const refChecksum = await computeChecksum(resolvedPath);
                checksums.push(refChecksum);

            }

        }

    }

    return checksums;

}

/**
 * Load and optionally render a SQL file.
 */
async function loadAndRenderFile(context: ChangesetContext, filepath: string): Promise<string> {

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
 * Get the output path for a dry run file.
 */
function getDryRunOutputPath(projectRoot: string, filepath: string): string {

    const relativePath = path.relative(projectRoot, filepath);

    const outputRelativePath = relativePath.endsWith('.tmpl')
        ? relativePath.slice(0, -5)
        : relativePath;

    return path.join(projectRoot, 'tmp', outputRelativePath);

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
 * Create a failed result.
 */
function createFailedResult(
    name: string,
    direction: 'change' | 'revert',
    error: string,
    startTime: number,
): ChangesetResult {

    return {
        name,
        direction,
        status: 'failed',
        files: [],
        durationMs: performance.now() - startTime,
        error,
    };

}
