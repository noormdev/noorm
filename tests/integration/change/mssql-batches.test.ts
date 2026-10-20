/**
 * Integration test: change files with `GO` batch separators on live SQL Server.
 *
 * `GO` is a client-side directive, not T-SQL, so the change executor has to
 * split it as the runner does for `sql/` files. Drives `ChangeManager`'s
 * public API and asks the server itself which tables exist.
 *
 * Requires the docker-compose.test.yml SQL Server container (11433); skips
 * itself when unreachable.
 */
import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { mkdtemp, rm, mkdir, writeFile } from 'fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Kysely, sql } from 'kysely';

import { attempt } from '@logosdx/utils';

import { ChangeManager } from '../../../src/core/change/manager.js';
import { migrateSchema } from '../../../src/core/version/schema/index.js';
import { getNoormTables, noormDb } from '../../../src/core/shared/index.js';
import { resetLockManager } from '../../../src/core/lock/index.js';
import type { NoormDatabase } from '../../../src/core/shared/index.js';
import type { ConnectionResult } from '../../../src/core/connection/types.js';
import type { ChangeContext } from '../../../src/core/change/types.js';

import { createTestConnection, isContainerRunning } from '../../utils/db.js';

const CONFIG_NAME = '__change_mssql_batches__';
const FIRST_TABLE = 'noorm_it_batch_first';
const SECOND_TABLE = 'noorm_it_batch_second';
const OK_CHANGE = '2026-01-01-mssql-batches';
const BAD_CHANGE = '2026-01-02-mssql-bad-batch';

describe('change: GO batches on live mssql', () => {

    let conn: ConnectionResult | null = null;
    let reachable = false;
    let tempDir: string;
    let changesDir: string;
    let sqlDir: string;

    beforeAll(async () => {

        reachable = await isContainerRunning('mssql');

        if (!reachable) return;

        resetLockManager();

        conn = await createTestConnection('mssql');

        await migrateSchema(conn.db as unknown as Kysely<NoormDatabase>, 'mssql');

        tempDir = await mkdtemp(join(tmpdir(), 'noorm-mssql-change-'));
        changesDir = join(tempDir, 'changes');
        sqlDir = join(tempDir, 'sql');

        await mkdir(join(changesDir, OK_CHANGE, 'change'), { recursive: true });
        await mkdir(join(changesDir, BAD_CHANGE, 'change'), { recursive: true });
        await mkdir(sqlDir, { recursive: true });

        await writeFile(
            join(changesDir, OK_CHANGE, 'change', '001_two_tables.sql'),
            `CREATE TABLE ${FIRST_TABLE} (id INT PRIMARY KEY)\nGO\nCREATE TABLE ${SECOND_TABLE} (id INT PRIMARY KEY)\nGO\n`,
        );
        await writeFile(
            join(changesDir, BAD_CHANGE, 'change', '001_bad_second_batch.sql'),
            'SELECT 1\nGO\nSELECT * FROM noorm_it_no_such_table\nGO\n',
        );

    });

    afterAll(async () => {

        if (!conn) return;

        const db = conn.db as unknown as Kysely<NoormDatabase>;
        const tables = getNoormTables('mssql');

        await attempt(() => sql.raw(`DROP TABLE IF EXISTS ${FIRST_TABLE}`).execute(db));
        await attempt(() => sql.raw(`DROP TABLE IF EXISTS ${SECOND_TABLE}`).execute(db));

        // Child rows first — executions carries an FK to change.
        await attempt(() =>
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (noormDb(db, 'mssql') as any)
                .deleteFrom(tables.executions)
                .where('change_id', 'in',
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    (noormDb(db, 'mssql') as any)
                        .selectFrom(tables.change)
                        .select('id')
                        .where('config_name', '=', CONFIG_NAME),
                )
                .execute(),
        );

        await attempt(() =>
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (noormDb(db, 'mssql') as any)
                .deleteFrom(tables.change)
                .where('config_name', '=', CONFIG_NAME)
                .execute(),
        );

        await conn.destroy();
        await rm(tempDir, { recursive: true, force: true });

        resetLockManager();

    });

    function buildContext(): ChangeContext {

        return {
            db: conn!.db as unknown as Kysely<NoormDatabase>,
            configName: CONFIG_NAME,
            identity: { name: 'Test User', email: 'test@example.com', source: 'config' },
            projectRoot: tempDir,
            changesDir,
            sqlDir,
            access: { user: 'admin', agent: 'admin' },
            channel: 'user',
            dialect: 'mssql',
        };

    }

    async function tableExists(name: string): Promise<boolean> {

        const db = conn!.db as unknown as Kysely<NoormDatabase>;

        const rows = await sql<{ c: number }>`
            SELECT COUNT(*) AS c FROM sys.tables WHERE name = ${name}
        `.execute(db);

        return Number(rows.rows[0]?.c ?? 0) > 0;

    }

    it('should run every GO-separated batch of a change file', async () => {

        if (!reachable) {

            console.warn('Skipping mssql: container not reachable');

            return;

        }

        const manager = new ChangeManager(buildContext());
        const result = await manager.run(OK_CHANGE);

        expect(result.error ?? null).toBeNull();
        expect(result.status).toBe('success');
        expect(await tableExists(FIRST_TABLE)).toBe(true);
        expect(await tableExists(SECOND_TABLE)).toBe(true);

    });

    it('should name the batch that failed', async () => {

        if (!reachable) return;

        const manager = new ChangeManager(buildContext());
        const result = await manager.run(BAD_CHANGE);

        expect(result.status).toBe('failed');
        expect(result.error).toContain('[batch 2 of 2]');

    });

});
