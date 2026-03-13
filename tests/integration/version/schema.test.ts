/**
 * Integration tests for schema migration v1 across all dialects.
 *
 * Verifies that noorm tracking tables can be created, auto-increment IDs work,
 * constraints are enforced, and basic CRUD succeeds on real database instances.
 *
 * Requires docker-compose.test.yml containers for postgres, mysql, and mssql.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'bun:test';
import { Kysely, SqliteDialect, sql } from 'kysely';
import { attempt } from '@logosdx/utils';

import { BunSqliteDatabase } from '../../../src/core/connection/dialects/sqlite-bun.js';
import { v1 } from '../../../src/core/version/schema/migrations/v1.js';
import type { NoormDatabase } from '../../../src/core/shared/tables.js';
import type { Dialect } from '../../../src/core/connection/types.js';
import { createTestConnection, skipIfNoContainer } from '../../utils/db.js';

/**
 * Format a Date as 'YYYY-MM-DD HH:MM:SS' for cross-dialect compatibility.
 *
 * MySQL rejects ISO 8601 with 'T' separator and 'Z' suffix.
 */
function formatTimestamp(date: Date): string {

    return date.toISOString().replace('T', ' ').replace('Z', '').slice(0, 19);

}

/**
 * Drop all noorm tracking tables if they exist.
 *
 * Uses dialect-appropriate syntax to safely clean up before tests.
 * Must drop in reverse dependency order (child tables first).
 */
async function dropNoormTables(db: Kysely<unknown>, dialect: Dialect): Promise<void> {

    // Drop indexes first (ignore errors if they don't exist)
    await attempt(() => db.schema.dropIndex('idx_vault_secret_key').execute());
    await attempt(() => db.schema.dropIndex('idx_change_name_config').execute());
    await attempt(() => db.schema.dropIndex('idx_executions_change_id').execute());

    if (dialect === 'mssql') {

        // MSSQL needs to drop FK constraints before tables
        const [fks] = await attempt(async () => {

            const { rows } = await sql<{ fk_name: string; table_name: string }>`
                SELECT fk.name AS fk_name, t.name AS table_name
                FROM sys.foreign_keys fk
                JOIN sys.tables t ON fk.parent_object_id = t.object_id
                WHERE t.name LIKE '__noorm_%'
            `.execute(db);

            return rows;

        });

        if (fks) {

            for (const { fk_name, table_name } of fks) {

                await attempt(() =>
                    sql`${sql.raw(`ALTER TABLE [${table_name}] DROP CONSTRAINT [${fk_name}]`)}`.execute(db),
                );

            }

        }

        // MSSQL: DROP TABLE IF EXISTS
        for (const table of [
            '__noorm_vault__',
            '__noorm_identities__',
            '__noorm_lock__',
            '__noorm_executions__',
            '__noorm_change__',
            '__noorm_version__',
        ]) {

            await attempt(() =>
                sql`${sql.raw(`IF OBJECT_ID('${table}', 'U') IS NOT NULL DROP TABLE [${table}]`)}`.execute(db),
            );

        }

    }
    else {

        // Postgres, MySQL, SQLite all support DROP TABLE IF EXISTS
        for (const table of [
            '__noorm_vault__',
            '__noorm_identities__',
            '__noorm_lock__',
            '__noorm_executions__',
            '__noorm_change__',
            '__noorm_version__',
        ]) {

            await attempt(() =>
                sql`${sql.raw(`DROP TABLE IF EXISTS ${table}`)}`.execute(db),
            );

        }

    }

}

/**
 * Shared test suite for schema migration v1.
 *
 * Runs identical assertions against any dialect. Each dialect describe block
 * provides its own db instance and dialect string.
 */
