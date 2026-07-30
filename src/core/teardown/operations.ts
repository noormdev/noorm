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
    TeardownTableRef,
} from './types.js';
import type { NoormDatabase } from '../shared/tables.js';
import { fetchList } from '../explore/operations.js';
import { getTeardownOperations } from './dialects/index.js';
import { observer } from '../observer.js';
import { assertDbPolicy } from '../db/policy.js';
import { ChangeHistory, ChangeTracker } from '../change/index.js';

/**
 * Schema each dialect resolves an unqualified name against.
 *
 * MySQL's "schema" is the database itself and SQLite has none, so neither
 * appears here — an object in those dialects is never reported qualified.
 */
const DEFAULT_SCHEMAS: Partial<Record<Dialect, string>> = {
    postgres: 'public',
    mssql: 'dbo',
};

/**
 * The name to report for an object.
 *
 * Qualified whenever the object sits outside the dialect's default schema.
 * Teardown enumerates every non-system schema, so a bare `secrets` in a
 * dry-run is indistinguishable from `public.secrets` — an operator reading
 * the preview cannot tell that a schema noorm never created is about to be
 * dropped. Execution has always qualified correctly; only the report was lossy.
 */
function displayName(name: string, schema: string | undefined, dialect: Dialect): string {

    const defaultSchema = DEFAULT_SCHEMAS[dialect];

    if (!schema || !defaultSchema || schema === defaultSchema) return name;

    return `${schema}.${name}`;

}

/**
 * Check if a table name is a noorm internal table.
 * Exported for testing purposes.
 */
export function isNoormTable(name: string | undefined | null): boolean {

    if (!name) return false;

    // Prefixed names (sqlite/mysql) — always safe to match
    if (name.startsWith('__noorm_')) return true;

    return false;

}

/**
 * Append a dialect FK-toggle result to a statements buffer.
 *
 * `disableForeignKeyChecks` / `enableForeignKeyChecks` return either a
 * single statement (PG/MySQL/SQLite session toggles) or a list of per-table
 * statements (MSSQL, to avoid the sp_MSforeachtable deadlock). Both shapes
 * land in the same flat array so downstream execution stays uniform.
 */
function pushFlat(out: string[], value: string | string[]): void {

    if (Array.isArray(value)) {

        out.push(...value);

        return;

    }

    out.push(value);

}

/**
 * Execute a group of teardown SQL statements against `db`.
 *
 * Shared by every phase (disable/truncate/enable): skips comment-only
 * entries, splits `'; '`-joined compound statements (e.g. MSSQL's
 * DELETE + DBCC CHECKIDENT reseed), and emits `teardown:progress` /
 * `teardown:error` exactly as the old inline loop did.
 *
 * `continueOnError` encodes the two failure policies the FK re-enable
 * guarantee needs: the disable/truncate phase stops at the first
 * failure (pre-fix throw-on-first-failure semantics, preserved here as
 * "stop and let the caller decide what to do next"), while the
 * enable-FK phase must attempt every statement even after a failure —
 * one MSSQL table's re-enable failing must not skip the other tables'
 * re-enable. Either way the first error encountered is returned rather
 * than thrown, so the caller can run both phases before deciding what
 * to surface.
 */
