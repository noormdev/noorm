/**
 * Integration test: `Tracker.createOperation` against every live dialect.
 *
 * `createOperation` is the first database write of every build, run, change
 * and revert — nothing executes if it fails. Until this file existed the
 * whole test tree constructed `Tracker` exactly once, with `'sqlite'`
 * (`tests/core/runner/tracker.test.ts`), so the id-retrieval strategy was
 * only ever exercised on the one dialect where `RETURNING` happens to work.
 * MySQL has no `RETURNING` clause at all and the runner was inoperable there
 * — zero files executed — while the suite stayed green.
 *
 * The assertion is deliberately about the *contract* rather than the SQL:
 * whatever strategy a dialect needs, `createOperation` must hand back a
 * usable primary key that later rows can reference. Anything else means the
 * operation record was never created.
 *
 * `latestExecutions` is here for the same reason: its `MAX(id) GROUP BY`
 * subquery join is dialect SQL that the sqlite unit tests cannot vouch for.
 *
 * Requires the docker-compose.test.yml containers (postgres 15432,
 * mysql 13306, mssql 11433). Each dialect skips itself when unreachable.
 */
import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { Kysely, SqliteDialect } from 'kysely';

import { attempt } from '@logosdx/utils';

import { BunSqliteDatabase } from '../../../src/core/connection/dialects/sqlite-bun.js';
import { Tracker } from '../../../src/core/runner/tracker.js';
import { migrateSchema } from '../../../src/core/version/schema/index.js';
import { v1 } from '../../../src/core/version/schema/migrations/v1.js';
import { getNoormTables, noormDb } from '../../../src/core/shared/index.js';
import type { NoormDatabase } from '../../../src/core/shared/index.js';
import type { Dialect } from '../../../src/core/connection/types.js';
import type { ConnectionResult } from '../../../src/core/connection/types.js';

import { createTestConnection, isContainerRunning } from '../../utils/db.js';

const LIVE_DIALECTS: Dialect[] = ['postgres', 'mysql', 'mssql'];

const CONFIG_NAME = '__tracker_dialects__';
const OTHER_CONFIG_NAME = '__tracker_dialects_other__';

describe('runner: tracker across dialects', () => {

    it('should return a usable operation id on sqlite', async () => {

        const db = new Kysely<NoormDatabase>({
            dialect: new SqliteDialect({
                database: new BunSqliteDatabase(':memory:') as never,
            }),
        });

        await v1.up(db as Kysely<unknown>, 'sqlite');

        const id = await new Tracker(db, CONFIG_NAME, 'sqlite').createOperation({
            name: 'build:sqlite',
            changeType: 'build',
            configName: CONFIG_NAME,
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
                                .where('config_name', 'in', [CONFIG_NAME, OTHER_CONFIG_NAME]),
                        )
                        .execute(),
                );

                await attempt(() =>
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    (noormDb(db, dialect) as any)
                        .deleteFrom(tables.change)
                        .where('config_name', 'in', [CONFIG_NAME, OTHER_CONFIG_NAME])
                        .execute(),
                );

                await conn.destroy();

            });

            it('should return a usable operation id that child rows can reference', async () => {

                if (!reachable) {

                    console.warn(`Skipping ${dialect}: container not reachable`);

                    return;

                }

                const db = conn!.db as unknown as Kysely<NoormDatabase>;
                const tracker = new Tracker(db, CONFIG_NAME, dialect);

                const [id, err] = await attempt(() =>
                    tracker.createOperation({
                        name: `build:${dialect}:${Date.now()}`,
                        changeType: 'build',
                        configName: CONFIG_NAME,
                        executedBy: 'test@example.com',
                    }),
                );

                expect(err?.message ?? null).toBeNull();
                expect(typeof id).toBe('number');
                expect(id!).toBeGreaterThan(0);

                // A fabricated id would satisfy the assertions above but fail
                // the FK — the point of the id is that child rows can use it.
                const recordsErr = await tracker.createFileRecords(id!, [
                    { filepath: 'sql/001.sql', fileType: 'sql', checksum: 'abc123' },
                ]);

                expect(recordsErr).toBeNull();

            });

            it('should return the newest execution per filepath for its own config only', async () => {

                if (!reachable) {

                    console.warn(`Skipping ${dialect}: container not reachable`);

                    return;

                }

                const db = conn!.db as unknown as Kysely<NoormDatabase>;
                const tracker = new Tracker(db, CONFIG_NAME, dialect);
                const otherTracker = new Tracker(db, OTHER_CONFIG_NAME, dialect);
                const run = Date.now();
                const fileA = `sql/latest-a-${run}.sql`;
                const fileB = `sql/latest-b-${run}.sql`;

                async function record(
                    target: Tracker,
                    configName: string,
                    rows: Array<{ filepath: string; checksum: string }>,
                    status: 'success' | 'failed',
                ): Promise<void> {

                    const opId = await target.createOperation({
                        name: `build:${dialect}:${run}`,
                        changeType: 'build',
                        configName,
                        executedBy: 'test@example.com',
                    });

                    await target.createFileRecords(opId, rows.map((row) => ({ ...row, fileType: 'sql' })));

                    for (const row of rows) {

                        await target.updateFileExecution(opId, row.filepath, status, 5);

                    }

                }

                await record(tracker, CONFIG_NAME, [
                    { filepath: fileA, checksum: 'a-old' },
                    { filepath: fileB, checksum: 'b-only' },
                ], 'success');
                await record(tracker, CONFIG_NAME, [{ filepath: fileA, checksum: 'a-new' }], 'failed');
                await record(otherTracker, OTHER_CONFIG_NAME, [{ filepath: fileA, checksum: 'a-other' }], 'success');

                const [latest, err] = await tracker.latestExecutions();

                expect(err).toBeNull();
                expect(latest!.get(fileA)).toMatchObject({ checksum: 'a-new', exec_status: 'failed' });
                expect(latest!.get(fileB)).toMatchObject({ checksum: 'b-only', exec_status: 'success' });

            });

        });

    }

});
