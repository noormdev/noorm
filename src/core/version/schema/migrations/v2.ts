/**
 * Schema Migration v2 - Move tracking tables to dedicated noorm schema.
 *
 * Moves all noorm tracking tables from the default schema into a dedicated
 * `noorm` schema for PostgreSQL and MSSQL. No-op for SQLite and MySQL
 * which don't support schemas.
 *
 * Steps: create schema → drop FK → drop indexes → move tables →
 * rename tables → recreate FK → recreate indexes.
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
 * Migration v2: Move tracking tables to noorm schema.
 *
 * PostgreSQL and MSSQL get a dedicated `noorm` schema with clean table names.
 * SQLite and MySQL skip this migration entirely since they lack schema support.
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

            // Create noorm schema
            if (dialect === 'postgres') {

                await sql`CREATE SCHEMA IF NOT EXISTS noorm`.execute(trx);

            }
            else {

                await sql`IF NOT EXISTS (SELECT 1 FROM sys.schemas WHERE name = 'noorm') EXEC('CREATE SCHEMA noorm')`.execute(trx);

            }

            // Drop FK constraint from __noorm_executions__ referencing __noorm_change__
            if (dialect === 'postgres') {

                const { rows } = await sql<{ constraint_name: string }>`
                    SELECT constraint_name
                    FROM information_schema.table_constraints
                    WHERE table_name = '__noorm_executions__'
                    AND constraint_type = 'FOREIGN KEY'
                `.execute(trx);

                for (const row of rows) {

                    await sql`ALTER TABLE __noorm_executions__ DROP CONSTRAINT ${sql.ref(row.constraint_name)}`.execute(trx);

                }

            }
            else {

                const { rows } = await sql<{ fk_name: string }>`
                    SELECT fk.name AS fk_name
                    FROM sys.foreign_keys fk
                    JOIN sys.tables t ON fk.parent_object_id = t.object_id
                    WHERE t.name = '__noorm_executions__'
                `.execute(trx);

                for (const row of rows) {

                    await sql`ALTER TABLE __noorm_executions__ DROP CONSTRAINT ${sql.ref(row.fk_name)}`.execute(trx);

                }

            }

            // Drop old indexes
            if (dialect === 'postgres') {

                for (const idx of INDEXES) {

                    await sql`DROP INDEX IF EXISTS ${sql.ref(idx.name)}`.execute(trx);

                }

            }
            else {

                // MSSQL does NOT support DROP INDEX IF EXISTS
                const prefixedTables: Record<string, string> = {
                    executions: '__noorm_executions__',
                    change: '__noorm_change__',
                    vault: '__noorm_vault__',
                };

                for (const idx of INDEXES) {

                    const tableName = prefixedTables[idx.table]!;
                    await sql`
                        IF EXISTS (SELECT 1 FROM sys.indexes WHERE name = ${idx.name})
                        DROP INDEX ${sql.ref(idx.name)} ON ${sql.table(tableName)}
                    `.execute(trx);

                }

            }

            // Move tables to noorm schema
            for (const t of TABLE_MAP) {

                if (dialect === 'postgres') {

                    await sql`ALTER TABLE ${sql.table(t.old)} SET SCHEMA noorm`.execute(trx);

                }
                else {

                    await sql`ALTER SCHEMA noorm TRANSFER ${sql.ref(`dbo.${t.old}`)}`.execute(trx);

                }

            }

            // Rename tables to drop prefix
            for (const t of TABLE_MAP) {

                if (dialect === 'postgres') {

                    await sql`ALTER TABLE ${sql.table(`noorm.${t.old}`)} RENAME TO ${sql.ref(t.new)}`.execute(trx);

                }
                else {

                    await sql`EXEC sp_rename ${sql.raw(`'noorm.${t.old}'`)}, ${sql.raw(`'${t.new}'`)}`.execute(trx);

                }

            }

            // Recreate FK constraint: noorm.executions.change_id → noorm.change.id
            await sql`
                ALTER TABLE ${sql.table('noorm.executions')}
                ADD CONSTRAINT fk_executions_change_id
                FOREIGN KEY (change_id) REFERENCES ${sql.table('noorm.change')}(id)
                ON DELETE CASCADE
            `.execute(trx);

            // Recreate indexes in noorm schema
            for (const idx of INDEXES) {

                const cols = idx.columns.join(', ');
                await sql`CREATE INDEX ${sql.ref(idx.name)} ON ${sql.table(`noorm.${idx.table}`)} (${sql.raw(cols)})`.execute(trx);

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

                const prefixedTables: Record<string, string> = {
                    executions: '__noorm_executions__',
                    change: '__noorm_change__',
                    vault: '__noorm_vault__',
                };

                const tableName = prefixedTables[idx.table]!;
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
