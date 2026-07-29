/**
 * Debug operations tests.
 *
 * `core/debug` reads and deletes rows in noorm's own bookkeeping tables —
 * including `vault` and `identities` — and nothing authorized those deletes.
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import {
    DummyDriver,
    Kysely,
    MssqlAdapter,
    MssqlIntrospector,
    MssqlQueryCompiler,
    MysqlAdapter,
    MysqlIntrospector,
    MysqlQueryCompiler,
    PostgresAdapter,
    PostgresIntrospector,
    PostgresQueryCompiler,
    SqliteAdapter,
    SqliteDialect,
    SqliteIntrospector,
    SqliteQueryCompiler,
} from 'kysely';
import { attempt } from '@logosdx/utils';

import { BunSqliteDatabase } from '../../../src/core/connection/dialects/sqlite-bun.js';
import { createDebugOperations, type DebugPolicyContext } from '../../../src/core/debug/index.js';
import { NOORM_TABLES, type NoormDatabase } from '../../../src/core/shared/index.js';
import { v1 } from '../../../src/core/version/schema/migrations/v1.js';
import type { Dialect } from '../../../src/core/connection/types.js';
import { observer } from '../../../src/core/observer.js';

// ─────────────────────────────────────────────────────────────
// Fixtures
// ─────────────────────────────────────────────────────────────

const ADMIN: DebugPolicyContext = {
    channel: 'user',
    config: { name: 'test', access: { user: 'admin', mcp: 'admin' } },
};

const OPERATOR: DebugPolicyContext = {
    channel: 'user',
    config: { name: 'test', access: { user: 'operator', mcp: 'operator' } },
};

const VIEWER: DebugPolicyContext = {
    channel: 'user',
    config: { name: 'test', access: { user: 'viewer', mcp: 'viewer' } },
};

const NO_ACCESS: DebugPolicyContext = {
    channel: 'user',
    config: { name: 'test' },
};

const MCP_ADMIN: DebugPolicyContext = {
    channel: 'mcp',
    config: { name: 'test', access: { user: 'admin', mcp: 'admin' } },
};

/**
 * A live in-memory SQLite database with noorm's v1 schema.
 */
async function createTestDb(): Promise<Kysely<NoormDatabase>> {

    const db = new Kysely<NoormDatabase>({
        dialect: new SqliteDialect({
            database: new BunSqliteDatabase(':memory:') as never,
        }),
    });

    await v1.up(db as Kysely<unknown>, 'sqlite');

    return db;

}

/**
 * A compile-only Kysely for a dialect, capturing every emitted statement.
 *
 * `resolveTable`'s prefixed-to-schema mapping is only observable in the SQL
 * text, and pg/mssql are not reachable from a unit test — so drive the real
 * dialect compiler through `DummyDriver` and read the statements back.
 */
function createRecordingDb(dialect: Dialect): { db: Kysely<NoormDatabase>; sql: string[] } {

    const sql: string[] = [];

    const adapters = {
        postgres: () => ({ a: new PostgresAdapter(), c: new PostgresQueryCompiler(), i: PostgresIntrospector }),
        mssql: () => ({ a: new MssqlAdapter(), c: new MssqlQueryCompiler(), i: MssqlIntrospector }),
        mysql: () => ({ a: new MysqlAdapter(), c: new MysqlQueryCompiler(), i: MysqlIntrospector }),
        sqlite: () => ({ a: new SqliteAdapter(), c: new SqliteQueryCompiler(), i: SqliteIntrospector }),
    } as const;

    const picked = adapters[dialect as keyof typeof adapters]();

    const db = new Kysely<NoormDatabase>({
        dialect: {
            createAdapter: () => picked.a,
            createDriver: () => new DummyDriver(),
            createQueryCompiler: () => picked.c,
            createIntrospector: (d: Kysely<NoormDatabase>) => new picked.i(d),
        },
        log: (event) => {

            sql.push(event.query.sql);

        },
    });

    return { db, sql };

}

/**
 * Seed n vault rows and return their ids.
 */
async function seedVault(db: Kysely<NoormDatabase>, n: number): Promise<number[]> {

    const ids: number[] = [];

    for (let i = 0; i < n; i++) {

        const row = await db.insertInto(NOORM_TABLES.vault)
            .values({
                secret_key: `KEY_${i}`,
                encrypted_value: `enc_${i}`,
                set_by: 'seed',
            })
            .returningAll()
            .executeTakeFirstOrThrow();

        ids.push(row.id);

    }

    return ids;

}

// ─────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────

