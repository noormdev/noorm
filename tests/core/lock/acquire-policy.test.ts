/** Acquiring a lock creates the tracking tables on a fresh database, so a role that may not write is refused first. */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { attempt } from '@logosdx/utils';
import { Kysely, SqliteDialect, sql } from 'kysely';

import { BunSqliteDatabase } from '../../../src/core/connection/dialects/sqlite-bun.js';
import { getLockManager, resetLockManager } from '../../../src/core/lock/index.js';
import type { NoormDatabase } from '../../../src/core/shared/index.js';
import { attachPolicyContext } from '../../../src/core/policy/index.js';
import type { ConfigAccess } from '../../../src/core/policy/index.js';
import { LockNamespace } from '../../../src/sdk/namespaces/lock.js';
import { ProtectedConfigError } from '../../../src/sdk/guards.js';
import type { ContextState } from '../../../src/sdk/state.js';
import { getStateManager } from '../../../src/core/state/index.js';
import { bootstrapSchema } from '../../../src/core/version/schema/index.js';
import { CURRENT_VERSIONS } from '../../../src/core/version/types.js';

const VIEWER: ConfigAccess = { user: 'viewer', agent: false };
const OPERATOR: ConfigAccess = { user: 'operator', agent: 'viewer' };
const TEST_VIEWER: ConfigAccess = { user: 'viewer', agent: 'viewer' };
attachPolicyContext(VIEWER, {});
attachPolicyContext(OPERATOR, {});
attachPolicyContext(TEST_VIEWER, { isTest: true });

const CONFIG_NAME = 'dev';

describe('lock: acquire authorization', () => {

    let db: Kysely<NoormDatabase>;

    function makeNamespace(access: ConfigAccess, options: ContextState['options'] = {}): LockNamespace {

        const state: ContextState = {
            connection: { db, dialect: 'sqlite', destroy: async () => {} } as ContextState['connection'],
            config: {
                name: CONFIG_NAME,
                type: 'local',
                isTest: false,
                access,
                connection: { dialect: 'sqlite', database: ':memory:' },
            },
            settings: {},
            identity: { name: 'tester', source: 'system' },
            options,
            projectRoot: '/tmp',
            stateManager: getStateManager('/tmp'),
            changeManager: null,
        };

        return new LockNamespace(state);

    }

    async function tables(): Promise<string[]> {

        const found = await sql<{ name: string }>`SELECT name FROM sqlite_master WHERE type = 'table'`.execute(db);

        return found.rows.map((row) => row.name);

    }

    beforeEach(() => {

        resetLockManager();

        db = new Kysely<NoormDatabase>({
            dialect: new SqliteDialect({
                database: new BunSqliteDatabase(':memory:') as never,
            }),
        });

    });

    afterEach(async () => {

        resetLockManager();
        await db.destroy();

    });

    it.each([
        ['acquire', (lock: LockNamespace) => lock.acquire()],
        ['withLock', (lock: LockNamespace) => lock.withLock(async () => {})],
        ['release', (lock: LockNamespace) => lock.release()],
    ])('should refuse a viewer calling %s and leave the database untouched', async (_method, run) => {

        const [, err] = await attempt(() => run(makeNamespace(VIEWER, { yes: true })));

        expect(err).toBeInstanceOf(ProtectedConfigError);
        expect(await tables()).toEqual([]);

    });

    it('should not run the callback when withLock is refused', async () => {

        let ran = false;

        await attempt(() => makeNamespace(VIEWER).withLock(async () => {

            ran = true;

        }));

        expect(ran).toBe(false);

    });

    it('should let an operator acquire and release without confirmation', async () => {

        const lock = makeNamespace(OPERATOR);

        await lock.acquire();
        const held = await getLockManager().status(db, CONFIG_NAME, 'sqlite');
        await lock.release();
        const freed = await getLockManager().status(db, CONFIG_NAME, 'sqlite');

        expect(held.isLocked).toBe(true);
        expect(freed.isLocked).toBe(false);

    });

    it('should let an operator run a callback under withLock', async () => {

        const result = await makeNamespace(OPERATOR).withLock(async () => 'done');

        expect(result).toBe('done');

    });

    it('should refuse the agent channel when its role is viewer', async () => {

        const [, err] = await attempt(() => makeNamespace(OPERATOR, { channel: 'agent' }).acquire());

        expect(err).toBeInstanceOf(ProtectedConfigError);

    });

    // A trusted isTest config reads admin's cells for every role, so an agent can lock its own test database.
    it('should let a viewer acquire on a trusted isTest config', async () => {

        await makeNamespace(TEST_VIEWER, { channel: 'agent' }).acquire();

        const status = await getLockManager().status(db, CONFIG_NAME, 'sqlite');

        expect(status.isLocked).toBe(true);

    });

    describe('status', () => {

        async function expiredLockRows(): Promise<number> {

            const found = await sql<{ held: number }>`SELECT count(*) AS held FROM __noorm_lock__`.execute(db);

            return Number(found.rows[0]?.held);

        }

        async function seedExpiredLock(): Promise<void> {

            await bootstrapSchema(db, 'sqlite');
            await sql`
                INSERT INTO __noorm_lock__ (config_name, locked_by, locked_at, expires_at, reason)
                VALUES (${CONFIG_NAME}, 'someone', '2020-01-01T00:00:00.000Z', '2020-01-01T00:05:00.000Z', '')
            `.execute(db);

        }

        it('should report an expired lock as free without deleting it for a caller that cannot acquire', async () => {

            await seedExpiredLock();

            const status = await makeNamespace(OPERATOR, { channel: 'agent' }).status();

            expect(status).toEqual({ isLocked: false, lock: null });
            expect(await expiredLockRows()).toBe(1);

        });

        it('should clear an expired lock for a caller that can acquire', async () => {

            await seedExpiredLock();

            const status = await makeNamespace(OPERATOR).status();

            expect(status).toEqual({ isLocked: false, lock: null });
            expect(await expiredLockRows()).toBe(0);

        });

        it('should refuse a config hidden from the agent channel', async () => {

            const [, err] = await attempt(() => makeNamespace(VIEWER, { channel: 'agent' }).status());

            expect(err).toBeInstanceOf(ProtectedConfigError);
            expect(err?.message).toContain('is not accessible on the agent channel');

        });

        it('should refuse older tracking tables instead of reading their layout', async () => {

            await bootstrapSchema(db, 'sqlite');
            const stored = CURRENT_VERSIONS.schema - 1;
            await sql`UPDATE __noorm_version__ SET noorm_version = ${stored}`.execute(db);

            const [, err] = await attempt(() => makeNamespace(VIEWER).status());

            expect(err?.message).toContain(`tracking tables are at schema version ${stored} and this version needs ${CURRENT_VERSIONS.schema}`);
            expect(err?.message).toContain('Reading lock status does not migrate them');

        });

    });

});
