/**
 * Integration test: `ChangeHistory` id-retrieval against every live dialect.
 *
 * `ChangeHistory` carries its own copy of the insert-and-get-id logic,
 * independent of `Tracker`'s (`src/core/runner/tracker.ts`). Fixing the
 * runner's MySQL path therefore did nothing for the change module, and
 * every `tests/core/change` file constructs `ChangeHistory` with
 * `'sqlite'` — the one dialect where `RETURNING` happens to work. MySQL
 * has no `RETURNING` clause at all, so `change run`, `change ff`,
 * `change revert` and `db teardown` were all inoperable there while the
 * suite stayed green.
 *
 * Asserts the contract rather than the SQL: whatever strategy a dialect
 * needs, these methods must hand back a usable primary key that child
 * rows can reference. Anything else means no operation record exists.
 *
 * `latestFileExecutions` is here for the same reason: its `MAX(id) GROUP BY`
 * subquery join is dialect SQL that the sqlite unit tests cannot vouch for.
 *
 * Requires the docker-compose.test.yml containers (postgres 15432,
 * mysql 13306, mssql 11433). Each dialect skips itself when unreachable.
 */
import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { Kysely, SqliteDialect } from 'kysely';

import { attempt } from '@logosdx/utils';

import { BunSqliteDatabase } from '../../../src/core/connection/dialects/sqlite-bun.js';
import { ChangeHistory } from '../../../src/core/change/history.js';
import { migrateSchema } from '../../../src/core/version/schema/index.js';
import { v1 } from '../../../src/core/version/schema/migrations/v1.js';
import { getNoormTables, noormDb } from '../../../src/core/shared/index.js';
import type { Direction, ExecutionStatus, NoormDatabase } from '../../../src/core/shared/index.js';
import type { Dialect } from '../../../src/core/connection/types.js';
import type { ConnectionResult } from '../../../src/core/connection/types.js';

import { createTestConnection, isContainerRunning } from '../../utils/db.js';

const LIVE_DIALECTS: Dialect[] = ['postgres', 'mysql', 'mssql'];

const CONFIG_NAME = '__change_history_dialects__';