describe('debug: createDebugOperations', () => {

    let db: Kysely<NoormDatabase>;
    let savedYes: string | undefined;

    beforeEach(async () => {

        // checkPolicy collapses `confirm` to `allow` under NOORM_YES; pin it off
        // so the admin/confirm cell is exercised as itself.
        savedYes = process.env['NOORM_YES'];
        delete process.env['NOORM_YES'];

        db = await createTestDb();

    });

    afterEach(async () => {

        if (savedYes === undefined) delete process.env['NOORM_YES'];
        else process.env['NOORM_YES'] = savedYes;

        await db.destroy();

    });

    describe('policy', () => {

        it('should deny deleteRowById to a viewer', async () => {

            const ids = await seedVault(db, 1);
            const ops = createDebugOperations(db, 'sqlite', VIEWER);

            const [, err] = await attempt(() => ops.deleteRowById(NOORM_TABLES.vault, ids[0]!));

            expect(err).toBeInstanceOf(Error);
            expect(err?.message).toContain('debug:write');

            const survivors = await db.selectFrom(NOORM_TABLES.vault).selectAll().execute();

            expect(survivors).toHaveLength(1);

        });

        it('should deny deleteRowById to an operator', async () => {

            const ids = await seedVault(db, 1);
            const ops = createDebugOperations(db, 'sqlite', OPERATOR);

            const [, err] = await attempt(() => ops.deleteRowById(NOORM_TABLES.vault, ids[0]!));

            expect(err).toBeInstanceOf(Error);

            const survivors = await db.selectFrom(NOORM_TABLES.vault).selectAll().execute();

            expect(survivors).toHaveLength(1);

        });

        it('should deny deleteRowsByIds to a viewer before touching the database', async () => {

            const ids = await seedVault(db, 3);
            const ops = createDebugOperations(db, 'sqlite', VIEWER);

            const [, err] = await attempt(() => ops.deleteRowsByIds(NOORM_TABLES.identities, ids));

            expect(err).toBeInstanceOf(Error);

            const survivors = await db.selectFrom(NOORM_TABLES.vault).selectAll().execute();

            expect(survivors).toHaveLength(3);

        });

        it('should deny an empty-id bulk delete rather than short-circuit past the gate', async () => {

            const ops = createDebugOperations(db, 'sqlite', VIEWER);

            const [, err] = await attempt(() => ops.deleteRowsByIds(NOORM_TABLES.vault, []));

            expect(err).toBeInstanceOf(Error);

        });

        it('should allow deleteRowById for an admin', async () => {

            const ids = await seedVault(db, 1);
            const ops = createDebugOperations(db, 'sqlite', ADMIN);

            expect(await ops.deleteRowById(NOORM_TABLES.vault, ids[0]!)).toBe(true);

            const survivors = await db.selectFrom(NOORM_TABLES.vault).selectAll().execute();

            expect(survivors).toHaveLength(0);

        });

        it('should deny writes on the mcp channel even for an admin role', async () => {

            const ids = await seedVault(db, 1);
            const ops = createDebugOperations(db, 'sqlite', MCP_ADMIN);

            const [, err] = await attempt(() => ops.deleteRowById(NOORM_TABLES.vault, ids[0]!));

            expect(err).toBeInstanceOf(Error);

            const survivors = await db.selectFrom(NOORM_TABLES.vault).selectAll().execute();

            expect(survivors).toHaveLength(1);

        });

        it('should fail closed when the config carries no access', async () => {

            await seedVault(db, 1);
            const ops = createDebugOperations(db, 'sqlite', NO_ACCESS);

            const [, readErr] = await attempt(() => ops.getTableRows(NOORM_TABLES.vault));
            const [, writeErr] = await attempt(() => ops.deleteRowById(NOORM_TABLES.vault, 1));

            expect(readErr).toBeInstanceOf(Error);
            expect(writeErr).toBeInstanceOf(Error);

        });

        it('should allow reads for every role', async () => {

            await seedVault(db, 2);

            for (const policy of [VIEWER, OPERATOR, ADMIN]) {

                const ops = createDebugOperations(db, 'sqlite', policy);

                expect(await ops.getTableRows(NOORM_TABLES.vault)).toHaveLength(2);
                expect(await ops.getTableCounts()).not.toHaveLength(0);

            }

        });

    });

    describe('resolveTable', () => {

        it('should map prefixed names onto the noorm schema for postgres', async () => {

            const { db: rec, sql } = createRecordingDb('postgres');
            const ops = createDebugOperations(rec, 'postgres', ADMIN);

            await ops.getTableRows(NOORM_TABLES.vault);

            expect(sql[0]).toContain('"noorm"."vault"');
            expect(sql[0]).not.toContain('__noorm_vault__');

            await rec.destroy();

        });

        it('should map prefixed names onto the noorm schema for mssql', async () => {

            const { db: rec, sql } = createRecordingDb('mssql');
            const ops = createDebugOperations(rec, 'mssql', ADMIN);

            await ops.getRowById(NOORM_TABLES.identities, 1);

            expect(sql[0]).toContain('"noorm"."identities"');
            expect(sql[0]).not.toContain('__noorm_identities__');

            await rec.destroy();

        });

        it('should keep prefixed names for mysql and sqlite', async () => {

            for (const dialect of ['mysql', 'sqlite'] as const) {

                const { db: rec, sql } = createRecordingDb(dialect);
                const ops = createDebugOperations(rec, dialect, ADMIN);

                await ops.getTableRows(NOORM_TABLES.change);

                expect(sql[0]).toContain('__noorm_change__');
                expect(sql[0]).not.toContain('noorm.change');

                await rec.destroy();

            }

        });

        it('should route deletes through the schema-qualified name on postgres', async () => {

            const { db: rec, sql } = createRecordingDb('postgres');
            const ops = createDebugOperations(rec, 'postgres', ADMIN);

            await ops.deleteRowsByIds(NOORM_TABLES.vault, [1, 2, 3]);

            expect(sql[0]).toContain('delete from "noorm"."vault"');

        });

    });

    describe('getTableColumns', () => {

        it('should return the column list for a known table', () => {

            const ops = createDebugOperations(db, 'sqlite', ADMIN);

            expect(ops.getTableColumns(NOORM_TABLES.vault)).toContain('secret_key');

        });

    });

    describe('getTableRows', () => {

        it('should honour limit and sort direction', async () => {

            await seedVault(db, 5);
            const ops = createDebugOperations(db, 'sqlite', ADMIN);

            const desc = await ops.getTableRows(NOORM_TABLES.vault, { limit: 2 });
            const asc = await ops.getTableRows(NOORM_TABLES.vault, { limit: 2, sortDirection: 'asc' });

            expect(desc).toHaveLength(2);
            expect(desc[0]!['secret_key']).toBe('KEY_4');
            expect(asc[0]!['secret_key']).toBe('KEY_0');

        });

        it('should emit an error event when the query fails', async () => {

            const ops = createDebugOperations(db, 'sqlite', ADMIN);
            const events: unknown[] = [];
            const off = observer.on('error', (data) => {

                events.push(data);

            });

            await db.schema.dropTable(NOORM_TABLES.vault).execute();
            await attempt(() => ops.getTableRows(NOORM_TABLES.vault));

            off();

            expect(events).toHaveLength(1);

        });

    });

    describe('getRowById', () => {

        it('should return null for a row that does not exist', async () => {

            const ops = createDebugOperations(db, 'sqlite', ADMIN);

            expect(await ops.getRowById(NOORM_TABLES.vault, 9999)).toBeNull();

        });

    });

    describe('deleteRowById', () => {

        it('should return false when the row does not exist', async () => {

            const ops = createDebugOperations(db, 'sqlite', ADMIN);

            expect(await ops.deleteRowById(NOORM_TABLES.vault, 9999)).toBe(false);

        });

    });

    describe('deleteRowsByIds', () => {

        it('should delete exactly the listed ids', async () => {

            const ids = await seedVault(db, 5);
            const ops = createDebugOperations(db, 'sqlite', ADMIN);

            const deleted = await ops.deleteRowsByIds(NOORM_TABLES.vault, [ids[0]!, ids[2]!, ids[4]!]);

            expect(deleted).toBe(3);

            const survivors = await db.selectFrom(NOORM_TABLES.vault).select('id').execute();

            expect(survivors.map((r) => r.id).sort()).toEqual([ids[1]!, ids[3]!].sort());

        });

        it('should count only ids that existed', async () => {

            const ids = await seedVault(db, 2);
            const ops = createDebugOperations(db, 'sqlite', ADMIN);

            expect(await ops.deleteRowsByIds(NOORM_TABLES.vault, [ids[0]!, 9998, 9999])).toBe(1);

        });

        it('should return 0 for an empty id list without issuing a statement', async () => {

            const { db: rec, sql } = createRecordingDb('postgres');
            const ops = createDebugOperations(rec, 'postgres', ADMIN);

            expect(await ops.deleteRowsByIds(NOORM_TABLES.vault, [])).toBe(0);
            expect(sql).toHaveLength(0);

        });

    });

    describe('getTableCounts', () => {

        it('should count every noorm table', async () => {

            await seedVault(db, 3);
            const ops = createDebugOperations(db, 'sqlite', ADMIN);

            const counts = await ops.getTableCounts();
            const vault = counts.find((c) => c.table === NOORM_TABLES.vault);

            expect(counts).toHaveLength(6);
            expect(vault?.count).toBe(3);
            expect(vault?.error).toBeUndefined();

        });

    });

});
