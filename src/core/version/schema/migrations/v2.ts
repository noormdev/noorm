/**
 * Schema Migration v2 - Move tracking tables to dedicated noorm schema.
 *
 * Moves all noorm tracking tables from the default schema into a dedicated
 * `noorm` schema for PostgreSQL and MSSQL. No-op for SQLite and MySQL
 * which don't support schemas.
 *
 * Steps: create schema → drop FK → drop indexes → move tables →
 * rename tables → recreate FK → recreate indexes.
 *
 * Fully idempotent: handles partial migration state from previous
 * interrupted runs by checking each table's location before acting.
 */
import type { Kysely } from 'kysely';
import { sql } from 'kysely';

import type { SchemaMigration } from '../../types.js';
import type { Dialect } from '../../../connection/types.js';

/**
 * Table name mapping from prefixed to clean names.
 *
 * Used during migration to rename tables after moving them
 * into the noorm schema.
 */
const TABLE_MAP = [
    { old: '__noorm_version__', new: 'version' },
    { old: '__noorm_change__', new: 'change' },
    { old: '__noorm_executions__', new: 'executions' },
    { old: '__noorm_lock__', new: 'lock' },
    { old: '__noorm_identities__', new: 'identities' },
    { old: '__noorm_vault__', new: 'vault' },
] as const;

/**
 * Index definitions for recreation after table moves.
 *
 * Each index tracks its name, the table it belongs to (clean name),
 * and the columns it covers.
 */
const INDEXES = [
    { name: 'idx_executions_change_id', table: 'executions', columns: ['change_id'] },
    { name: 'idx_change_name_config', table: 'change', columns: ['name', 'config_name'] },
    { name: 'idx_vault_secret_key', table: 'vault', columns: ['secret_key'] },
] as const;

/**
 * Prefixed-to-clean table name lookup for indexes.
 *
 * Maps the clean index table name to the prefixed table name
 * used in the default schema.
 */
const PREFIXED_TABLES: Record<string, string> = {
    executions: '__noorm_executions__',
    change: '__noorm_change__',
    vault: '__noorm_vault__',
};

/**
 * Migration v2: Move tracking tables to noorm schema.
 *
 * PostgreSQL and MSSQL get a dedicated `noorm` schema with clean table names.
 * SQLite and MySQL skip this migration entirely since they lack schema support.
 *
 * Handles all partial-migration states:
 * - Tables already in noorm with clean names (fully migrated)
 * - Tables in noorm with prefixed names (transferred but not renamed)
 * - Tables still in dbo/public (not yet transferred)
 * - Mixed state (some tables migrated, others not)
 * - Orphaned dbo tables alongside migrated noorm tables
 *
 * @example
 * ```typescript
 * await v2.up(db, 'postgres');
 * // Tables moved: __noorm_version__ → noorm.version, etc.
 * ```
 */
