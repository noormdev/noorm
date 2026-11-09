import { sql, type CreateTableBuilder, type Kysely } from 'kysely';

import type { Dialect } from '../../../connection/types.js';
import { getNoormTables } from '../../../shared/tables.js';
import type { SchemaMigration } from '../../types.js';
import { timestampType } from './v1.js';

const RUN_INDEX = 'idx_pipeline_run_active_key';
const STEP_INDEX = 'uq_pipeline_step_run_name';

async function indexExists(db: Kysely<unknown>, dialect: Dialect, table: string, name: string): Promise<boolean> {

    if (dialect === 'postgres') {

        const { rows } = await sql`
            SELECT 1 FROM pg_indexes
            WHERE schemaname = 'noorm' AND tablename = ${table} AND indexname = ${name}
        `.execute(db);

        return rows.length > 0;

    }

    if (dialect === 'mssql') {

        const { rows } = await sql`SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID(${qualified('mssql', table)}) AND name = ${name}`.execute(db);

        return rows.length > 0;

    }

    if (dialect === 'mysql') {

        const { rows } = await sql`
            SELECT 1 FROM information_schema.statistics
            WHERE table_schema = DATABASE() AND table_name = ${table} AND index_name = ${name}
        `.execute(db);

        return rows.length > 0;

    }

    const { rows } = await sql`SELECT 1 FROM sqlite_master WHERE type = 'index' AND tbl_name = ${table} AND name = ${name}`.execute(db);

    return rows.length > 0;

}

async function tableExists(db: Kysely<unknown>, dialect: Dialect, table: string): Promise<boolean> {

    if (dialect === 'postgres') {

        const { rows } = await sql`
            SELECT 1 FROM information_schema.tables WHERE table_schema = 'noorm' AND table_name = ${table}
        `.execute(db);

        return rows.length > 0;

    }

    if (dialect === 'mssql') {

        const { rows } = await sql`SELECT 1 FROM sys.tables WHERE object_id = OBJECT_ID(${qualified('mssql', table)})`.execute(db);

        return rows.length > 0;

    }

    if (dialect === 'mysql') {

        const { rows } = await sql`
            SELECT 1 FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = ${table}
        `.execute(db);

        return rows.length > 0;

    }

    const { rows } = await sql`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ${table}`.execute(db);

    return rows.length > 0;

}

async function nameKeyExists(db: Kysely<unknown>, dialect: Dialect, table: string): Promise<boolean> {

    if (dialect === 'mssql') {

        const { rows } = await sql`SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID(${qualified('mssql', table)}) AND name = 'name_key'`.execute(db);

        return rows.length > 0;

    }

    const { rows } = await sql`
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = DATABASE() AND table_name = ${table} AND column_name = 'name_key'
    `.execute(db);

    return rows.length > 0;

}

function addIdColumn<TB extends string, C extends string>(
    builder: CreateTableBuilder<TB, C>,
    dialect: Dialect,
): CreateTableBuilder<TB, C | 'id'> {

    if (dialect === 'postgres') return builder.addColumn('id', 'serial', (col) => col.primaryKey());
    if (dialect === 'mssql') return builder.addColumn('id', sql`int identity(1,1)`, (col) => col.primaryKey());

    return builder.addColumn('id', 'integer', (col) => col.primaryKey().autoIncrement());

}

export const v3: SchemaMigration = {
    version: 3,
    description: 'Create independent pipeline history tables',

    async up(db: Kysely<unknown>, dialect: Dialect): Promise<void> {

        await ensureRunTable(db, dialect);
        await ensureStepTable(db, dialect);

    },

    async down(db: Kysely<unknown>, dialect: Dialect): Promise<void> {

        const tables = getNoormTables(dialect);
        await db.schema.dropTable(qualified(dialect, tables.pipelineStep)).execute();
        await db.schema.dropTable(qualified(dialect, tables.pipelineRun)).execute();

    },
};

function qualified(dialect: Dialect, table: string): string {

    return dialect === 'postgres' || dialect === 'mssql' ? `noorm.${table}` : table;

}

async function ensureRunTable(db: Kysely<unknown>, dialect: Dialect): Promise<void> {

    const table = getNoormTables(dialect).pipelineRun;
    const run = qualified(dialect, table);

    if (!(await tableExists(db, dialect, table))) {

        await createRunTable(db, run, timestampType(dialect), dialect);

    }

    if (!(await indexExists(db, dialect, table, RUN_INDEX))) {

        if (dialect === 'mssql') {

            await sql`CREATE UNIQUE INDEX ${sql.id(RUN_INDEX)} ON ${sql.table(run)} (active_key) WHERE active_key IS NOT NULL`.execute(db);

        }
        else {

            await db.schema.createIndex(RUN_INDEX).unique().on(run).column('active_key').execute();

        }

    }

}

async function ensureStepTable(db: Kysely<unknown>, dialect: Dialect): Promise<void> {

    const tables = getNoormTables(dialect);
    const table = tables.pipelineStep;
    const step = qualified(dialect, table);

    if (!(await tableExists(db, dialect, table))) {

        await createStepTable(db, step, qualified(dialect, tables.pipelineRun), timestampType(dialect), dialect);

    }

    if (dialect === 'mysql' || dialect === 'mssql') {

        if (!(await nameKeyExists(db, dialect, table))) {

            await addNameKey(db, step, dialect);

        }

        if (!(await indexExists(db, dialect, table, STEP_INDEX))) {

            await db.schema.createIndex(STEP_INDEX).unique().on(step)
                .columns(['pipeline_run_id', 'name_key']).execute();

        }

    }

}

