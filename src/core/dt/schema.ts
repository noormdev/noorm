/**
 * Schema builder and validator for .dt format.
 *
 * Queries database column metadata and maps to universal types.
 * Validates .dt schemas against target databases before transfer.
 *
 * @example
 * ```typescript
 * import { buildDtSchema, validateSchema } from './schema.js';
 *
 * const [schema, err] = await buildDtSchema({ db, dialect: 'postgres', tableName: 'users' });
 *
 * const validation = await validateSchema({
 *     dtSchema: schema,
 *     targetDb: destDb,
 *     targetDialect: 'mysql',
 * });
 * ```
 */
import { sql } from 'kysely';
import { attempt } from '@logosdx/utils';

import type { Kysely } from 'kysely';
import type { Dialect } from '../connection/types.js';
import type { NoormDatabase } from '../shared/tables.js';
import type {
    DtSchema,
    DtColumn,
    BuildSchemaOptions,
    ValidateSchemaOptions,
    SchemaValidationResult,
} from './types.js';
import { FORMAT_VERSION } from './constants.js';
import { toUniversalType, toDialectType } from './type-map.js';
import { queryDatabaseVersion } from './version.js';

/**
 * Build a DtSchema from a live database table.
 *
 * Queries column metadata and maps each column's type to the universal type system.
 *
 * @param options - Database connection, dialect, and table name
 * @returns DtSchema or error
 *
 * @example
 * ```typescript
 * const [schema, err] = await buildDtSchema({
 *     db: kyselyDb,
 *     dialect: 'postgres',
 *     tableName: 'users',
 *     version: { dialect: 'postgres', major: 16, minor: 2, raw: '16.2' },
 * });
 * ```
 */
export async function buildDtSchema(
    options: BuildSchemaOptions,
): Promise<[DtSchema | null, Error | null]> {

    const { db, dialect, tableName, schema } = options;
    const kyselyDb = db as Kysely<NoormDatabase>;

    // Detect version if not provided
    let version = options.version;

    if (!version) {

        const [detected] = await queryDatabaseVersion({ db: kyselyDb, dialect });
        version = detected ?? undefined;

    }

    // Query column metadata
    const [columns, err] = await queryColumns(kyselyDb, dialect, tableName, schema);

    if (err) {

        return [null, err];

    }

    // Map to DtColumn with universal types
    const dtColumns: DtColumn[] = columns.map((col) => {

        const mapping = toUniversalType({
            dbType: col.dataType,
            dialect,
        });

        const dtCol: DtColumn = {
            name: col.name,
            type: mapping.universalType,
        };

        // Include source type if different from universal type name
        if (col.dataType.toLowerCase() !== mapping.universalType) {

            dtCol.sourceType = col.dataType;

        }

        if (!col.nullable) {

            dtCol.nullable = false;

        }

        return dtCol;

    });

    const dtSchema: DtSchema = {
        v: FORMAT_VERSION,
        d: dialect === 'postgres' ? 'postgresql' : dialect,
        dv: version ? `${version.major}.${version.minor}` : 'unknown',
        t: tableName,
        columns: dtColumns,
    };

    return [dtSchema, null];

}

/**
 * Validate a .dt schema against a target database.
 *
 * Checks that the target table exists and all columns are compatible.
 *
 * @param options - Schema and target database info
 * @returns Validation result with errors and warnings
 */
