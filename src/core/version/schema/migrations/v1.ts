/**
 * Schema Migration v1 - Initial tracking tables.
 *
 * Creates all noorm tracking tables using Kysely's schema builder.
 * Uses dialect-aware column types for auto-increment primary keys.
 *
 * For table schema documentation, see plan/datamodel.md
 */
import type { Kysely, CreateTableBuilder } from 'kysely';
import { sql } from 'kysely';
import type { SchemaMigration } from '../../types.js';
import type { Dialect } from '../../../connection/types.js';

/**
 * Add an auto-incrementing ID column based on dialect.
 *
 * PostgreSQL uses 'serial' type, MSSQL uses 'identity', others use autoIncrement().
 */
function addIdColumn<TB extends string, C extends string>(
    builder: CreateTableBuilder<TB, C>,
    dialect: Dialect,
): CreateTableBuilder<TB, C | 'id'> {

    if (dialect === 'postgres') {

        return builder.addColumn('id', 'serial', (col) => col.primaryKey());

    }

    if (dialect === 'mssql') {

        return builder.addColumn('id', sql`int identity(1,1)`, (col) => col.primaryKey());

    }

    return builder.addColumn('id', 'integer', (col) => col.primaryKey().autoIncrement());

}

/**
 * Get the appropriate datetime column type for each dialect.
 *
 * MSSQL's 'timestamp' is a binary rowversion counter, not a datetime.
 * Use 'datetime2' for MSSQL via raw SQL, 'timestamp' for all others.
 */
function timestampType(dialect: Dialect) {

    return dialect === 'mssql' ? sql`datetime2` : 'timestamp';

}

/**
 * Migration v1: Create initial tracking tables.
 *
 * Tables created:
 * - __noorm_version__    - Version tracking
 * - __noorm_change__  - Operation batches
 * - __noorm_executions__ - File executions
 * - __noorm_lock__       - Concurrent operation locks
 * - __noorm_identities__ - User identities for team discovery
 */
