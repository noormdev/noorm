import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { sql, type Kysely } from 'kysely';

import { v3 } from '../../../src/core/version/schema/migrations/v3.js';
import { getNoormTables } from '../../../src/core/shared/tables.js';
import type { Dialect } from '../../../src/core/connection/types.js';
import { createTestConnection, skipIfNoContainer } from '../../utils/db.js';

const dialects: Dialect[] = ['postgres', 'mysql', 'mssql'];

for (const dialect of dialects) {

    describe(`integration: ${dialect} schema v3 retry`, () => {

        let db: Kysely<unknown>;
        let destroy: () => Promise<void>;
        const tables = getNoormTables(dialect);
        const prefix = dialect === 'mysql' ? '' : 'noorm.';
        const run = `${prefix}${tables.pipelineRun}`;
        const step = `${prefix}${tables.pipelineStep}`;

        async function dropPipelineTables(): Promise<void> {

            await sql`DROP TABLE IF EXISTS ${sql.table(step)}`.execute(db);
            await sql`DROP TABLE IF EXISTS ${sql.table(run)}`.execute(db);

        }

        async function catalogIndexes(table: string, name: string): Promise<unknown[]> {

            if (dialect === 'postgres') {

                const { rows } = await sql`
                    SELECT indexname FROM pg_indexes
                    WHERE schemaname = 'noorm' AND tablename = ${table} AND indexname = ${name}
                `.execute(db);

                return rows;

            }

            if (dialect === 'mysql') {

                const { rows } = await sql`
                    SELECT DISTINCT index_name FROM information_schema.statistics
                    WHERE table_schema = DATABASE() AND table_name = ${table} AND index_name = ${name}
                `.execute(db);

                return rows;

            }

            const { rows } = await sql`
                SELECT i.name FROM sys.indexes i
                JOIN sys.tables t ON t.object_id = i.object_id
                JOIN sys.schemas s ON s.schema_id = t.schema_id
                WHERE s.name = 'noorm' AND t.name = ${table} AND i.name = ${name}
            `.execute(db);

            return rows;

        }

        async function expectComplete(): Promise<void> {

            await sql`SELECT active_key FROM ${sql.table(run)}`.execute(db);
            await sql`SELECT pipeline_run_id FROM ${sql.table(step)}`.execute(db);
            expect(await catalogIndexes(tables.pipelineRun, 'idx_pipeline_run_active_key')).toHaveLength(1);
            expect(await catalogIndexes(tables.pipelineStep, 'uq_pipeline_step_run_name')).toHaveLength(1);

        }

        beforeAll(async () => {

            await skipIfNoContainer(dialect);

            const conn = await createTestConnection(dialect);
            db = conn.db;
            destroy = conn.destroy;

            if (dialect === 'postgres') await sql`CREATE SCHEMA IF NOT EXISTS noorm`.execute(db);
            if (dialect === 'mssql') await sql`IF SCHEMA_ID('noorm') IS NULL EXEC('CREATE SCHEMA noorm')`.execute(db);

            await dropPipelineTables();

        }, 30_000);

        afterAll(async () => {

            if (destroy) {

                await dropPipelineTables();
                await destroy();

            }

        });

        it('should succeed when run twice', async () => {

            await v3.up(db, dialect);
            await v3.up(db, dialect);
            await expectComplete();

        });

        it('should finish after a run that left the tables without the run index', async () => {

            await dropPipelineTables();
            await v3.up(db, dialect);
            if (dialect === 'postgres') await sql`DROP INDEX noorm.idx_pipeline_run_active_key`.execute(db);
            else await sql`DROP INDEX idx_pipeline_run_active_key ON ${sql.table(run)}`.execute(db);

            await v3.up(db, dialect);
            await expectComplete();

        });

        it('should finish after a run that left only the run table', async () => {

            await dropPipelineTables();
            await v3.up(db, dialect);
            await sql`DROP TABLE ${sql.table(step)}`.execute(db);

            await v3.up(db, dialect);
            await expectComplete();

        });

        if (dialect !== 'postgres') {

            it('should finish after a run that left the step table without name_key', async () => {

                await dropPipelineTables();
                await v3.up(db, dialect);
                await sql`DROP INDEX uq_pipeline_step_run_name ON ${sql.table(step)}`.execute(db);
                await sql`ALTER TABLE ${sql.table(step)} DROP COLUMN name_key`.execute(db);

                await v3.up(db, dialect);
                await expectComplete();

                const { rows } = await sql`SELECT name_key FROM ${sql.table(step)}`.execute(db);

                expect(rows).toHaveLength(0);

            });

        }

    });

}