export async function validateSchema(
    options: ValidateSchemaOptions,
): Promise<[SchemaValidationResult | null, Error | null]> {

    const { dtSchema, targetDb, targetDialect, targetVersion } = options;
    const kyselyDb = targetDb as Kysely<NoormDatabase>;
    const tableName = dtSchema.t;

    const errors: string[] = [];
    const warnings: string[] = [];

    if (!tableName) {

        errors.push('Schema has no table name (t field)');

        return [{ valid: false, errors, warnings }, null];

    }

    // Query target table columns
    const [targetColumns, queryErr] = await queryColumns(kyselyDb, targetDialect, tableName);

    if (queryErr) {

        errors.push(`Target table "${tableName}" not found or inaccessible: ${queryErr.message}`);

        return [{ valid: false, errors, warnings }, null];

    }

    if (targetColumns.length === 0) {

        errors.push(`Target table "${tableName}" has no columns or does not exist`);

        return [{ valid: false, errors, warnings }, null];

    }

    // Build target column lookup
    const targetByName: { [key: string]: ColumnMeta } = {};

    for (const col of targetColumns) {

        targetByName[col.name] = col;

    }

    // Validate each .dt column exists in target
    for (const dtCol of dtSchema.columns) {

        const targetCol = targetByName[dtCol.name];

        if (!targetCol) {

            errors.push(`Column "${dtCol.name}" exists in .dt but not in target table`);
            continue;

        }

        // Check type compatibility
        const targetMapping = toUniversalType({
            dbType: targetCol.dataType,
            dialect: targetDialect,
        });

        if (targetMapping.universalType !== dtCol.type) {

            // Type mismatch — check if it's a known-compatible mapping
            const targetTypeStr = toDialectType({
                universalType: dtCol.type,
                dialect: targetDialect,
                version: targetVersion,
            });

            warnings.push(
                `Column "${dtCol.name}": source type "${dtCol.type}" maps to "${targetTypeStr}" ` +
                `in target, but target column is "${targetCol.dataType}" (${targetMapping.universalType})`,
            );

        }

    }

    return [{
        valid: errors.length === 0,
        errors,
        warnings,
    }, null];

}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Query the primary key columns of a table, in key order.
 *
 * Export pages by primary key: without one there is no stable cursor and
 * pagination silently drops and duplicates rows under concurrent writes.
 * An empty result means the table genuinely has no primary key, which the
 * pager handles by reading it in a single statement.
 *
 * @example
 * ```typescript
 * const [pk, err] = await queryPrimaryKeyColumns(db, 'postgres', 'users', 'public');
 * // ['id']
 * ```
 */
export async function queryPrimaryKeyColumns(
    db: Kysely<NoormDatabase>,
    dialect: Dialect,
    tableName: string,
    schema?: string,
): Promise<[string[], Error | null]> {

    switch (dialect) {

    case 'postgres':
        return queryPostgresPrimaryKey(db, tableName, schema ?? 'public');

    case 'mysql':
        return queryMysqlPrimaryKey(db, tableName);

    case 'mssql':
        return queryMssqlPrimaryKey(db, tableName);

    default:
        return [[], null];

    }

}

/**
 * Query PostgreSQL primary key columns.
 */
async function queryPostgresPrimaryKey(
    db: Kysely<NoormDatabase>,
    tableName: string,
    schema: string,
): Promise<[string[], Error | null]> {

    const [result, err] = await attempt(() =>
        sql<{ column_name: string }>`
            SELECT kcu.column_name
            FROM information_schema.table_constraints tc
            JOIN information_schema.key_column_usage kcu
                ON tc.constraint_name = kcu.constraint_name
                AND tc.table_schema = kcu.table_schema
            WHERE tc.constraint_type = 'PRIMARY KEY'
            AND tc.table_schema = ${schema}
            AND tc.table_name = ${tableName}
            ORDER BY kcu.ordinal_position
        `.execute(db),
    );

    if (err) {

        return [[], err];

    }

    return [result.rows.map((r) => r.column_name), null];

}

/**
 * Query MySQL primary key columns.
 */
async function queryMysqlPrimaryKey(
    db: Kysely<NoormDatabase>,
    tableName: string,
): Promise<[string[], Error | null]> {

    const [result, err] = await attempt(() =>
        sql<{ column_name: string }>`
            SELECT COLUMN_NAME as column_name
            FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
            WHERE TABLE_SCHEMA = DATABASE()
            AND TABLE_NAME = ${tableName}
            AND CONSTRAINT_NAME = 'PRIMARY'
            ORDER BY ORDINAL_POSITION
        `.execute(db),
    );

    if (err) {

        return [[], err];

    }

    return [result.rows.map((r) => r.column_name), null];

}

/**
 * Query MSSQL primary key columns.
 */
async function queryMssqlPrimaryKey(
    db: Kysely<NoormDatabase>,
    tableName: string,
): Promise<[string[], Error | null]> {

    const [result, err] = await attempt(() =>
        sql<{ column_name: string }>`
            SELECT c.name as column_name
            FROM sys.indexes i
            JOIN sys.index_columns ic
                ON i.object_id = ic.object_id AND i.index_id = ic.index_id
            JOIN sys.columns c
                ON ic.object_id = c.object_id AND ic.column_id = c.column_id
            JOIN sys.tables t ON i.object_id = t.object_id
            WHERE i.is_primary_key = 1
            AND t.name = ${tableName}
            ORDER BY ic.key_ordinal
        `.execute(db),
    );

    if (err) {

        return [[], err];

    }

    return [result.rows.map((r) => r.column_name), null];

}

