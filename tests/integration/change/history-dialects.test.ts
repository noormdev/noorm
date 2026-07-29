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
import type { NoormDatabase } from '../../../src/core/shared/index.js';
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

        });

    }

});