async function executeStatements(
    db: Kysely<unknown>,
    statements: string[],
    continueOnError: boolean,
): Promise<Error | null> {

    let firstError: Error | null = null;

    for (const stmt of statements) {

        if (stmt.startsWith('--')) continue;

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

                firstError = firstError ?? execErr;

                if (!continueOnError) return firstError;

            }

        }

    }

    return firstError;

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

    assertDbPolicy(options.policy, 'db:truncate', 'wipe data', options.dryRun);

    observer.emit('teardown:start', { type: 'truncate' });

    // Fetch all tables (including noorm tables so we can preserve them)
    const [tables, err] = await attempt(() => fetchList(db, dialect, 'tables', { includeNoormTables: true }));

    if (err) {

        observer.emit('teardown:error', { error: err, object: null });
        throw err;

    }

    // Determine which tables to truncate. Both halves of each name are kept:
    // preserve/only match on the bare name the user wrote, while the SQL and
    // the report need the schema.
    const preserveSet = new Set(options.preserve ?? []);
    const targets: TeardownTableRef[] = [];

    for (const table of tables) {

        const tableName = table.name;
        const label = displayName(tableName, table.schema, dialect);

        // Always preserve noorm tables
        if (isNoormTable(tableName)) {

            preserved.push(label);
            continue;

        }

        // Check if table should be preserved
        if (preserveSet.has(tableName)) {

            preserved.push(label);
            continue;

        }

        // If 'only' is specified, check if table is in the list
        if (options.only && !options.only.includes(tableName)) {

            preserved.push(label);
            continue;

        }

        targets.push({ name: tableName, schema: table.schema });
        truncated.push(label);

    }

    // Build SQL statements in three groups (disable/truncate/enable) so the
    // enable-FK phase can execute independently of a disable/truncate
    // failure below. `statements` stays the same flat concatenation for
    // dry-run output — skip the FK disable/enable bookends entirely when
    // nothing will be truncated, keeping the dry-run output honest and
    // avoiding a no-op `ALTER TABLE NOCHECK` against an empty list.
    const disableStatements: string[] = [];
    const truncateStatements: string[] = [];
    const enableStatements: string[] = [];

    if (targets.length > 0) {

        pushFlat(disableStatements, ops.disableForeignKeyChecks(targets));

        for (const target of targets) {

            truncateStatements.push(ops.truncateTable(target.name, target.schema, options.restartIdentity ?? true));

        }

        pushFlat(enableStatements, ops.enableForeignKeyChecks(targets));

        statements.push(...disableStatements, ...truncateStatements, ...enableStatements);

    }

    // Execute unless dry run. The enable-FK phase always runs, even when the
    // disable/truncate phase fails — a mid-truncate error must never leave
    // FK enforcement off (e.g. MSSQL's per-table NOCHECK survives reconnects
    // until manually repaired). The disable/truncate error takes priority
    // when both phases fail — the caller needs to know why the truncate
    // itself broke, not just that FK re-enable also failed.
    if (!options.dryRun) {

        const truncateError = await executeStatements(db, [...disableStatements, ...truncateStatements], false);
        const enableError = await executeStatements(db, enableStatements, true);

        if (truncateError) throw truncateError;
        if (enableError) throw enableError;

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
 * Order: FK constraints → Procedures → Functions → Views → Tables → Types
 *
 * Procedures/functions/views are dropped before tables because MSSQL
 * schema-bound objects (e.g. `WITH SCHEMABINDING`) hold dependency locks
 * on the tables they reference — dropping the table first fails with
 * "Cannot DROP TABLE ... because it is being referenced by object ...".
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
        procedures: [],
        types: [],
        foreignKeys: [],
    };

    assertDbPolicy(options.policy, 'db:teardown', 'tear down the schema', options.dryRun);

    observer.emit('teardown:start', { type: 'schema' });

    const preserveSet = new Set(options.preserveTables ?? []);
    const preserveSchemaSet = new Set(options.preserveSchemas ?? []);

    /** Whether an object belongs to a schema the caller asked to leave alone. */
    const inPreservedSchema = (schema?: string): boolean => Boolean(schema && preserveSchemaSet.has(schema));

    // Fetch all objects in parallel (include noorm tables so we can preserve them)
    const [
        [tables, tablesErr],
        [views, viewsErr],
        [functions, functionsErr],
        [procedures, proceduresErr],
        [types, typesErr],
        [foreignKeys, fksErr],
    ] = await Promise.all([
        attempt(() => fetchList(db, dialect, 'tables', { includeNoormTables: true })),
        attempt(() => fetchList(db, dialect, 'views')),
        attempt(() => fetchList(db, dialect, 'functions')),
        attempt(() => fetchList(db, dialect, 'procedures')),
        attempt(() => fetchList(db, dialect, 'types')),
        attempt(() => fetchList(db, dialect, 'foreignKeys')),
    ]);

    if (tablesErr) throw tablesErr;
    if (viewsErr) throw viewsErr;
    if (functionsErr) throw functionsErr;
    if (proceduresErr) throw proceduresErr;
    if (typesErr) throw typesErr;
    if (fksErr) throw fksErr;

    // 1. Drop FK constraints first (must happen before tables)
    for (const fk of foreignKeys) {

        const tableName = fk.tableName;

        // Skip noorm tables
        if (isNoormTable(tableName)) continue;

        // Skip preserved tables
        if (preserveSet.has(tableName)) continue;

        if (inPreservedSchema(fk.schema)) continue;

        dropped.foreignKeys.push(displayName(fk.name, fk.schema, dialect));
        statements.push(ops.dropForeignKey(fk.name, tableName, fk.schema));

    }

    // 1b. Drop CHECK constraints before functions (unless keepFunctions).
    // A scalar UDF referenced by a CHECK constraint can't be dropped while
    // its table exists (MSSQL error 3729). Functions are dropped before
    // tables below for schema-bound deps, so sever the CHECK dependency
    // first. Only MSSQL provides this op; other dialects don't need it.
    if (!options.keepFunctions && ops.dropCheckConstraints) {

        statements.push(ops.dropCheckConstraints());

    }

    // 2. Drop procedures (unless keepProcedures) — drop early so they
    // don't hold references to functions/views/tables we drop below
    if (!options.keepProcedures) {

        for (const proc of procedures) {

            if (inPreservedSchema(proc.schema)) continue;

            dropped.procedures.push(displayName(proc.name, proc.schema, dialect));
            statements.push(ops.dropProcedure(proc.name, proc.schema));

        }

    }

    // 3. Drop functions (unless keepFunctions) — must precede table drops
    // so schema-bound UDFs release their dependency locks on tables
    if (!options.keepFunctions) {

        for (const fn of functions) {

            if (inPreservedSchema(fn.schema)) continue;

            dropped.functions.push(displayName(fn.name, fn.schema, dialect));
            statements.push(ops.dropFunction(fn.name, fn.schema));

        }

    }

    // 4. Drop views (unless keepViews) — schema-bound views also hold
    // dependency locks on tables, so they must precede table drops
    if (!options.keepViews) {

        for (const view of views) {

            if (inPreservedSchema(view.schema)) continue;

            dropped.views.push(displayName(view.name, view.schema, dialect));
            statements.push(ops.dropView(view.name, view.schema));

        }

    }

    // 5. Drop tables — safe now that schema-bound dependents are gone
    for (const table of tables) {

        const tableName = table.name;
        const label = displayName(tableName, table.schema, dialect);

        // Always preserve noorm tables
        if (isNoormTable(tableName)) {

            preserved.push(label);
            continue;

        }

        // Skip preserved tables
        if (preserveSet.has(tableName)) {

            preserved.push(label);
            continue;

        }

        if (inPreservedSchema(table.schema)) {

            preserved.push(label);
            continue;

        }

        dropped.tables.push(label);
        statements.push(ops.dropTable(tableName, table.schema));

    }

    // 6. Drop types (unless keepTypes)
    // Table types (TVPs) first — they can reference domain types,
    // and MSSQL DROP TYPE has no CASCADE.
    // MSSQL: skip all types when functions or procedures are kept —
    // the dependency chain (functions → TVPs → domain types) means
    // types can't be safely dropped without CASCADE.
    const skipTypesDueToKeptRoutines = dialect === 'mssql'
        && (options.keepFunctions || options.keepProcedures);

    if (!options.keepTypes && !skipTypesDueToKeptRoutines) {

        const sortedTypes = [...types].sort((a, b) => {

            if (a.kind === 'composite' && b.kind !== 'composite') return -1;
            if (a.kind !== 'composite' && b.kind === 'composite') return 1;

            return 0;

        });

        for (const type of sortedTypes) {

            if (inPreservedSchema(type.schema)) continue;

            dropped.types.push(displayName(type.name, type.schema, dialect));
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

        const tracker = new ChangeTracker(
            db as Kysely<NoormDatabase>,
            options.configName,
            dialect,
        );

        const history = new ChangeHistory(
            db as Kysely<NoormDatabase>,
            options.configName,
            dialect,
        );

        // Mark all successful changes as stale
        result.staleCount = await tracker.markAllAsStale();

        // Record the reset event
        const parts = [
            `${dropped.tables.length} tables`,
            `${dropped.views.length} views`,
            `${dropped.functions.length} functions`,
            `${dropped.procedures.length} procedures`,
        ];
        result.resetRecordId = await history.recordReset(
            options.executedBy,
            `Schema teardown: dropped ${parts.join(', ')}`,
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
 *
 * Returns the outcome rather than throwing, because a post-script failure
 * must not undo a teardown that already succeeded — but it emits
 * `teardown:error` on the way out so the failure is observable. Previously
 * it was neither thrown nor emitted, and every surface except the TUI
 * reported a green teardown over a post-script that never ran.
 */
async function executePostScript(
    db: Kysely<unknown>,
    scriptPath: string,
): Promise<{ executed: boolean; error?: string }> {

    const fullPath = join(process.cwd(), scriptPath);

    const [content, readErr] = await attempt(() => readFile(fullPath, 'utf-8'));

    if (readErr) {

        const error = `Failed to read script: ${readErr.message}`;

        observer.emit('teardown:error', { error: new Error(error), object: scriptPath });

        return { executed: false, error };

    }

    // Split by semicolons and execute each statement
    const stmts = content
        .split(';')
        .map(s => s.trim())
        .filter(s => s.length > 0 && !s.startsWith('--'));

    for (const stmt of stmts) {

        const [, execErr] = await attempt(() => sql.raw(stmt).execute(db));

        if (execErr) {

            const error = `Script failed: ${execErr.message}`;

            observer.emit('teardown:error', { error: execErr, object: stmt });

            return { executed: false, error };

        }

    }

    return { executed: true };

}
