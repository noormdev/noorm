/**
 * Schema Migration v1 - Initial tracking tables.
 *
 * Creates all noorm tracking tables using Kysely's schema builder.
 * This is dialect-agnostic - no raw SQL.
 *
 * For table schema documentation, see plan/datamodel.md
 */
import type { Kysely } from 'kysely';
import { sql } from 'kysely';
import type { SchemaMigration } from '../../types.js';

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

    async up(db: Kysely<unknown>): Promise<void> {

        // __noorm_version__ - Version tracking
        await db.schema
            .createTable('__noorm_version__')
            .addColumn('id', 'serial', (col) => col.primaryKey())
            .addColumn('cli_version', 'varchar(50)', (col) => col.notNull())
            .addColumn('noorm_version', 'integer', (col) => col.notNull())
            .addColumn('state_version', 'integer', (col) => col.notNull())
            .addColumn('settings_version', 'integer', (col) => col.notNull())
            .addColumn('installed_at', 'timestamp', (col) =>
                col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`),
            )
            .addColumn('upgraded_at', 'timestamp', (col) =>
                col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`),
            )
            .execute();

        // __noorm_change__ - Operation batches
        await db.schema
            .createTable('__noorm_change__')
            .addColumn('id', 'serial', (col) => col.primaryKey())
            .addColumn('name', 'varchar(255)', (col) => col.notNull())
            .addColumn('change_type', 'varchar(50)', (col) => col.notNull())
            .addColumn('direction', 'varchar(50)', (col) => col.notNull())
            .addColumn('checksum', 'varchar(64)', (col) => col.notNull().defaultTo(''))
            .addColumn('executed_at', 'timestamp', (col) =>
                col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`),
            )
            .addColumn('executed_by', 'varchar(255)', (col) => col.notNull().defaultTo(''))
            .addColumn('config_name', 'varchar(255)', (col) => col.notNull().defaultTo(''))
            .addColumn('cli_version', 'varchar(50)', (col) => col.notNull().defaultTo(''))
            .addColumn('status', 'varchar(50)', (col) => col.notNull())
            .addColumn('error_message', 'text', (col) => col.notNull().defaultTo(''))
            .addColumn('duration_ms', 'integer', (col) => col.notNull().defaultTo(0))
            .execute();

        // __noorm_executions__ - File executions
        await db.schema
            .createTable('__noorm_executions__')
            .addColumn('id', 'serial', (col) => col.primaryKey())
            .addColumn('change_id', 'integer', (col) =>
                col.notNull().references('__noorm_change__.id').onDelete('cascade'),
            )
            .addColumn('filepath', 'varchar(500)', (col) => col.notNull())
            .addColumn('file_type', 'varchar(10)', (col) => col.notNull())
            .addColumn('checksum', 'varchar(64)', (col) => col.notNull().defaultTo(''))
            .addColumn('cli_version', 'varchar(50)', (col) => col.notNull().defaultTo(''))
            .addColumn('status', 'varchar(50)', (col) => col.notNull())
            .addColumn('error_message', 'text', (col) => col.notNull().defaultTo(''))
            .addColumn('skip_reason', 'varchar(100)', (col) => col.notNull().defaultTo(''))
            .addColumn('duration_ms', 'integer', (col) => col.notNull().defaultTo(0))
            .execute();

        // __noorm_lock__ - Concurrent operation locks
        await db.schema
            .createTable('__noorm_lock__')
            .addColumn('id', 'serial', (col) => col.primaryKey())
            .addColumn('config_name', 'varchar(255)', (col) => col.notNull().unique())
            .addColumn('locked_by', 'varchar(255)', (col) => col.notNull())
            .addColumn('locked_at', 'timestamp', (col) =>
                col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`),
            )
            .addColumn('expires_at', 'timestamp', (col) => col.notNull())
            .addColumn('reason', 'varchar(255)', (col) => col.notNull().defaultTo(''))
            .execute();

        // __noorm_identities__ - User identities for team discovery
        await db.schema
            .createTable('__noorm_identities__')
            .addColumn('id', 'serial', (col) => col.primaryKey())
            .addColumn('identity_hash', 'varchar(64)', (col) => col.notNull().unique())
            .addColumn('email', 'varchar(255)', (col) => col.notNull())
            .addColumn('name', 'varchar(255)', (col) => col.notNull())
            .addColumn('machine', 'varchar(255)', (col) => col.notNull())
            .addColumn('os', 'varchar(255)', (col) => col.notNull())
            .addColumn('public_key', 'text', (col) => col.notNull())
            .addColumn('registered_at', 'timestamp', (col) =>
                col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`),
            )
            .addColumn('last_seen_at', 'timestamp', (col) =>
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

    },

    async down(db: Kysely<unknown>): Promise<void> {

        // Drop indexes first
        await db.schema.dropIndex('idx_change_name_config').execute();
        await db.schema.dropIndex('idx_executions_change_id').execute();

        // Drop tables in reverse order (child tables first due to FK constraints)
        await db.schema.dropTable('__noorm_identities__').execute();
        await db.schema.dropTable('__noorm_lock__').execute();
        await db.schema.dropTable('__noorm_executions__').execute();
        await db.schema.dropTable('__noorm_change__').execute();
        await db.schema.dropTable('__noorm_version__').execute();

    },
};
