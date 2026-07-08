/**
 * Integration test: MSSQL `GO` batch splitter end-to-end through `coreRunFile`.
 *
 * Writes a temp SQL file containing two `CREATE PROCEDURE` statements
 * separated by `GO`, runs it via the runner against a real MSSQL container,
 * and verifies both procedures exist in `sys.procedures`. Without the GO
 * splitter this would fail at the first `CREATE PROCEDURE` because tedious
 * rejects bare `GO`.
 *
 * Requires the docker-compose.test.yml MSSQL container on port 11433.
 * Skips with a clear message when the container is unreachable.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'bun:test';
import { sql, type Kysely } from 'kysely';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { attempt } from '@logosdx/utils';

import { runFile as coreRunFile } from '../../../src/core/runner/index.js';
import type { RunContext } from '../../../src/core/runner/index.js';
import { migrateSchema } from '../../../src/core/version/schema/index.js';
import type { NoormDatabase } from '../../../src/core/shared/tables.js';

import {
    createTestConnection,
    skipIfNoContainer,
} from '../../utils/db.js';


/**
 * Tear down MSSQL noorm tracking tables and any leftover test procedures.
 *
 * Used between tests so each one starts from a known-clean state. Covers both
 * the legacy `__noorm_*__` prefixed tables (v1 schema) and the `noorm.*`
 * schema-qualified tables (v2+ schema, which is what MSSQL uses today).
 */
async function cleanupMssql(db: Kysely<unknown>, procNames: string[]): Promise<void> {

    // Drop test procedures (best-effort)
    for (const name of procNames) {

        await attempt(() =>
            sql.raw(`IF OBJECT_ID('${name}', 'P') IS NOT NULL DROP PROCEDURE ${name}`).execute(db),
        );

    }

    // Drop FK constraints on ALL noorm tracking tables (any schema)
    const [fks] = await attempt(async () => {

        const { rows } = await sql<{ fk_name: string; schema_name: string; table_name: string }>`
            SELECT fk.name AS fk_name, s.name AS schema_name, t.name AS table_name
            FROM sys.foreign_keys fk
            JOIN sys.tables t ON fk.parent_object_id = t.object_id
            JOIN sys.schemas s ON t.schema_id = s.schema_id
            WHERE s.name = 'noorm' OR t.name LIKE '__noorm_%'
        `.execute(db);

        return rows;

    });

    if (fks) {

        for (const { fk_name, schema_name, table_name } of fks) {

            await attempt(() =>
                sql.raw(`ALTER TABLE [${schema_name}].[${table_name}] DROP CONSTRAINT [${fk_name}]`).execute(db),
            );

        }

    }

    // Drop legacy prefixed tables (v1)
    for (const table of [
        '__noorm_vault__',
        '__noorm_identities__',
        '__noorm_lock__',
        '__noorm_executions__',
        '__noorm_change__',
        '__noorm_version__',
    ]) {

        await attempt(() =>
            sql.raw(`IF OBJECT_ID('${table}', 'U') IS NOT NULL DROP TABLE [${table}]`).execute(db),
        );

    }

    // Drop schema-qualified tables (v2+)
    for (const table of [
        'vault',
        'identities',
        'lock',
        'executions',
        'change',
        'version',
    ]) {

        await attempt(() =>
            sql.raw(`IF OBJECT_ID('noorm.${table}', 'U') IS NOT NULL DROP TABLE [noorm].[${table}]`).execute(db),
        );

    }

    // Drop the noorm schema itself (so migrateSchema can re-create it cleanly)
    await attempt(() =>
        sql.raw('IF SCHEMA_ID(\'noorm\') IS NOT NULL DROP SCHEMA noorm').execute(db),
    );

}