async function createRunTable(
    db: Kysely<unknown>,
    run: string,
    timestamp: ReturnType<typeof timestampType>,
    dialect: Dialect,
): Promise<void> {

    const boolean = dialect === 'mssql' ? sql`bit` : 'boolean';

    let runTable = addIdColumn(db.schema.createTable(run), dialect)
        .addColumn('slug', dialect === 'mssql' ? sql`nvarchar(255)` : 'varchar(255)', (col) => col.notNull())
        .addColumn('config_name', dialect === 'mssql' ? sql`nvarchar(255)` : 'varchar(255)', (col) => col.notNull())
        .addColumn('executed_by', dialect === 'mssql' ? sql`nvarchar(255)` : 'varchar(255)', (col) => col.notNull())
        .addColumn('cli_version', 'varchar(50)', (col) => col.notNull())
        .addColumn('created_at', timestamp, (col) => col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`))
        .addColumn('manifest_checksum', 'varchar(64)', (col) => col.notNull())
        .addColumn('transaction_policy', 'varchar(20)', (col) => col.notNull())
        .addColumn('single_run', boolean, (col) => col.notNull().defaultTo(dialect === 'postgres' ? sql`false` : sql`0`))
        .addColumn('status', 'varchar(20)', (col) => col.notNull())
        .addColumn('transaction_outcome', 'varchar(20)', (col) => col.notNull())
        .addColumn('started_at', timestamp)
        .addColumn('finished_at', timestamp)
        .addColumn('error_message', dialect === 'mssql' ? sql`nvarchar(2000)` : 'varchar(2000)', (col) => col.notNull().defaultTo(''))
        .addColumn('duration_ms', 'integer', (col) => col.notNull().defaultTo(0))
        .addColumn('active_key', 'varchar(64)');
    if (dialect === 'mysql') runTable = runTable.modifyEnd(sql`DEFAULT CHARACTER SET utf8mb4`);
    await runTable.execute();

}

async function createStepTable(
    db: Kysely<unknown>,
    step: string,
    run: string,
    timestamp: ReturnType<typeof timestampType>,
    dialect: Dialect,
): Promise<void> {

    let stepTable = db.schema.createTable(step)
        .addColumn('pipeline_run_id', 'integer', (col) => col.notNull())
        .addColumn('step_no', 'integer', (col) => col.notNull())
        .addColumn('name', dialect === 'mssql' ? sql`nvarchar(255)` : dialect === 'postgres' ? sql`varchar(255) COLLATE "C"` : 'varchar(255)', (col) => col.notNull())
        .addColumn('filepath', dialect === 'mssql' ? sql`nvarchar(500)` : 'varchar(500)', (col) => col.notNull())
        .addColumn('checksum', 'varchar(64)', (col) => col.notNull())
        .addColumn('needs', dialect === 'mssql' ? sql`nvarchar(max)` : 'text', (col) => col.notNull())
        .addColumn('status', 'varchar(20)', (col) => col.notNull())
        .addColumn('transaction_outcome', 'varchar(20)', (col) => col.notNull())
        .addColumn('started_at', timestamp)
        .addColumn('finished_at', timestamp)
        .addColumn('error_message', dialect === 'mssql' ? sql`nvarchar(2000)` : 'varchar(2000)', (col) => col.notNull().defaultTo(''))
        .addColumn('skip_reason', dialect === 'mssql' ? sql`nvarchar(255)` : 'varchar(255)', (col) => col.notNull().defaultTo(''))
        .addColumn('duration_ms', 'integer', (col) => col.notNull().defaultTo(0))
        .addPrimaryKeyConstraint('pk_pipeline_step', ['pipeline_run_id', 'step_no'])
        .addForeignKeyConstraint('fk_pipeline_step_run', ['pipeline_run_id'], run, ['id'], (constraint) => constraint.onDelete('cascade'));

    if (dialect === 'mysql') stepTable = stepTable.modifyEnd(sql`DEFAULT CHARACTER SET utf8mb4`);
    if (dialect === 'postgres' || dialect === 'sqlite') {

        stepTable = stepTable.addUniqueConstraint('uq_pipeline_step_run_name', ['pipeline_run_id', 'name']);

    }
    await stepTable.execute();

}

async function addNameKey(db: Kysely<unknown>, step: string, dialect: Dialect): Promise<void> {

    if (dialect === 'mysql') {

        await sql`ALTER TABLE ${sql.table(step)} ADD COLUMN name_key VARBINARY(1020) GENERATED ALWAYS AS (CAST(name AS BINARY)) STORED`.execute(db);

        return;

    }

    // A nonzero terminator prevents binary zero-padding from aliasing labels.
    await sql`ALTER TABLE ${sql.table(step)} ADD name_key AS (CONVERT(VARBINARY(510), name) + 0x01) PERSISTED`.execute(db);

}
