/**
 * `lock force` authorization tests.
 *
 * WHY these tests exist: force-releasing evicts whoever is mid-migration, and
 * it shipped completely ungated — no role check, no confirmation, and a
 * `released: true` report even when the lock table was empty. The `lock:force`
 * matrix row (`viewer: deny`, `operator`/`admin`: `confirm`) was added but had
 * no enforcement behind it.
 *
 * The gate lives on `LockNamespace` rather than in the CLI command so that
 * CLI, TUI and MCP inherit one enforcement path — these tests exercise it at
 * that seam, which is why an SDK namespace is under test in the lock suite.
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { attempt } from '@logosdx/utils';
import { Kysely, SqliteDialect } from 'kysely';

import { BunSqliteDatabase } from '../../../src/core/connection/dialects/sqlite-bun.js';
import { getLockManager, resetLockManager } from '../../../src/core/lock/index.js';
import type { NoormDatabase } from '../../../src/core/shared/index.js';
import type { ConfigAccess } from '../../../src/core/policy/index.js';
import type { Config } from '../../../src/core/config/types.js';
import { v1 } from '../../../src/core/version/schema/migrations/v1.js';
import { LockNamespace } from '../../../src/sdk/namespaces/lock.js';
import { ProtectedConfigError } from '../../../src/sdk/guards.js';
import type { ContextState } from '../../../src/sdk/state.js';

const VIEWER: ConfigAccess = { user: 'viewer', agent: false };
const OPERATOR: ConfigAccess = { user: 'operator', agent: 'viewer' };
const ADMIN: ConfigAccess = { user: 'admin', agent: 'admin' };

const CONFIG_NAME = 'dev';

function makeConfig(access: ConfigAccess): Config {

    return {
        name: CONFIG_NAME,
        type: 'local',
        isTest: false,
        access,
        connection: { dialect: 'sqlite', database: ':memory:' },
    };

}

describe('lock: force authorization', () => {

    let db: Kysely<NoormDatabase>;

    /** Builds a namespace over a live in-memory sqlite lock table. */
    function makeNamespace(
        access: ConfigAccess,
        options: ContextState['options'] = {},
    ): LockNamespace {

        const state: ContextState = {
            connection: { db, dialect: 'sqlite', destroy: async () => {} } as ContextState['connection'],
            config: makeConfig(access),
            settings: {},
            identity: { name: 'tester', source: 'system' },
            options,
            projectRoot: '/tmp',
            changeManager: null,
        };

        return new LockNamespace(state);

    }

    beforeEach(async () => {

        resetLockManager();

        db = new Kysely<NoormDatabase>({
            dialect: new SqliteDialect({
                database: new BunSqliteDatabase(':memory:') as never,
            }),
        });

        await v1.up(db as Kysely<unknown>, 'sqlite');

    });

    afterEach(async () => {

        resetLockManager();
        await db.destroy();

    });

    it('should deny a viewer outright, even with confirmation', async () => {

        const lock = makeNamespace(VIEWER, { yes: true });

        const [, err] = await attempt(() => lock.forceRelease());

        // viewer is a `deny` cell — pre-confirmation must not unblock it.
        expect(err).toBeInstanceOf(ProtectedConfigError);

    });

    it('should refuse an operator that has not confirmed', async () => {

        const lock = makeNamespace(OPERATOR);

        const [, err] = await attempt(() => lock.forceRelease());

        expect(err).toBeInstanceOf(ProtectedConfigError);

    });

    it('should refuse an admin that has not confirmed', async () => {

        const lock = makeNamespace(ADMIN);

        const [, err] = await attempt(() => lock.forceRelease());

        // `lock:force` is a `confirm` cell for admin too — breaking someone
        // else's lock is never frictionless.
        expect(err).toBeInstanceOf(ProtectedConfigError);

    });

    it('should not release the lock when the gate rejects', async () => {

        await getLockManager().acquire(db, CONFIG_NAME, 'alice', { dialect: 'sqlite' });

        const lock = makeNamespace(OPERATOR);

        await attempt(() => lock.forceRelease());

        const status = await getLockManager().status(db, CONFIG_NAME, 'sqlite');

        expect(status.isLocked).toBe(true);
        expect(status.lock?.lockedBy).toBe('alice');

    });

    it('should evict and name the holder for a confirmed admin', async () => {

        await getLockManager().acquire(db, CONFIG_NAME, 'alice', { dialect: 'sqlite' });

        const lock = makeNamespace(ADMIN, { yes: true });

        const result = await lock.forceRelease();

        expect(result.released).toBe(true);
        expect(result.holder).toBe('alice');

    });

    it('should report released:false when there is nothing to release', async () => {

        const lock = makeNamespace(ADMIN, { yes: true });

        const result = await lock.forceRelease();

        expect(result.released).toBe(false);
        expect(result.holder).toBeNull();

    });

    it('should deny the agent channel even when pre-confirmed', async () => {

        const lock = makeNamespace(ADMIN, { yes: true, channel: 'agent' });

        const [, err] = await attempt(() => lock.forceRelease());

        // `confirm` collapses to deny on agent, so `yes` can never unblock it.
        expect(err).toBeInstanceOf(ProtectedConfigError);

    });

});
