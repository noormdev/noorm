/**
 * SDK destructive-ops guard tests.
 *
 * Proves that role-denied configs (viewer/operator) unconditionally block
 * every destructive operation across DbNamespace, DtNamespace, and
 * ChangesNamespace via checkPolicy, and that admin-role configs proceed
 * frictionlessly — both change:revert (`change:revert`) and
 * truncate/teardown/reset/importFile (`db:reset`) are `allow` cells for
 * admin, matching the legacy protected:false behavior for open configs.
 * Read-only ops are never blocked regardless of access.
 */
import { describe, it, expect } from 'bun:test';

import { DbNamespace } from '../../src/sdk/namespaces/db.js';
import { DtNamespace } from '../../src/sdk/namespaces/dt.js';
import { ChangesNamespace } from '../../src/sdk/namespaces/changes.js';
import { ProtectedConfigError } from '../../src/sdk/guards.js';

import type { ContextState } from '../../src/sdk/state.js';
import type { Config } from '../../src/core/config/types.js';
import type { ConfigAccess } from '../../src/core/policy/index.js';

// ─────────────────────────────────────────────────────────────
// Fixtures
// ─────────────────────────────────────────────────────────────

/** Mirrors the legacy `protected: true` migration mapping. */
const OPERATOR_ACCESS: ConfigAccess = { user: 'operator', mcp: 'viewer' };

/** Mirrors the legacy `protected: false` migration mapping. */
const ADMIN_ACCESS: ConfigAccess = { user: 'admin', mcp: 'admin' };

function makeConfig(access: ConfigAccess): Config {

    return {
        name: access.user === 'admin' ? 'dev' : 'prod',
        type: 'local',
        isTest: false,
        access,
        connection: { dialect: 'postgres', database: 'testdb' },
    };

}

function makeState(access: ConfigAccess): ContextState {

    return {
        connection: null,
        config: makeConfig(access),
        settings: {},
        identity: {
            name: 'tester',
            source: 'system',
        },
        options: {},
        projectRoot: '/tmp',
        changeManager: null,
    };

}

// ─────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────

describe('sdk: access-guarded destructive ops', () => {

    // ─────────────────────────────────────────────────────
    // DbNamespace — operator role can't satisfy the db:reset
    // confirm cell (SDK has no interactive prompt)
    // ─────────────────────────────────────────────────────

    describe('DbNamespace on operator-role config', () => {

        it('should throw ProtectedConfigError for truncate()', async () => {

            const db = new DbNamespace(makeState(OPERATOR_ACCESS));

            await expect(db.truncate()).rejects.toThrow(ProtectedConfigError);

        });

        it('should throw ProtectedConfigError for teardown()', async () => {

            const db = new DbNamespace(makeState(OPERATOR_ACCESS));

            await expect(db.teardown()).rejects.toThrow(ProtectedConfigError);

        });

        it('should throw ProtectedConfigError for reset()', async () => {

            const db = new DbNamespace(makeState(OPERATOR_ACCESS));

            await expect(db.reset()).rejects.toThrow(ProtectedConfigError);

        });

    });

    // ─────────────────────────────────────────────────────
    // DtNamespace — operator role can't satisfy the db:reset
    // confirm cell (SDK has no interactive prompt)
    // ─────────────────────────────────────────────────────

    describe('DtNamespace on operator-role config', () => {

        it('should throw ProtectedConfigError for importFile()', async () => {

            const dt = new DtNamespace(makeState(OPERATOR_ACCESS));

            await expect(dt.importFile('./fake.dtz')).rejects.toThrow(ProtectedConfigError);

        });

    });

    // ─────────────────────────────────────────────────────
    // ChangesNamespace — operator role requires confirmation,
    // which the SDK cannot satisfy without NOORM_YES
    // ─────────────────────────────────────────────────────

    describe('ChangesNamespace on operator-role config', () => {

        it('should throw ProtectedConfigError for revert()', async () => {

            const changes = new ChangesNamespace(makeState(OPERATOR_ACCESS));

            await expect(changes.revert('any-change')).rejects.toThrow(ProtectedConfigError);

        });

        it('should throw ProtectedConfigError for rewind()', async () => {

            const changes = new ChangesNamespace(makeState(OPERATOR_ACCESS));

            await expect(changes.rewind('any-change')).rejects.toThrow(ProtectedConfigError);

        });

    });

    // ─────────────────────────────────────────────────────
    // Admin role — change:revert is a frictionless `allow` cell,
    // matching the legacy protected:false behavior exactly
    // ─────────────────────────────────────────────────────

    describe('ChangesNamespace on admin-role config', () => {

        it('should not throw ProtectedConfigError for revert()', async () => {

            const changes = new ChangesNamespace(makeState(ADMIN_ACCESS));

            const err = await changes.revert('any-change').catch((e: unknown) => e);

            expect(err).not.toBeInstanceOf(ProtectedConfigError);

        });

    });

    // ─────────────────────────────────────────────────────
    // Admin role — db:reset is an `allow` cell for admin, so
    // truncate/teardown/reset/importFile proceed frictionlessly,
    // same as the legacy protected:false behavior
    // ─────────────────────────────────────────────────────

    describe('DbNamespace on admin-role config', () => {

        it('should not throw ProtectedConfigError for truncate()', async () => {

            const db = new DbNamespace(makeState(ADMIN_ACCESS));
            const err = await db.truncate().catch((e: unknown) => e);

            expect(err).not.toBeInstanceOf(ProtectedConfigError);

        });

    });

    describe('DtNamespace on admin-role config', () => {

        it('should not throw ProtectedConfigError for importFile()', async () => {

            const dt = new DtNamespace(makeState(ADMIN_ACCESS));
            const err = await dt.importFile('./fake.dtz').catch((e: unknown) => e);

            expect(err).not.toBeInstanceOf(ProtectedConfigError);

        });

    });

    // ─────────────────────────────────────────────────────
    // Read-only ops — never blocked regardless of access
    // ─────────────────────────────────────────────────────

    describe('DtNamespace read-only ops on operator-role config', () => {

        it('should not throw ProtectedConfigError for exportTable()', async () => {

            const dt = new DtNamespace(makeState(OPERATOR_ACCESS));

            const err = await dt.exportTable('users', './fake.dtz').catch((e: unknown) => e);

            expect(err).not.toBeInstanceOf(ProtectedConfigError);

        });

    });

});