export const v2: SchemaMigration = {
    version: 2,
    description: 'Move tracking tables to noorm schema',

    async up(db: Kysely<unknown>, dialect: Dialect): Promise<void> {

        if (dialect === 'sqlite' || dialect === 'mysql') return;

        await db.transaction().execute(async (trx) => {

            const src = dialect === 'postgres' ? 'public' : 'dbo';

            // ── Helpers ──────────────────────────────────────

            /**
             * Check if a table exists in a specific schema.
             */
            async function tableExistsIn(schema: string, table: string): Promise<boolean> {

                if (dialect === 'postgres') {

                    const { rows } = await sql<{ n: number }>`
                        SELECT 1 AS n FROM information_schema.tables
                        WHERE table_schema = ${schema} AND table_name = ${table}
                    `.execute(trx);

                    return rows.length > 0;

                }

                const { rows } = await sql<{ n: number }>`
                    SELECT 1 AS n FROM sys.tables t
                    JOIN sys.schemas s ON t.schema_id = s.schema_id
                    WHERE t.name = ${table} AND s.name = ${schema}
                `.execute(trx);

                return rows.length > 0;

            }

            /**
             * Get foreign key constraint names on a table in a schema.
             * Returns empty array if table doesn't exist.
             */
            async function getForeignKeys(schema: string, table: string): Promise<string[]> {

                if (!(await tableExistsIn(schema, table))) return [];

                if (dialect === 'postgres') {

                    const { rows } = await sql<{ name: string }>`
                        SELECT tc.constraint_name AS name
                        FROM information_schema.table_constraints tc
                        WHERE tc.table_schema = ${schema}
                        AND tc.table_name = ${table}
                        AND tc.constraint_type = 'FOREIGN KEY'
                    `.execute(trx);

                    return rows.map((r) => r.name);

                }

                const { rows } = await sql<{ name: string }>`
                    SELECT fk.name
                    FROM sys.foreign_keys fk
                    JOIN sys.tables t ON fk.parent_object_id = t.object_id
                    JOIN sys.schemas s ON t.schema_id = s.schema_id
                    WHERE t.name = ${table} AND s.name = ${schema}
                `.execute(trx);

                return rows.map((r) => r.name);

            }

            /**
             * Check if an index exists in a specific schema.
             */
            async function indexExistsIn(schema: string, idxName: string): Promise<boolean> {

                if (dialect === 'postgres') {

                    const { rows } = await sql<{ n: number }>`
                        SELECT 1 AS n FROM pg_indexes
                        WHERE schemaname = ${schema} AND indexname = ${idxName}
                    `.execute(trx);

                    return rows.length > 0;

                }

                const { rows } = await sql<{ n: number }>`
                    SELECT 1 AS n FROM sys.indexes i
                    JOIN sys.tables t ON i.object_id = t.object_id
                    JOIN sys.schemas s ON t.schema_id = s.schema_id
                    WHERE i.name = ${idxName} AND s.name = ${schema}
                `.execute(trx);

                return rows.length > 0;

            }

            // ── Step 1: Create noorm schema (idempotent) ─────

            if (dialect === 'postgres') {

                await sql`CREATE SCHEMA IF NOT EXISTS noorm`.execute(trx);

            }
            else {

                await sql`IF NOT EXISTS (SELECT 1 FROM sys.schemas WHERE name = 'noorm') EXEC('CREATE SCHEMA noorm')`.execute(trx);

            }

            // ── Step 2: Drop FK constraints from all locations ──
            // The executions table may exist in dbo, noorm (old name), or noorm (new name).
            // Drop FKs from wherever they are before moving tables.

            const fkLocations = [
                { schema: src, table: '__noorm_executions__' },
                { schema: 'noorm', table: '__noorm_executions__' },
                { schema: 'noorm', table: 'executions' },
            ];

            for (const loc of fkLocations) {

                const fks = await getForeignKeys(loc.schema, loc.table);

                for (const fkName of fks) {

                    await sql`ALTER TABLE ${sql.table(`${loc.schema}.${loc.table}`)} DROP CONSTRAINT ${sql.ref(fkName)}`.execute(trx);

                }

            }

            // ── Step 3: Drop old indexes from all locations ──

            for (const idx of INDEXES) {

                // Drop from default schema (dbo/public)
                if (await indexExistsIn(src, idx.name)) {

                    if (dialect === 'postgres') {

                        await sql`DROP INDEX IF EXISTS ${sql.ref(idx.name)}`.execute(trx);

                    }
                    else {

                        const tableName = PREFIXED_TABLES[idx.table]!;
                        await sql`
                            IF EXISTS (SELECT 1 FROM sys.indexes WHERE name = ${idx.name})
                            DROP INDEX ${sql.ref(idx.name)} ON ${sql.table(tableName)}
                        `.execute(trx);

                    }

                }

                // Drop from noorm schema (may be on old-named or new-named table)
                if (await indexExistsIn('noorm', idx.name)) {

                    if (dialect === 'postgres') {

                        await sql`DROP INDEX IF EXISTS ${sql.ref(`noorm.${idx.name}`)}`.execute(trx);

                    }
                    else {

                        const oldName = PREFIXED_TABLES[idx.table]!;
                        const onOldName = await tableExistsIn('noorm', oldName);
                        const tbl = onOldName ? `noorm.${oldName}` : `noorm.${idx.table}`;

                        await sql`
                            IF EXISTS (SELECT 1 FROM sys.indexes WHERE name = ${idx.name})
                            DROP INDEX ${sql.ref(idx.name)} ON ${sql.table(tbl)}
                        `.execute(trx);

                    }

                }

            }

            // ── Step 4: Move and rename tables ──────────────

            for (const t of TABLE_MAP) {

                const inNoormNew = await tableExistsIn('noorm', t.new);
                const inNoormOld = await tableExistsIn('noorm', t.old);
                const inSrc = await tableExistsIn(src, t.old);

                // Already fully migrated — just clean up dbo/public leftover
                if (inNoormNew) {

                    if (inSrc) {

                        if (dialect === 'postgres') {

                            await sql`DROP TABLE ${sql.table(`${src}.${t.old}`)} CASCADE`.execute(trx);

                        }
                        else {

                            await sql`DROP TABLE ${sql.table(`${src}.${t.old}`)}`.execute(trx);

                        }

                    }

                    // Also drop noorm old-named leftover if present
                    if (inNoormOld) {

                        if (dialect === 'postgres') {

                            await sql`DROP TABLE ${sql.table(`noorm.${t.old}`)} CASCADE`.execute(trx);

                        }
                        else {

                            await sql`DROP TABLE ${sql.table(`noorm.${t.old}`)}`.execute(trx);

                        }

                    }

                    continue;

                }

                // Table doesn't exist anywhere — nothing to do
                if (!inNoormOld && !inSrc) continue;

                // Ensure table is in noorm schema (with old name)
                if (!inNoormOld && inSrc) {

                    if (dialect === 'postgres') {

                        await sql`ALTER TABLE ${sql.table(t.old)} SET SCHEMA noorm`.execute(trx);

                    }
                    else {

                        await sql`ALTER SCHEMA noorm TRANSFER ${sql.ref(`dbo.${t.old}`)}`.execute(trx);

                    }

                }

                // Rename from prefixed to clean name
                if (dialect === 'postgres') {

                    await sql`ALTER TABLE ${sql.table(`noorm.${t.old}`)} RENAME TO ${sql.ref(t.new)}`.execute(trx);

                }
                else {

                    await sql`EXEC sp_rename ${sql.raw(`'noorm.${t.old}'`)}, ${sql.raw(`'${t.new}'`)}`.execute(trx);

                }

                // Clean up dbo/public leftover if both copies existed
                if (inSrc && inNoormOld) {

                    if (await tableExistsIn(src, t.old)) {

                        if (dialect === 'postgres') {

                            await sql`DROP TABLE ${sql.table(`${src}.${t.old}`)} CASCADE`.execute(trx);

                        }
                        else {

                            await sql`DROP TABLE ${sql.table(`${src}.${t.old}`)}`.execute(trx);

                        }

                    }

                }

            }

            // ── Step 5: Recreate FK constraint (if missing) ──

            const fksOnExec = await getForeignKeys('noorm', 'executions');

            if (fksOnExec.length === 0) {

                await sql`
                    ALTER TABLE ${sql.table('noorm.executions')}
                    ADD CONSTRAINT fk_executions_change_id
                    FOREIGN KEY (change_id) REFERENCES ${sql.table('noorm.change')}(id)
                    ON DELETE CASCADE
                `.execute(trx);

            }

            // ── Step 6: Recreate indexes (if missing) ────────

            for (const idx of INDEXES) {

                if (!(await indexExistsIn('noorm', idx.name))) {

                    const cols = idx.columns.join(', ');
                    await sql`CREATE INDEX ${sql.ref(idx.name)} ON ${sql.table(`noorm.${idx.table}`)} (${sql.raw(cols)})`.execute(trx);

                }

            }

        });

    },

    async down(db: Kysely<unknown>, dialect: Dialect): Promise<void> {

        if (dialect === 'sqlite' || dialect === 'mysql') return;

        await db.transaction().execute(async (trx) => {

            // Drop FK constraint from noorm.executions
            if (dialect === 'postgres') {

                const { rows } = await sql<{ constraint_name: string }>`
                    SELECT constraint_name
                    FROM information_schema.table_constraints
                    WHERE table_schema = 'noorm'
                    AND table_name = 'executions'
                    AND constraint_type = 'FOREIGN KEY'
                `.execute(trx);

                for (const row of rows) {

                    await sql`ALTER TABLE ${sql.table('noorm.executions')} DROP CONSTRAINT ${sql.ref(row.constraint_name)}`.execute(trx);

                }

            }
            else {

                const { rows } = await sql<{ fk_name: string }>`
                    SELECT fk.name AS fk_name
                    FROM sys.foreign_keys fk
                    JOIN sys.tables t ON fk.parent_object_id = t.object_id
                    JOIN sys.schemas s ON t.schema_id = s.schema_id
                    WHERE t.name = 'executions' AND s.name = 'noorm'
                `.execute(trx);

                for (const row of rows) {

                    await sql`ALTER TABLE ${sql.table('noorm.executions')} DROP CONSTRAINT ${sql.ref(row.fk_name)}`.execute(trx);

                }

            }

            // Drop indexes from noorm schema
            if (dialect === 'postgres') {

                for (const idx of INDEXES) {

                    await sql`DROP INDEX IF EXISTS ${sql.ref(`noorm.${idx.name}`)}`.execute(trx);

                }

            }
            else {

                // MSSQL does NOT support DROP INDEX IF EXISTS
                for (const idx of INDEXES) {

                    await sql`
                        IF EXISTS (SELECT 1 FROM sys.indexes WHERE name = ${idx.name})
                        DROP INDEX ${sql.ref(idx.name)} ON ${sql.table(`noorm.${idx.table}`)}
                    `.execute(trx);

                }

            }

            // Rename tables to add prefix back
            for (const t of TABLE_MAP) {

                if (dialect === 'postgres') {

                    await sql`ALTER TABLE ${sql.table(`noorm.${t.new}`)} RENAME TO ${sql.ref(t.old)}`.execute(trx);

                }
                else {

                    await sql`EXEC sp_rename ${sql.raw(`'noorm.${t.new}'`)}, ${sql.raw(`'${t.old}'`)}`.execute(trx);

                }

            }

            // Move tables back to default schema
            for (const t of TABLE_MAP) {

                if (dialect === 'postgres') {

                    await sql`ALTER TABLE ${sql.table(`noorm.${t.old}`)} SET SCHEMA public`.execute(trx);

                }
                else {

                    await sql`ALTER SCHEMA dbo TRANSFER ${sql.ref(`noorm.${t.old}`)}`.execute(trx);

                }

            }

            // Recreate FK constraint with prefixed names
            await sql`
                ALTER TABLE __noorm_executions__
                ADD CONSTRAINT fk_executions_change_id
                FOREIGN KEY (change_id) REFERENCES __noorm_change__(id)
                ON DELETE CASCADE
            `.execute(trx);

            // Recreate indexes with prefixed table names
            for (const idx of INDEXES) {

                const tableName = PREFIXED_TABLES[idx.table]!;
                const cols = idx.columns.join(', ');
                await sql`CREATE INDEX ${sql.ref(idx.name)} ON ${sql.table(tableName)} (${sql.raw(cols)})`.execute(trx);

            }

            // Drop noorm schema
            if (dialect === 'postgres') {

                await sql`DROP SCHEMA IF EXISTS noorm`.execute(trx);

            }
            else {

                await sql`IF EXISTS (SELECT 1 FROM sys.schemas WHERE name = 'noorm') DROP SCHEMA noorm`.execute(trx);

            }

        });

    },
};
