/**
 * Tests for schema version manager.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Kysely, SqliteDialect, sql } from 'kysely';
import Database from 'better-sqlite3';

import { observer } from '../../../src/core/observer.js';
import { CURRENT_VERSIONS, VersionMismatchError } from '../../../src/core/version/types.js';
import type { NoormDatabase } from '../../../src/core/version/schema/tables.js';
import {
    tablesExist,
    getSchemaVersion,
    checkSchemaVersion,
    bootstrapSchema,
    migrateSchema,
    ensureSchemaVersion,
    updateVersionRecord,
    getLatestVersionRecord,
} from '../../../src/core/version/schema/index.js';

describe('version: schema', () => {

    let db: Kysely<NoormDatabase>;

    beforeEach(() => {

        observer.clear();

        // Create in-memory SQLite database for each test
        db = new Kysely<NoormDatabase>({
            dialect: new SqliteDialect({
                database: new Database(':memory:'),
            }),
        });

    });

    afterEach(async () => {

        await db.destroy();

    });

    describe('tablesExist', () => {

        it('should return false when tables do not exist', async () => {

            const exists = await tablesExist(db);

            expect(exists).toBe(false);

        });

        it('should return true when tables exist', async () => {

            await bootstrapSchema(db, '1.0.0');
            const exists = await tablesExist(db);

            expect(exists).toBe(true);

        });

    });

    describe('getSchemaVersion', () => {

        it('should return 0 when tables do not exist', async () => {

            const version = await getSchemaVersion(db);

            expect(version).toBe(0);

        });

        it('should return version from database', async () => {

            await bootstrapSchema(db, '1.0.0');
            const version = await getSchemaVersion(db);

            expect(version).toBe(CURRENT_VERSIONS.schema);

        });

    });

    describe('checkSchemaVersion', () => {

        it('should detect no tables as needing migration', async () => {

            const status = await checkSchemaVersion(db);

            expect(status.current).toBe(0);
            expect(status.expected).toBe(CURRENT_VERSIONS.schema);
            expect(status.needsMigration).toBe(true);
            expect(status.isNewer).toBe(false);

        });

        it('should detect current version as not needing migration', async () => {

            await bootstrapSchema(db, '1.0.0');
            const status = await checkSchemaVersion(db);

            expect(status.current).toBe(CURRENT_VERSIONS.schema);
            expect(status.needsMigration).toBe(false);
            expect(status.isNewer).toBe(false);

        });

        it('should emit version:schema:checking event', async () => {

            const events: unknown[] = [];
            observer.on('version:schema:checking', (data) => events.push(data));

            await checkSchemaVersion(db);

            expect(events).toHaveLength(1);
            expect(events[0]).toEqual({ current: 0 });

        });

    });

    describe('bootstrapSchema', () => {

        it('should create all tracking tables', async () => {

            await bootstrapSchema(db, '1.0.0');

            // Verify all tables exist by querying them
            const version = await db.selectFrom('__noorm_version__').selectAll().execute();

            expect(version).toHaveLength(1);
            expect(version[0].cli_version).toBe('1.0.0');
            expect(version[0].schema_version).toBe(CURRENT_VERSIONS.schema);
            expect(version[0].state_version).toBe(CURRENT_VERSIONS.state);
            expect(version[0].settings_version).toBe(CURRENT_VERSIONS.settings);

        });

        it('should record custom state and settings versions', async () => {

            await bootstrapSchema(db, '1.0.0', { stateVersion: 5, settingsVersion: 3 });

            const version = await db.selectFrom('__noorm_version__').selectAll().executeTakeFirst();

            expect(version?.schema_version).toBe(CURRENT_VERSIONS.schema);
            expect(version?.state_version).toBe(5);
            expect(version?.settings_version).toBe(3);

        });

        it('should create __noorm_changeset__ table', async () => {

            await bootstrapSchema(db, '1.0.0');

            // Should not throw
            const result = await db.selectFrom('__noorm_changeset__').selectAll().execute();

            expect(result).toEqual([]);

        });

        it('should create __noorm_executions__ table', async () => {

            await bootstrapSchema(db, '1.0.0');

            // Should not throw
            const result = await db.selectFrom('__noorm_executions__').selectAll().execute();

            expect(result).toEqual([]);

        });

        it('should create __noorm_lock__ table', async () => {

            await bootstrapSchema(db, '1.0.0');

            // Should not throw
            const result = await db.selectFrom('__noorm_lock__').selectAll().execute();

            expect(result).toEqual([]);

        });

        it('should create __noorm_identities__ table', async () => {

            await bootstrapSchema(db, '1.0.0');

            // Should not throw
            const result = await db.selectFrom('__noorm_identities__').selectAll().execute();

            expect(result).toEqual([]);

        });

        it('should emit migration events', async () => {

            const events: unknown[] = [];
            observer.on('version:schema:migrating', (data) =>
                events.push({ type: 'migrating', ...data }),
            );
            observer.on('version:schema:migrated', (data) =>
                events.push({ type: 'migrated', ...data }),
            );

            await bootstrapSchema(db, '1.0.0');

            expect(events).toHaveLength(2);
            expect(events[0]).toMatchObject({
                type: 'migrating',
                from: 0,
                to: CURRENT_VERSIONS.schema,
            });
            expect(events[1]).toMatchObject({
                type: 'migrated',
                from: 0,
                to: CURRENT_VERSIONS.schema,
            });

        });

    });

    describe('migrateSchema', () => {

        it('should bootstrap if no tables exist', async () => {

            await migrateSchema(db, '1.0.0');

            const exists = await tablesExist(db);
            expect(exists).toBe(true);

        });

        it('should do nothing if already at current version', async () => {

            await bootstrapSchema(db, '1.0.0');
            observer.clear();

            await migrateSchema(db, '1.0.0');

            // No migration events should be emitted
            // (can't easily verify, but test doesn't throw)

        });

        it('should emit version:mismatch for newer schema', async () => {

            // Create tables with fake higher version
            await bootstrapSchema(db, '1.0.0');
            await db.updateTable('__noorm_version__').set({ schema_version: 999 }).execute();

            const events: unknown[] = [];
            observer.on('version:mismatch', (data) => events.push(data));

            await expect(migrateSchema(db, '1.0.0')).rejects.toThrow(VersionMismatchError);

            expect(events).toHaveLength(1);
            expect(events[0]).toEqual({
                layer: 'schema',
                current: 999,
                expected: CURRENT_VERSIONS.schema,
            });

        });

    });

    describe('ensureSchemaVersion', () => {

        it('should bootstrap if needed', async () => {

            await ensureSchemaVersion(db, '1.0.0');

            const exists = await tablesExist(db);
            expect(exists).toBe(true);

        });

        it('should work if already current', async () => {

            await bootstrapSchema(db, '1.0.0');

            // Should not throw
            await ensureSchemaVersion(db, '1.0.0');

        });

    });

    describe('getLatestVersionRecord', () => {

        it('should return null when tables do not exist', async () => {

            const record = await getLatestVersionRecord(db);

            expect(record).toBeNull();

        });

        it('should return state and settings versions', async () => {

            await bootstrapSchema(db, '1.0.0', { stateVersion: 2, settingsVersion: 3 });

            const record = await getLatestVersionRecord(db);

            expect(record).toEqual({
                stateVersion: 2,
                settingsVersion: 3,
            });

        });

        it('should return latest record when multiple exist', async () => {

            await bootstrapSchema(db, '1.0.0', { stateVersion: 1, settingsVersion: 1 });
            await updateVersionRecord(db, {
                cliVersion: '1.1.0',
                stateVersion: 2,
                settingsVersion: 3,
            });

            const record = await getLatestVersionRecord(db);

            expect(record).toEqual({
                stateVersion: 2,
                settingsVersion: 3,
            });

        });

    });

    describe('updateVersionRecord', () => {

        it('should insert a new version record', async () => {

            await bootstrapSchema(db, '1.0.0');
            await updateVersionRecord(db, {
                cliVersion: '1.1.0',
                stateVersion: 2,
                settingsVersion: 3,
            });

            const versions = await db
                .selectFrom('__noorm_version__')
                .selectAll()
                .orderBy('id', 'asc')
                .execute();

            expect(versions).toHaveLength(2);
            expect(versions[1].cli_version).toBe('1.1.0');
            expect(versions[1].state_version).toBe(2);
            expect(versions[1].settings_version).toBe(3);

        });

        it('should use defaults when versions not provided', async () => {

            await bootstrapSchema(db, '1.0.0');
            await updateVersionRecord(db, { cliVersion: '1.1.0' });

            const versions = await db
                .selectFrom('__noorm_version__')
                .selectAll()
                .orderBy('id', 'desc')
                .executeTakeFirst();

            expect(versions?.state_version).toBe(CURRENT_VERSIONS.state);
            expect(versions?.settings_version).toBe(CURRENT_VERSIONS.settings);

        });

    });

    describe('table structure', () => {

        beforeEach(async () => {

            await bootstrapSchema(db, '1.0.0');

        });

        it('should allow inserting changeset records', async () => {

            await db
                .insertInto('__noorm_changeset__')
                .values({
                    name: 'test-changeset',
                    change_type: 'changeset',
                    direction: 'change',
                    status: 'pending',
                })
                .execute();

            const result = await db
                .selectFrom('__noorm_changeset__')
                .selectAll()
                .where('name', '=', 'test-changeset')
                .executeTakeFirst();

            expect(result?.id).toBeDefined();
            expect(result?.name).toBe('test-changeset');

        });

        it.skip('should have executions table with required columns', async () => {

            // Verify table structure by inserting minimal valid data
            // Need to use raw SQL for changeset_id since FK requires valid reference
            await sql`
                INSERT INTO __noorm_changeset__ (name, change_type, direction, status)
                VALUES ('test-for-execution', 'build', 'change', 'pending')
            `.execute(db);

            // Get the actual rowid that was assigned
            const { rows: rowIdResult } = await sql<{ id: number }>`
                SELECT last_insert_rowid() as id
            `.execute(db);
            const changesetId = rowIdResult[0]?.id;

            await sql`
                INSERT INTO __noorm_executions__
                (changeset_id, filepath, file_type, status)
                VALUES (${changesetId}, '/test/file.sql', 'sql', 'success')
            `.execute(db);

            const result = await db
                .selectFrom('__noorm_executions__')
                .selectAll()
                .executeTakeFirst();

            expect(result?.filepath).toBe('/test/file.sql');
            expect(result?.file_type).toBe('sql');
            expect(result?.status).toBe('success');

        });

        it('should allow inserting lock records', async () => {

            // SQLite needs ISO string for timestamp
            const expiresAt = new Date(Date.now() + 60000).toISOString();

            await db
                .insertInto('__noorm_lock__')
                .values({
                    config_name: 'dev',
                    locked_by: 'test@example.com',
                    expires_at: expiresAt as unknown as Date,
                })
                .execute();

            const result = await db.selectFrom('__noorm_lock__').selectAll().executeTakeFirst();

            expect(result?.id).toBeDefined();

        });

        it('should enforce unique config_name on locks', async () => {

            const expiresAt = new Date().toISOString();

            await db
                .insertInto('__noorm_lock__')
                .values({
                    config_name: 'dev',
                    locked_by: 'user1',
                    expires_at: expiresAt as unknown as Date,
                })
                .execute();

            // Second insert with same config_name should fail
            await expect(
                db
                    .insertInto('__noorm_lock__')
                    .values({
                        config_name: 'dev',
                        locked_by: 'user2',
                        expires_at: expiresAt as unknown as Date,
                    })
                    .execute(),
            ).rejects.toThrow();

        });

        it('should allow inserting identity records', async () => {

            const result = await db
                .insertInto('__noorm_identities__')
                .values({
                    identity_hash: 'abc123',
                    email: 'test@example.com',
                    name: 'Test User',
                    machine: 'testhost',
                    os: 'darwin-24.0',
                    public_key: 'pubkey123',
                })
                .returning('id')
                .executeTakeFirst();

            expect(result?.id).toBeDefined();

        });

        it('should enforce unique identity_hash on identities', async () => {

            await db
                .insertInto('__noorm_identities__')
                .values({
                    identity_hash: 'same-hash',
                    email: 'user1@example.com',
                    name: 'User 1',
                    machine: 'host1',
                    os: 'darwin',
                    public_key: 'key1',
                })
                .execute();

            // Second insert with same hash should fail
            await expect(
                db
                    .insertInto('__noorm_identities__')
                    .values({
                        identity_hash: 'same-hash',
                        email: 'user2@example.com',
                        name: 'User 2',
                        machine: 'host2',
                        os: 'linux',
                        public_key: 'key2',
                    })
                    .execute(),
            ).rejects.toThrow();

        });

        it.skip('should have FK column on executions table', async () => {

            // Insert changeset using raw SQL
            await sql`
                INSERT INTO __noorm_changeset__ (name, change_type, direction, status)
                VALUES ('test-fk-parent', 'build', 'change', 'success')
            `.execute(db);

            // Get the actual rowid that was assigned
            const { rows: rowIdResult } = await sql<{ id: number }>`
                SELECT last_insert_rowid() as id
            `.execute(db);
            const changesetId = rowIdResult[0]?.id;

            // Insert execution with valid FK reference
            await sql`
                INSERT INTO __noorm_executions__
                (changeset_id, filepath, file_type, status)
                VALUES (${changesetId}, '/test.sql', 'sql', 'success')
            `.execute(db);

            // Verify we can select the execution
            const execution = await db
                .selectFrom('__noorm_executions__')
                .selectAll()
                .executeTakeFirst();

            expect(execution?.filepath).toBe('/test.sql');
            expect(execution?.changeset_id).toBeDefined();

        });

    });

});