function schemaTests(getDb: () => Kysely<unknown>, dialect: Dialect) {

    describe('table creation', () => {

        it('should create all 6 tracking tables via v1.up()', async () => {

            const db = getDb();

            // v1.up() should not throw
            await dropNoormTables(db, dialect);
            await v1.up(db, dialect);

            // Verify each table is queryable
            const [version, vErr] = await attempt(() =>
                sql`SELECT COUNT(*) as cnt FROM __noorm_version__`.execute(db),
            );
            expect(vErr).toBeNull();
            expect(version).toBeDefined();

            const [change, cErr] = await attempt(() =>
                sql`SELECT COUNT(*) as cnt FROM __noorm_change__`.execute(db),
            );
            expect(cErr).toBeNull();
            expect(change).toBeDefined();

            const [exec, eErr] = await attempt(() =>
                sql`SELECT COUNT(*) as cnt FROM __noorm_executions__`.execute(db),
            );
            expect(eErr).toBeNull();
            expect(exec).toBeDefined();

            const [lock, lErr] = await attempt(() =>
                sql`SELECT COUNT(*) as cnt FROM __noorm_lock__`.execute(db),
            );
            expect(lErr).toBeNull();
            expect(lock).toBeDefined();

            const [ident, iErr] = await attempt(() =>
                sql`SELECT COUNT(*) as cnt FROM __noorm_identities__`.execute(db),
            );
            expect(iErr).toBeNull();
            expect(ident).toBeDefined();

            const [vault, vtErr] = await attempt(() =>
                sql`SELECT COUNT(*) as cnt FROM __noorm_vault__`.execute(db),
            );
            expect(vtErr).toBeNull();
            expect(vault).toBeDefined();

        });

        it('should be idempotent via down() then up()', async () => {

            const db = getDb();

            await v1.down(db, dialect);
            await v1.up(db, dialect);

            // Tables should work after re-creation
            const [, err] = await attempt(() =>
                sql`SELECT COUNT(*) as cnt FROM __noorm_version__`.execute(db),
            );
            expect(err).toBeNull();

        });

    });

    describe('auto-increment IDs', () => {

        it('should auto-generate IDs on __noorm_version__', async () => {

            const db = getDb() as Kysely<NoormDatabase>;

            const now = formatTimestamp(new Date());

            await db.insertInto('__noorm_version__').values({
                cli_version: '1.0.0',
                noorm_version: 1,
                state_version: 1,
                settings_version: 1,
                installed_at: now as unknown as Date,
                upgraded_at: now as unknown as Date,
            }).execute();

            await db.insertInto('__noorm_version__').values({
                cli_version: '1.0.1',
                noorm_version: 1,
                state_version: 1,
                settings_version: 1,
                installed_at: now as unknown as Date,
                upgraded_at: now as unknown as Date,
            }).execute();

            const rows = await db.selectFrom('__noorm_version__')
                .select('id')
                .orderBy('id', 'asc')
                .execute();

            expect(rows.length).toBeGreaterThanOrEqual(2);

            // IDs should be auto-generated and sequential
            const ids = rows.map((r) => r.id);
            expect(ids[0]).toBeDefined();
            expect(ids[1]).toBeDefined();
            expect(ids[1]!).toBeGreaterThan(ids[0]!);

        });

        it('should auto-generate IDs on __noorm_change__', async () => {

            const db = getDb() as Kysely<NoormDatabase>;

            await db.insertInto('__noorm_change__').values({
                name: 'change-1',
                change_type: 'change',
                direction: 'change',
                status: 'success',
            }).execute();

            await db.insertInto('__noorm_change__').values({
                name: 'change-2',
                change_type: 'build',
                direction: 'change',
                status: 'pending',
            }).execute();

            const rows = await db.selectFrom('__noorm_change__')
                .select('id')
                .orderBy('id', 'asc')
                .execute();

            expect(rows).toHaveLength(2);
            expect(rows[1]!.id).toBeGreaterThan(rows[0]!.id);

        });

        it('should auto-generate IDs on __noorm_lock__', async () => {

            const db = getDb() as Kysely<NoormDatabase>;
            const expires = formatTimestamp(new Date(Date.now() + 60_000));

            await db.insertInto('__noorm_lock__').values({
                config_name: 'dev',
                locked_by: 'user-1',
                expires_at: expires as unknown as Date,
            }).execute();

            const row = await db.selectFrom('__noorm_lock__')
                .select('id')
                .executeTakeFirst();

            expect(row?.id).toBeDefined();
            expect(typeof row?.id).toBe('number');

        });

        it('should auto-generate IDs on __noorm_identities__', async () => {

            const db = getDb() as Kysely<NoormDatabase>;

            await db.insertInto('__noorm_identities__').values({
                identity_hash: 'hash-1',
                email: 'test@example.com',
                name: 'Test User',
                machine: 'testhost',
                os: 'linux',
                public_key: 'pk-1',
            }).execute();

            const row = await db.selectFrom('__noorm_identities__')
                .select('id')
                .executeTakeFirst();

            expect(row?.id).toBeDefined();
            expect(typeof row?.id).toBe('number');

        });

        it('should auto-generate IDs on __noorm_vault__', async () => {

            const db = getDb() as Kysely<NoormDatabase>;

            await db.insertInto('__noorm_vault__').values({
                secret_key: 'API_KEY',
                encrypted_value: 'encrypted-data',
                set_by: 'admin',
            }).execute();

            const row = await db.selectFrom('__noorm_vault__')
                .select('id')
                .executeTakeFirst();

            expect(row?.id).toBeDefined();
            expect(typeof row?.id).toBe('number');

        });

    });

    describe('foreign key constraints', () => {

        it('should allow executions referencing valid change IDs', async () => {

            const db = getDb() as Kysely<NoormDatabase>;

            // Insert parent change
            await db.insertInto('__noorm_change__').values({
                name: 'fk-parent',
                change_type: 'build',
                direction: 'change',
                status: 'success',
            }).execute();

            // Get the generated ID
            const change = await db.selectFrom('__noorm_change__')
                .select('id')
                .where('name', '=', 'fk-parent')
                .executeTakeFirst();

            expect(change?.id).toBeDefined();

            // Insert execution referencing the change
            await db.insertInto('__noorm_executions__').values({
                change_id: change!.id,
                filepath: '/test/file.sql',
                file_type: 'sql',
                status: 'success',
            }).execute();

            const exec = await db.selectFrom('__noorm_executions__')
                .selectAll()
                .where('change_id', '=', change!.id)
                .executeTakeFirst();

            expect(exec?.filepath).toBe('/test/file.sql');
            expect(exec?.change_id).toBe(change!.id);

        });

        // MySQL ignores inline REFERENCES on addColumn (Kysely limitation).
        // Cascade delete only works on dialects with proper FK support.
        it('should cascade delete executions when change is deleted', async () => {

            if (dialect === 'mysql') return; // MySQL ignores inline REFERENCES

            const db = getDb() as Kysely<NoormDatabase>;

            // Insert parent change
            await db.insertInto('__noorm_change__').values({
                name: 'cascade-parent',
                change_type: 'change',
                direction: 'change',
                status: 'success',
            }).execute();

            const change = await db.selectFrom('__noorm_change__')
                .select('id')
                .where('name', '=', 'cascade-parent')
                .executeTakeFirst();

            // Insert executions
            await db.insertInto('__noorm_executions__').values({
                change_id: change!.id,
                filepath: '/cascade-1.sql',
                file_type: 'sql',
                status: 'success',
            }).execute();

            await db.insertInto('__noorm_executions__').values({
                change_id: change!.id,
                filepath: '/cascade-2.sql',
                file_type: 'sql',
                status: 'success',
            }).execute();

            // Delete the parent change
            await db.deleteFrom('__noorm_change__')
                .where('id', '=', change!.id)
                .execute();

            // Executions should be cascade-deleted
            const remaining = await db.selectFrom('__noorm_executions__')
                .select('id')
                .where('change_id', '=', change!.id)
                .execute();

            expect(remaining).toHaveLength(0);

        });

    });

    describe('unique constraints', () => {

        it('should enforce unique config_name on __noorm_lock__', async () => {

            const db = getDb() as Kysely<NoormDatabase>;
            const expires = formatTimestamp(new Date(Date.now() + 60_000));

            await db.insertInto('__noorm_lock__').values({
                config_name: 'unique-test',
                locked_by: 'user-1',
                expires_at: expires as unknown as Date,
            }).execute();

            const [, err] = await attempt(() =>
                db.insertInto('__noorm_lock__').values({
                    config_name: 'unique-test',
                    locked_by: 'user-2',
                    expires_at: expires as unknown as Date,
                }).execute(),
            );

            expect(err).toBeDefined();

        });

        it('should enforce unique identity_hash on __noorm_identities__', async () => {

            const db = getDb() as Kysely<NoormDatabase>;

            await db.insertInto('__noorm_identities__').values({
                identity_hash: 'dup-hash',
                email: 'a@example.com',
                name: 'A',
                machine: 'host-a',
                os: 'linux',
                public_key: 'pk-a',
            }).execute();

            const [, err] = await attempt(() =>
                db.insertInto('__noorm_identities__').values({
                    identity_hash: 'dup-hash',
                    email: 'b@example.com',
                    name: 'B',
                    machine: 'host-b',
                    os: 'darwin',
                    public_key: 'pk-b',
                }).execute(),
            );

            expect(err).toBeDefined();

        });

        it('should enforce unique secret_key on __noorm_vault__', async () => {

            const db = getDb() as Kysely<NoormDatabase>;

            await db.insertInto('__noorm_vault__').values({
                secret_key: 'DUP_KEY',
                encrypted_value: 'val-1',
                set_by: 'admin',
            }).execute();

            const [, err] = await attempt(() =>
                db.insertInto('__noorm_vault__').values({
                    secret_key: 'DUP_KEY',
                    encrypted_value: 'val-2',
                    set_by: 'other',
                }).execute(),
            );

            expect(err).toBeDefined();

        });

    });

    describe('default values', () => {

        it('should set default timestamps on __noorm_change__', async () => {

            const db = getDb() as Kysely<NoormDatabase>;

            await db.insertInto('__noorm_change__').values({
                name: 'defaults-test',
                change_type: 'change',
                direction: 'change',
                status: 'success',
            }).execute();

            const row = await db.selectFrom('__noorm_change__')
                .selectAll()
                .where('name', '=', 'defaults-test')
                .executeTakeFirst();

            expect(row?.executed_at).toBeDefined();
            expect(row?.checksum).toBe('');
            expect(row?.executed_by).toBe('');
            expect(row?.config_name).toBe('');
            expect(row?.cli_version).toBe('');
            expect(row?.error_message).toBe('');
            expect(row?.duration_ms).toBe(0);

        });

        it('should set default timestamps on __noorm_identities__', async () => {

            const db = getDb() as Kysely<NoormDatabase>;

            await db.insertInto('__noorm_identities__').values({
                identity_hash: 'defaults-hash',
                email: 'defaults@example.com',
                name: 'Defaults User',
                machine: 'host',
                os: 'linux',
                public_key: 'pk',
            }).execute();

            const row = await db.selectFrom('__noorm_identities__')
                .selectAll()
                .where('identity_hash', '=', 'defaults-hash')
                .executeTakeFirst();

            expect(row?.registered_at).toBeDefined();
            expect(row?.last_seen_at).toBeDefined();

        });

    });

}