describe('change: history id retrieval across dialects', () => {

    it('should return a usable operation id on sqlite', async () => {

        const db = new Kysely<NoormDatabase>({
            dialect: new SqliteDialect({
                database: new BunSqliteDatabase(':memory:') as never,
            }),
        });

        await v1.up(db as Kysely<unknown>, 'sqlite');

        const id = await new ChangeHistory(db, CONFIG_NAME, 'sqlite').createOperation({
            name: 'change:sqlite',
            direction: 'change',
            executedBy: 'test@example.com',
        });

        expect(typeof id).toBe('number');
        expect(id).toBeGreaterThan(0);

        await db.destroy();

    });

    for (const dialect of LIVE_DIALECTS) {

        describe(dialect, () => {

            let conn: ConnectionResult | null = null;
            let reachable = false;

            beforeAll(async () => {

                reachable = await isContainerRunning(dialect);

                if (!reachable) return;

                conn = await createTestConnection(dialect);

                await migrateSchema(conn.db as unknown as Kysely<NoormDatabase>, dialect);

            });

            afterAll(async () => {

                if (!conn) return;

                const db = conn.db as unknown as Kysely<NoormDatabase>;
                const tables = getNoormTables(dialect);

                // Child rows first — executions carries an FK to change.
                await attempt(() =>
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    (noormDb(db, dialect) as any)
                        .deleteFrom(tables.executions)
                        .where('change_id', 'in',
                            // eslint-disable-next-line @typescript-eslint/no-explicit-any
                            (noormDb(db, dialect) as any)
                                .selectFrom(tables.change)
                                .select('id')
                                .where('config_name', '=', CONFIG_NAME),
                        )
                        .execute(),
                );

                await attempt(() =>
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    (noormDb(db, dialect) as any)
                        .deleteFrom(tables.change)
                        .where('config_name', '=', CONFIG_NAME)
                        .execute(),
                );

                await conn.destroy();

            });

            it('should return an operation id that child rows can reference', async () => {

                if (!reachable) {

                    console.warn(`Skipping ${dialect}: container not reachable`);

                    return;

                }

                const db = conn!.db as unknown as Kysely<NoormDatabase>;
                const history = new ChangeHistory(db, CONFIG_NAME, dialect);

                const [id, err] = await attempt(() =>
                    history.createOperation({
                        name: `change:${dialect}:${Date.now()}`,
                        direction: 'change',
                        executedBy: 'test@example.com',
                    }),
                );

                expect(err?.message ?? null).toBeNull();
                expect(typeof id).toBe('number');
                expect(id!).toBeGreaterThan(0);

                // A fabricated id would satisfy the assertions above but fail
                // the FK — the point of the id is that child rows can use it.
                const recordsErr = await history.createFileRecords(id!, [
                    { filepath: 'changes/001.sql', fileType: 'sql', checksum: 'abc123' },
                ]);

                expect(recordsErr).toBeNull();

            });

            it('should return a usable id when recording a teardown', async () => {

                if (!reachable) {

                    console.warn(`Skipping ${dialect}: container not reachable`);

                    return;

                }

                const db = conn!.db as unknown as Kysely<NoormDatabase>;
                const history = new ChangeHistory(db, CONFIG_NAME, dialect);

                // recordReset swallows its error and returns 0, so a zero id
                // is exactly the silent failure this asserts against.
                const id = await history.recordReset('test@example.com', 'integration test');

                expect(typeof id).toBe('number');
                expect(id).toBeGreaterThan(0);

            });

            it('should return the newest standing row per file of one change', async () => {

                if (!reachable) {

                    console.warn(`Skipping ${dialect}: container not reachable`);

                    return;

                }

                const db = conn!.db as unknown as Kysely<NoormDatabase>;
                const history = new ChangeHistory(db, CONFIG_NAME, dialect);
                const name = `change:latest:${dialect}:${Date.now()}`;
                const fileA = `changes/${name}/change/001_a.sql`;
                const fileB = `changes/${name}/change/002_b.sql`;

                async function record(
                    changeName: string,
                    direction: Direction,
                    rows: Array<{ filepath: string; checksum: string; status: ExecutionStatus }>,
                ): Promise<void> {

                    const opId = await history.createOperation({ name: changeName, direction, executedBy: 'test@example.com' });

                    await history.createFileRecords(opId, rows.map((row) => ({ ...row, fileType: 'sql' })));

                    for (const row of rows) {

                        await history.updateFileExecution(opId, row.filepath, row.status, 5);

                    }

                    await history.finalizeOperation(opId, 'success', `${changeName}:checksum`, 5);

                }

                await record(name, 'change', [
                    { filepath: fileA, checksum: 'a-old', status: 'success' },
                    { filepath: fileB, checksum: 'b-only', status: 'success' },
                ]);
                await record(name, 'change', [
                    { filepath: fileA, checksum: 'a-new', status: 'failed' },
                    { filepath: fileB, checksum: 'b-unreached', status: 'skipped' },
                ]);
                await record(`${name}:other`, 'change', [{ filepath: fileA, checksum: 'a-other', status: 'success' }]);

                const [latest, err] = await history.latestFileExecutions(name, 'change');

                expect(err).toBeNull();
                expect(latest!.size).toBe(2);
                expect(latest!.get(fileA)).toEqual({ checksum: 'a-new', exec_status: 'failed' });
                expect(latest!.get(fileB)).toEqual({ checksum: 'b-only', exec_status: 'success' });

                await record(name, 'revert', [{ filepath: `changes/${name}/revert/001_a.sql`, checksum: 'r', status: 'success' }]);

                const [afterRevert, revertErr] = await history.latestFileExecutions(name, 'change');

                expect(revertErr).toBeNull();
                expect(afterRevert!.size).toBe(0);

            });

        });

    }

});