describe('integration: mssql runner GO batch splitter', () => {

    let db: Kysely<unknown>;
    let destroy: () => Promise<void>;
    let tempDir: string;

    const procA = 'noorm_test_proc_a';
    const procB = 'noorm_test_proc_b';

    beforeAll(async () => {

        await skipIfNoContainer('mssql');

        const conn = await createTestConnection('mssql');
        db = conn.db;
        destroy = conn.destroy;

        tempDir = await mkdtemp(join(tmpdir(), 'noorm-mssql-batches-'));

    }, 30_000);

    afterAll(async () => {

        if (destroy) {

            await cleanupMssql(db, [procA, procB]);
            await destroy();

        }

        if (tempDir) {

            await rm(tempDir, { recursive: true, force: true });

        }

    });

    beforeEach(async () => {

        await cleanupMssql(db, [procA, procB]);

        // Re-create the noorm tracking schema (runs all migrations: v1 + v2 rename)
        await migrateSchema(db as Kysely<NoormDatabase>, 'mssql');

    });

    it('should execute a two-procedure file split by GO', async () => {

        const filepath = join(tempDir, 'two-procs.sql');
        const sqlContent = [
            `CREATE PROCEDURE ${procA}`,
            'AS',
            'BEGIN',
            '    SET NOCOUNT ON;',
            '    SELECT 1 AS one;',
            'END',
            'GO',
            `CREATE PROCEDURE ${procB}`,
            'AS',
            'BEGIN',
            '    SET NOCOUNT ON;',
            '    SELECT 2 AS two;',
            'END',
            'GO',
        ].join('\n');

        await writeFile(filepath, sqlContent, 'utf-8');

        const context: RunContext = {
            db: db as Kysely<NoormDatabase>,
            configName: 'integration-test',
            identity: { name: 'test', email: 'test@example.com', source: 'config' },
            projectRoot: tempDir,
            access: { user: 'admin', mcp: 'admin' },
            channel: 'user',
            dialect: 'mssql',
        };

        const result = await coreRunFile(context, filepath);

        expect(result.status).toBe('success');
        expect(result.error).toBeUndefined();

        // Verify both procedures exist
        const { rows } = await sql<{ name: string }>`
            SELECT name FROM sys.procedures
            WHERE name IN (${procA}, ${procB})
            ORDER BY name
        `.execute(db);

        expect(rows).toHaveLength(2);
        expect(rows.map((r) => r.name).sort()).toEqual([procA, procB].sort());

    }, 30_000);

    it('should report batch index when a middle batch fails', async () => {

        // Three batches; middle one references a non-existent table → MSSQL deferred name resolution
        // would normally allow CREATE PROC bodies, so we use direct DDL that fails immediately.
        const filepath = join(tempDir, 'failing-batch.sql');
        const sqlContent = [
            `CREATE PROCEDURE ${procA}`,
            'AS',
            'BEGIN',
            '    SET NOCOUNT ON;',
            '    SELECT 1 AS one;',
            'END',
            'GO',
            // This batch has a syntax error MSSQL catches at parse time
            'CREATE PROCEDURE THIS IS NOT VALID',
            'GO',
            `CREATE PROCEDURE ${procB}`,
            'AS',
            'BEGIN',
            '    SET NOCOUNT ON;',
            '    SELECT 2 AS two;',
            'END',
        ].join('\n');

        await writeFile(filepath, sqlContent, 'utf-8');

        const context: RunContext = {
            db: db as Kysely<NoormDatabase>,
            configName: 'integration-test',
            identity: { name: 'test', email: 'test@example.com', source: 'config' },
            projectRoot: tempDir,
            access: { user: 'admin', mcp: 'admin' },
            channel: 'user',
            dialect: 'mssql',
        };

        const result = await coreRunFile(context, filepath);

        expect(result.status).toBe('failed');
        expect(result.error).toContain('[batch 2 of 3]');

        // First proc was created; third must NOT have been
        const { rows } = await sql<{ name: string }>`
            SELECT name FROM sys.procedures
            WHERE name IN (${procA}, ${procB})
            ORDER BY name
        `.execute(db);

        const names = rows.map((r) => r.name);

        expect(names).toContain(procA);
        expect(names).not.toContain(procB);

    }, 30_000);

});