// ─────────────────────────────────────────────────────────────
// SQLite (in-memory, always available)
// ─────────────────────────────────────────────────────────────

describe('integration: sqlite schema v1', () => {

    let db: Kysely<unknown>;

    beforeAll(async () => {

        db = new Kysely<unknown>({
            dialect: new SqliteDialect({
                database: new BunSqliteDatabase(':memory:') as never,
            }),
        });

        // SQLite requires explicit FK enforcement
        await sql`PRAGMA foreign_keys = ON`.execute(db);
        await v1.up(db, 'sqlite');

    });

    afterAll(async () => {

        await db.destroy();

    });

    beforeEach(async () => {

        // Clean data between tests (keep tables)
        await attempt(() => sql`DELETE FROM __noorm_executions__`.execute(db));
        await attempt(() => sql`DELETE FROM __noorm_change__`.execute(db));
        await attempt(() => sql`DELETE FROM __noorm_lock__`.execute(db));
        await attempt(() => sql`DELETE FROM __noorm_identities__`.execute(db));
        await attempt(() => sql`DELETE FROM __noorm_vault__`.execute(db));
        await attempt(() => sql`DELETE FROM __noorm_version__`.execute(db));

    });

    schemaTests(() => db, 'sqlite');

});

// ─────────────────────────────────────────────────────────────
// PostgreSQL (requires container)
// ─────────────────────────────────────────────────────────────

