/**
 * Integration test: the change lifecycle end to end on live MySQL.
 *
 * Every `tests/core/change` file runs on in-memory SQLite, so the whole
 * module's behaviour on a server dialect was unverified. MySQL turned out
 * to be entirely inoperable — `ChangeHistory.createOperation` used a
 * `RETURNING` clause MySQL does not have, so no operation record was ever
 * created and no change could run.
 *
 * Drives `ChangeManager`'s public API rather than the history internals,
 * so it also pins the apply -> revert -> re-apply cycle on a dialect where
 * that path had never executed.
 *
 * Requires the docker-compose.test.yml MySQL container (13306); skips
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

const CONFIG_NAME = '__change_mysql_lifecycle__';
const TABLE = 'noorm_it_change_probe';
const CHANGE_NAME = '2026-01-01-mysql-probe';

describe('change: lifecycle on live mysql', () => {

    let conn: ConnectionResult | null = null;
    let reachable = false;
    let tempDir: string;
    let changesDir: string;
    let sqlDir: string;

    beforeAll(async () => {

        reachable = await isContainerRunning('mysql');

        if (!reachable) return;

        resetLockManager();

        conn = await createTestConnection('mysql');

        await migrateSchema(conn.db as unknown as Kysely<NoormDatabase>, 'mysql');

        tempDir = await mkdtemp(join(tmpdir(), 'noorm-mysql-change-'));
        changesDir = join(tempDir, 'changes');
        sqlDir = join(tempDir, 'sql');

        await mkdir(join(changesDir, CHANGE_NAME, 'change'), { recursive: true });
        await mkdir(join(changesDir, CHANGE_NAME, 'revert'), { recursive: true });
        await mkdir(sqlDir, { recursive: true });

        await writeFile(
            join(changesDir, CHANGE_NAME, 'change', '001_create.sql'),
            `CREATE TABLE ${TABLE} (id INT PRIMARY KEY)`,
        );
        await writeFile(
            join(changesDir, CHANGE_NAME, 'revert', '001_drop.sql'),
            `DROP TABLE ${TABLE}`,
        );

    });

    afterAll(async () => {

        if (!conn) return;

        const db = conn.db as unknown as Kysely<NoormDatabase>;
        const tables = getNoormTables('mysql');

        await attempt(() => sql.raw(`DROP TABLE IF EXISTS ${TABLE}`).execute(db));

        // Child rows first — executions carries an FK to change.
        await attempt(() =>
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (noormDb(db, 'mysql') as any)
                .deleteFrom(tables.executions)
                .where('change_id', 'in',
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    (noormDb(db, 'mysql') as any)
                        .selectFrom(tables.change)
                        .select('id')
                        .where('config_name', '=', CONFIG_NAME),
                )
                .execute(),
        );

        await attempt(() =>
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (noormDb(db, 'mysql') as any)
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
            access: { user: 'admin', mcp: 'admin' },
            channel: 'user',
            dialect: 'mysql',
        };

    }

    async function tableExists(): Promise<boolean> {

        const db = conn!.db as unknown as Kysely<NoormDatabase>;

        const rows = await sql<{ c: number }>`
            SELECT COUNT(*) AS c FROM information_schema.tables
            WHERE table_schema = DATABASE() AND table_name = ${TABLE}
        `.execute(db);

        return Number(rows.rows[0]?.c ?? 0) > 0;

    }

    it('should apply, revert and re-apply a change against mysql', async () => {

        if (!reachable) {

            console.warn('Skipping mysql: container not reachable');

            return;

        }

        const manager = new ChangeManager(buildContext());

        const applied = await manager.run(CHANGE_NAME);

        expect(applied.error ?? null).toBeNull();
        expect(applied.status).toBe('success');
        expect(await tableExists()).toBe(true);

        const reverted = await manager.revert(CHANGE_NAME);

        expect(reverted.status).toBe('success');
        expect(await tableExists()).toBe(false);

        // The re-apply path is what the sqlite-only suite could never reach
        // on a server dialect.
        const reapplied = await manager.run(CHANGE_NAME);

        expect(reapplied.status).toBe('success');
        expect(await tableExists()).toBe(true);

    });

});
