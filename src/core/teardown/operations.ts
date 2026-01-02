/**
 * Teardown Operations
 *
 * High-level API for database reset and teardown operations.
 * Uses the explore module for schema introspection and
 * dialect-specific SQL generation for execution.
 */
import { attempt } from '@logosdx/utils';
import { sql } from 'kysely';
import { readFile } from 'fs/promises';
import { join } from 'path';

import type { Kysely } from 'kysely';
import type { Dialect } from '../connection/types.js';
import type {
    TruncateOptions,
    TruncateResult,
    TeardownOptions,
    TeardownResult,
    TeardownPreview,
} from './types.js';
import { NOORM_TABLES, type NoormDatabase } from '../shared/tables.js';
import { fetchList } from '../explore/operations.js';
import { getTeardownOperations } from './dialects/index.js';
import { observer } from '../observer.js';
import { ChangeHistory } from '../change/history.js';

/**
 * Names of all noorm internal tables as strings.
 */
const NOORM_TABLE_NAMES = new Set<string>(Object.values(NOORM_TABLES));

/**
 * Check if a table name is a noorm internal table.
 * Exported for testing purposes.
 */
export function isNoormTable(name: string): boolean {

    return name.startsWith('__noorm_') || NOORM_TABLE_NAMES.has(name);

}

/**
 * Truncate data from tables.
 *
 * Disables FK checks, truncates specified tables, then re-enables FK checks.
 *
 * @param db - Kysely database instance
 * @param dialect - Database dialect
 * @param options - Truncate options
 * @returns Result with truncated/preserved tables and SQL statements
 *
 * @example
 * ```typescript
 * // Truncate all tables except preserved ones
 * const result = await truncateData(db, 'postgres', {
 *     preserve: ['AppSettings', 'UserRoles'],
 * })
 * console.log(`Truncated: ${result.truncated.join(', ')}`)
 *
 * // Dry run to preview
 * const preview = await truncateData(db, 'postgres', {
 *     preserve: ['AppSettings'],
 *     dryRun: true,
 * })
 * console.log('SQL:', preview.statements)
 * ```
 */
export async function truncateData(
    db: Kysely<unknown>,
    dialect: Dialect,
    options: TruncateOptions = {},
): Promise<TruncateResult> {

    const startTime = performance.now();
    const ops = getTeardownOperations(dialect);
    const statements: string[] = [];
    const truncated: string[] = [];
    const preserved: string[] = [];

    observer.emit('teardown:start', { type: 'truncate' });

    // Fetch all tables
    const [tables, err] = await attempt(() => fetchList(db, dialect, 'tables'));

    if (err) {

        observer.emit('teardown:error', { error: err, object: null });
        throw err;

    }

    // Determine which tables to truncate
    const preserveSet = new Set(options.preserve ?? []);

    for (const table of tables) {

        const tableName = table.name;

        // Always preserve noorm tables
        if (isNoormTable(tableName)) {

            preserved.push(tableName);
            continue;

        }

        // Check if table should be preserved
        if (preserveSet.has(tableName)) {

            preserved.push(tableName);
            continue;

        }

        // If 'only' is specified, check if table is in the list
        if (options.only && !options.only.includes(tableName)) {

            preserved.push(tableName);
            continue;

        }

        truncated.push(tableName);

    }

    // Build SQL statements
    statements.push(ops.disableForeignKeyChecks());

    for (const tableName of truncated) {

        statements.push(ops.truncateTable(tableName, undefined, options.restartIdentity ?? false));

    }

    statements.push(ops.enableForeignKeyChecks());

    // Execute unless dry run
    if (!options.dryRun) {

        for (const stmt of statements) {

            // Skip comments
            if (stmt.startsWith('--')) continue;

            // Handle multi-statement strings (e.g., SQLite truncate returns two statements)
            const subStatements = stmt.includes('; ')
                ? stmt.split('; ').map(s => s.trim()).filter(s => s.length > 0)
                : [stmt];

            for (const subStmt of subStatements) {

                observer.emit('teardown:progress', {
                    category: 'tables',
                    object: subStmt.includes('DELETE') || subStmt.includes('TRUNCATE') ? subStmt : null,
                    action: 'truncating',
                });

                const [, execErr] = await attempt(() => sql.raw(subStmt).execute(db));

                if (execErr) {

                    observer.emit('teardown:error', { error: execErr, object: subStmt });
                    throw execErr;

                }

            }

        }

    }

    const durationMs = Math.round(performance.now() - startTime);

    const result: TruncateResult = {
        truncated,
        preserved,
        statements,
        durationMs,
    };

    observer.emit('teardown:complete', { result });

    return result;

}

/**
 * Drop all user-created database objects.
 *
 * Preserves noorm internal tables (__noorm_*) and optionally other objects.
 * Order: FK constraints → Tables → Views → Functions → Types
 *
 * @param db - Kysely database instance
 * @param dialect - Database dialect
 * @param options - Teardown options
 * @returns Result with dropped/preserved objects and SQL statements
 *
 * @example
 * ```typescript
 * // Preview what would be dropped
 * const preview = await teardownSchema(db, 'postgres', { dryRun: true })
 * console.log('Tables to drop:', preview.dropped.tables)
 *
 * // Execute teardown
 * const result = await teardownSchema(db, 'postgres', {
 *     keepTypes: true,  // Keep enum types
 *     postScript: 'sql/teardown/cleanup.sql',
 * })
 * ```
 */