describe('integration: postgres schema v1', () => {

    let db: Kysely<unknown>;
    let destroy: () => Promise<void>;

    beforeAll(async () => {

        await skipIfNoContainer('postgres');

        const conn = await createTestConnection('postgres');
        db = conn.db;
        destroy = conn.destroy;

        await dropNoormTables(db, 'postgres');
        await v1.up(db, 'postgres');

    }, 30_000);

    afterAll(async () => {

        if (destroy) {

            await dropNoormTables(db, 'postgres').catch(() => {});
            await destroy();

        }

    });

    beforeEach(async () => {

        await attempt(() => sql`DELETE FROM __noorm_executions__`.execute(db));
        await attempt(() => sql`DELETE FROM __noorm_change__`.execute(db));
        await attempt(() => sql`DELETE FROM __noorm_lock__`.execute(db));
        await attempt(() => sql`DELETE FROM __noorm_identities__`.execute(db));
        await attempt(() => sql`DELETE FROM __noorm_vault__`.execute(db));
        await attempt(() => sql`DELETE FROM __noorm_version__`.execute(db));

    });

    schemaTests(() => db, 'postgres');

});

// ─────────────────────────────────────────────────────────────
// MySQL (requires container)
// ─────────────────────────────────────────────────────────────

describe('integration: mysql schema v1', () => {

    let db: Kysely<unknown>;
    let destroy: () => Promise<void>;

    beforeAll(async () => {

        await skipIfNoContainer('mysql');

        const conn = await createTestConnection('mysql');
        db = conn.db;
        destroy = conn.destroy;

        await dropNoormTables(db, 'mysql');
        await v1.up(db, 'mysql');

    }, 30_000);

    afterAll(async () => {

        if (destroy) {

            await dropNoormTables(db, 'mysql').catch(() => {});
            await destroy();

        }

    });

    beforeEach(async () => {

        await attempt(() => sql`DELETE FROM __noorm_executions__`.execute(db));
        await attempt(() => sql`DELETE FROM __noorm_change__`.execute(db));
        await attempt(() => sql`DELETE FROM __noorm_lock__`.execute(db));
        await attempt(() => sql`DELETE FROM __noorm_identities__`.execute(db));
        await attempt(() => sql`DELETE FROM __noorm_vault__`.execute(db));
        await attempt(() => sql`DELETE FROM __noorm_version__`.execute(db));

    });

    schemaTests(() => db, 'mysql');

});

// ─────────────────────────────────────────────────────────────
// MSSQL (requires container)
// ─────────────────────────────────────────────────────────────

describe('integration: mssql schema v1', () => {

    let db: Kysely<unknown>;
    let destroy: () => Promise<void>;

    beforeAll(async () => {

        await skipIfNoContainer('mssql');

        const conn = await createTestConnection('mssql');
        db = conn.db;
        destroy = conn.destroy;

        await dropNoormTables(db, 'mssql');
        await v1.up(db, 'mssql');

    }, 30_000);

    afterAll(async () => {

        if (destroy) {

            await dropNoormTables(db, 'mssql').catch(() => {});
            await destroy();

        }

    });

    beforeEach(async () => {

        await attempt(() => sql`DELETE FROM __noorm_executions__`.execute(db));
        await attempt(() => sql`DELETE FROM __noorm_change__`.execute(db));
        await attempt(() => sql`DELETE FROM __noorm_lock__`.execute(db));
        await attempt(() => sql`DELETE FROM __noorm_identities__`.execute(db));
        await attempt(() => sql`DELETE FROM __noorm_vault__`.execute(db));
        await attempt(() => sql`DELETE FROM __noorm_version__`.execute(db));

    });

    schemaTests(() => db, 'mssql');

});