/**
 * Column metadata from information_schema queries.
 */
interface ColumnMeta {

    name: string;
    dataType: string;
    nullable: boolean;

}

/**
 * Query column metadata for a table.
 */
async function queryColumns(
    db: Kysely<NoormDatabase>,
    dialect: Dialect,
    tableName: string,
    schema?: string,
): Promise<[ColumnMeta[], Error | null]> {

    switch (dialect) {

    case 'postgres':
        return queryPostgresColumns(db, tableName, schema ?? 'public');

    case 'mysql':
        return queryMysqlColumns(db, tableName);

    case 'mssql':
        return queryMssqlColumns(db, tableName);

    default:
        return [[], new Error(`Unsupported dialect: ${dialect}`)];

    }

}

/**
 * Query PostgreSQL column metadata.
 */
async function queryPostgresColumns(
    db: Kysely<NoormDatabase>,
    tableName: string,
    schema: string,
): Promise<[ColumnMeta[], Error | null]> {

    const [result, err] = await attempt(() =>
        sql<{
            column_name: string;
            data_type: string;
            udt_name: string;
            is_nullable: string;
        }>`
            SELECT column_name, data_type, udt_name, is_nullable
            FROM information_schema.columns
            WHERE table_schema = ${schema}
            AND table_name = ${tableName}
            ORDER BY ordinal_position
        `.execute(db),
    );

    if (err) {

        return [[], err];

    }

    return [result.rows.map((r) => ({
        name: r.column_name,
        // Use udt_name for more specific types (e.g., 'jsonb' vs 'USER-DEFINED')
        dataType: r.data_type === 'USER-DEFINED' ? r.udt_name : r.data_type,
        nullable: r.is_nullable === 'YES',
    })), null];

}

/**
 * Query MySQL column metadata.
 */
async function queryMysqlColumns(
    db: Kysely<NoormDatabase>,
    tableName: string,
): Promise<[ColumnMeta[], Error | null]> {

    const [result, err] = await attempt(() =>
        sql<{
            COLUMN_NAME: string;
            DATA_TYPE: string;
            COLUMN_TYPE: string;
            IS_NULLABLE: string;
        }>`
            SELECT COLUMN_NAME, DATA_TYPE, COLUMN_TYPE, IS_NULLABLE
            FROM INFORMATION_SCHEMA.COLUMNS
            WHERE TABLE_SCHEMA = DATABASE()
            AND TABLE_NAME = ${tableName}
            ORDER BY ORDINAL_POSITION
        `.execute(db),
    );

    if (err) {

        return [[], err];

    }

    return [result.rows.map((r) => ({
        name: r.COLUMN_NAME,
        // Use COLUMN_TYPE for precision (e.g., 'tinyint(1)' for bool)
        dataType: r.COLUMN_TYPE ?? r.DATA_TYPE,
        nullable: r.IS_NULLABLE === 'YES',
    })), null];

}

/**
 * Query MSSQL column metadata.
 */
async function queryMssqlColumns(
    db: Kysely<NoormDatabase>,
    tableName: string,
): Promise<[ColumnMeta[], Error | null]> {

    const [result, err] = await attempt(() =>
        sql<{
            name: string;
            type_name: string;
            is_nullable: number;
        }>`
            SELECT
                c.name,
                CASE
                    WHEN TYPE_NAME(c.user_type_id) IN ('varchar', 'nvarchar', 'varbinary')
                        AND c.max_length = -1
                    THEN TYPE_NAME(c.user_type_id) + '(max)'
                    ELSE TYPE_NAME(c.user_type_id)
                END as type_name,
                c.is_nullable
            FROM sys.columns c
            JOIN sys.tables t ON c.object_id = t.object_id
            WHERE t.name = ${tableName}
            ORDER BY c.column_id
        `.execute(db),
    );

    if (err) {

        return [[], err];

    }

    return [result.rows.map((r) => ({
        name: r.name,
        dataType: r.type_name,
        nullable: r.is_nullable === 1,
    })), null];

}