export async function teardownSchema(
    db: Kysely<unknown>,
    dialect: Dialect,
    options: TeardownOptions = {},
): Promise<TeardownResult> {

    const startTime = performance.now();
    const ops = getTeardownOperations(dialect);
    const statements: string[] = [];
    const preserved: string[] = [];
    const dropped: TeardownResult['dropped'] = {
        tables: [],
        views: [],
        functions: [],
        types: [],
        foreignKeys: [],
    };

    observer.emit('teardown:start', { type: 'schema' });

    const preserveSet = new Set(options.preserveTables ?? []);

    // Fetch all objects in parallel
    const [
        [tables, tablesErr],
        [views, viewsErr],
        [functions, functionsErr],
        [types, typesErr],
        [foreignKeys, fksErr],
    ] = await Promise.all([
        attempt(() => fetchList(db, dialect, 'tables')),
        attempt(() => fetchList(db, dialect, 'views')),
        attempt(() => fetchList(db, dialect, 'functions')),
        attempt(() => fetchList(db, dialect, 'types')),
        attempt(() => fetchList(db, dialect, 'foreignKeys')),
    ]);

    if (tablesErr) throw tablesErr;
    if (viewsErr) throw viewsErr;
    if (functionsErr) throw functionsErr;
    if (typesErr) throw typesErr;
    if (fksErr) throw fksErr;

    // 1. Drop FK constraints first (must happen before tables)
    for (const fk of foreignKeys) {

        const tableName = fk.tableName;

        // Skip noorm tables
        if (isNoormTable(tableName)) continue;

        // Skip preserved tables
        if (preserveSet.has(tableName)) continue;

        dropped.foreignKeys.push(fk.name);
        statements.push(ops.dropForeignKey(fk.name, tableName, fk.schema));

    }

    // 2. Drop views (unless keepViews)
    if (!options.keepViews) {

        for (const view of views) {

            dropped.views.push(view.name);
            statements.push(ops.dropView(view.name, view.schema));

        }

    }

    // 3. Drop tables
    for (const table of tables) {

        const tableName = table.name;

        // Always preserve noorm tables
        if (isNoormTable(tableName)) {

            preserved.push(tableName);
            continue;

        }

        // Skip preserved tables
        if (preserveSet.has(tableName)) {

            preserved.push(tableName);
            continue;

        }

        dropped.tables.push(tableName);
        statements.push(ops.dropTable(tableName, table.schema));

    }

    // 4. Drop functions/procedures (unless keepFunctions)
    if (!options.keepFunctions) {

        for (const fn of functions) {

            dropped.functions.push(fn.name);
            statements.push(ops.dropFunction(fn.name, fn.schema));

        }

    }

    // 5. Drop types (unless keepTypes)
    if (!options.keepTypes) {

        for (const type of types) {

            dropped.types.push(type.name);
            statements.push(ops.dropType(type.name, type.schema));

        }

    }

    // Execute unless dry run
    if (!options.dryRun) {

        for (const stmt of statements) {

            // Skip comments
            if (stmt.startsWith('--')) continue;

            observer.emit('teardown:progress', {
                category: 'tables',
                object: stmt,
                action: 'dropping',
            });

            const [, execErr] = await attempt(() => sql.raw(stmt).execute(db));

            if (execErr) {

                observer.emit('teardown:error', { error: execErr, object: stmt });
                throw execErr;

            }

        }

    }

    const durationMs = Math.round(performance.now() - startTime);

    const result: TeardownResult = {
        dropped,
        preserved,
        statements,
        durationMs,
    };

    // Execute post-script if provided
    if (options.postScript && !options.dryRun) {

        const postScriptResult = await executePostScript(db, options.postScript);
        result.postScriptResult = postScriptResult;

    }

    // Mark changes as stale and record reset if config provided
    if (options.configName && options.executedBy && !options.dryRun) {

        const history = new ChangeHistory(
            db as Kysely<NoormDatabase>,
            options.configName,
        );

        // Mark all successful changes as stale
        result.staleCount = await history.markAllAsStale();

        // Record the reset event
        result.resetRecordId = await history.recordReset(
            options.executedBy,
            `Schema teardown: dropped ${dropped.tables.length} tables, ${dropped.views.length} views`,
        );

    }

    observer.emit('teardown:complete', { result });

    return result;

}

/**
 * Preview what would be affected by a teardown operation.
 *
 * @param db - Kysely database instance
 * @param dialect - Database dialect
 * @param options - Teardown options
 * @returns Preview of what would be dropped/preserved
 */
export async function previewTeardown(
    db: Kysely<unknown>,
    dialect: Dialect,
    options: TeardownOptions = {},
): Promise<TeardownPreview> {

    // Just run with dryRun: true and convert the result
    const result = await teardownSchema(db, dialect, { ...options, dryRun: true });

    return {
        toDrop: result.dropped,
        toPreserve: result.preserved,
        statements: result.statements,
    };

}

/**
 * Execute a post-teardown SQL script.
 */
async function executePostScript(
    db: Kysely<unknown>,
    scriptPath: string,
): Promise<{ executed: boolean; error?: string }> {

    const fullPath = join(process.cwd(), scriptPath);

    const [content, readErr] = await attempt(() => readFile(fullPath, 'utf-8'));

    if (readErr) {

        return { executed: false, error: `Failed to read script: ${readErr.message}` };

    }

    // Split by semicolons and execute each statement
    const stmts = content
        .split(';')
        .map(s => s.trim())
        .filter(s => s.length > 0 && !s.startsWith('--'));

    for (const stmt of stmts) {

        const [, execErr] = await attempt(() => sql.raw(stmt).execute(db));

        if (execErr) {

            return { executed: false, error: `Script failed: ${execErr.message}` };

        }

    }

    return { executed: true };

}