export const v1: SchemaMigration = {
    version: 1,
    description: 'Create initial tracking tables',

    async up(db: Kysely<unknown>, dialect: Dialect): Promise<void> {

        // __noorm_version__ - Version tracking
        await addIdColumn(db.schema.createTable('__noorm_version__'), dialect)
            .addColumn('cli_version', 'varchar(50)', (col) => col.notNull())
            .addColumn('noorm_version', 'integer', (col) => col.notNull())
            .addColumn('state_version', 'integer', (col) => col.notNull())
            .addColumn('settings_version', 'integer', (col) => col.notNull())
            .addColumn('installed_at', timestampType(dialect), (col) =>
                col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`),
            )
            .addColumn('upgraded_at', timestampType(dialect), (col) =>
                col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`),
            )
            .execute();

        // __noorm_change__ - Operation batches
        await addIdColumn(db.schema.createTable('__noorm_change__'), dialect)
            .addColumn('name', 'varchar(255)', (col) => col.notNull())
            .addColumn('change_type', 'varchar(50)', (col) => col.notNull())
            .addColumn('direction', 'varchar(50)', (col) => col.notNull())
            .addColumn('checksum', 'varchar(64)', (col) => col.notNull().defaultTo(''))
            .addColumn('executed_at', timestampType(dialect), (col) =>
                col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`),
            )
            .addColumn('executed_by', 'varchar(255)', (col) => col.notNull().defaultTo(''))
            .addColumn('config_name', 'varchar(255)', (col) => col.notNull().defaultTo(''))
            .addColumn('cli_version', 'varchar(50)', (col) => col.notNull().defaultTo(''))
            .addColumn('status', 'varchar(50)', (col) => col.notNull())
            .addColumn('error_message', 'varchar(2000)', (col) => col.notNull().defaultTo(''))
            .addColumn('duration_ms', 'integer', (col) => col.notNull().defaultTo(0))
            .execute();

        // __noorm_executions__ - File executions
        await addIdColumn(db.schema.createTable('__noorm_executions__'), dialect)
            .addColumn('change_id', 'integer', (col) =>
                col.notNull().references('__noorm_change__.id').onDelete('cascade'),
            )
            .addColumn('filepath', 'varchar(500)', (col) => col.notNull())
            .addColumn('file_type', 'varchar(10)', (col) => col.notNull())
            .addColumn('checksum', 'varchar(64)', (col) => col.notNull().defaultTo(''))
            .addColumn('cli_version', 'varchar(50)', (col) => col.notNull().defaultTo(''))
            .addColumn('status', 'varchar(50)', (col) => col.notNull())
            .addColumn('error_message', 'varchar(2000)', (col) => col.notNull().defaultTo(''))
            .addColumn('skip_reason', 'varchar(100)', (col) => col.notNull().defaultTo(''))
            .addColumn('duration_ms', 'integer', (col) => col.notNull().defaultTo(0))
            .execute();

        // __noorm_lock__ - Concurrent operation locks
        await addIdColumn(db.schema.createTable('__noorm_lock__'), dialect)
            .addColumn('config_name', 'varchar(255)', (col) => col.notNull().unique())
            .addColumn('locked_by', 'varchar(255)', (col) => col.notNull())
            .addColumn('locked_at', timestampType(dialect), (col) =>
                col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`),
            )
            .addColumn('expires_at', timestampType(dialect), (col) => col.notNull())
            .addColumn('reason', 'varchar(255)', (col) => col.notNull().defaultTo(''))
            .execute();

        // __noorm_identities__ - User identities for team discovery
        await addIdColumn(db.schema.createTable('__noorm_identities__'), dialect)
            .addColumn('identity_hash', 'varchar(64)', (col) => col.notNull().unique())
            .addColumn('email', 'varchar(255)', (col) => col.notNull())
            .addColumn('name', 'varchar(255)', (col) => col.notNull())
            .addColumn('machine', 'varchar(255)', (col) => col.notNull())
            .addColumn('os', 'varchar(255)', (col) => col.notNull())
            .addColumn('public_key', 'text', (col) => col.notNull())
            .addColumn('encrypted_vault_key', 'text')
            .addColumn('registered_at', timestampType(dialect), (col) =>
                col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`),
            )
            .addColumn('last_seen_at', timestampType(dialect), (col) =>
                col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`),
            )
            .execute();

        // Create __noorm_vault__ table for shared secrets
        await addIdColumn(db.schema.createTable('__noorm_vault__'), dialect)
            .addColumn('secret_key', 'varchar(255)', (col) => col.notNull().unique())
            .addColumn('encrypted_value', 'text', (col) => col.notNull())
            .addColumn('set_by', 'varchar(255)', (col) => col.notNull())
            .addColumn('created_at', timestampType(dialect), (col) =>
                col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`),
            )
            .addColumn('updated_at', timestampType(dialect), (col) =>
                col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`),
            )
            .execute();

        // Create index on executions for faster lookups by change
        await db.schema
            .createIndex('idx_executions_change_id')
            .on('__noorm_executions__')
            .column('change_id')
            .execute();

        // Create index on change for faster lookups by name and config
        await db.schema
            .createIndex('idx_change_name_config')
            .on('__noorm_change__')
            .columns(['name', 'config_name'])
            .execute();

        // Create index on secret_key for faster lookups
        await db.schema
            .createIndex('idx_vault_secret_key')
            .on('__noorm_vault__')
            .column('secret_key')
            .execute();

    },

    async down(db: Kysely<unknown>, dialect: Dialect): Promise<void> {

        // MySQL and MSSQL require ON table_name for DROP INDEX
        const needsTable = dialect === 'mysql' || dialect === 'mssql';

        // Drop indexes first
        const dropIdx = (name: string, table: string) =>
            needsTable
                ? db.schema.dropIndex(name).on(table).execute()
                : db.schema.dropIndex(name).execute();

        await dropIdx('idx_change_name_config', '__noorm_change__');
        await dropIdx('idx_executions_change_id', '__noorm_executions__');
        await dropIdx('idx_vault_secret_key', '__noorm_vault__');

        // Drop tables in reverse order (child tables first due to FK constraints)
        await db.schema.dropTable('__noorm_vault__').execute();
        await db.schema.dropTable('__noorm_identities__').execute();
        await db.schema.dropTable('__noorm_lock__').execute();
        await db.schema.dropTable('__noorm_executions__').execute();
        await db.schema.dropTable('__noorm_change__').execute();
        await db.schema.dropTable('__noorm_version__').execute();

    },
};
