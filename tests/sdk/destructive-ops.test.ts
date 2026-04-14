/**
 * SDK destructive-ops guard tests.
 *
 * Proves that config.protected = true unconditionally blocks every
 * destructive operation across DbNamespace, DtNamespace, and
 * ChangesNamespace, and that the same operations are NOT blocked on
 * an unprotected config (they may fail for other reasons, but not with
 * ProtectedConfigError). Read-only ops are never blocked regardless of
 * the protected flag.
 */
import { describe, it, expect } from 'bun:test';

import { DbNamespace } from '../../src/sdk/namespaces/db.js';
import { DtNamespace } from '../../src/sdk/namespaces/dt.js';
import { ChangesNamespace } from '../../src/sdk/namespaces/changes.js';
import { ProtectedConfigError } from '../../src/sdk/guards.js';

import type { ContextState } from '../../src/sdk/state.js';
import type { Config } from '../../src/core/config/types.js';

// ─────────────────────────────────────────────────────────────
// Fixtures
// ─────────────────────────────────────────────────────────────

function makeConfig(isProtected: boolean): Config {

    return {
        name: isProtected ? 'prod' : 'dev',
        type: 'local',
        isTest: false,
        protected: isProtected,
        connection: { dialect: 'postgres', database: 'testdb' },
    };

}

function makeState(isProtected: boolean): ContextState {

    return {
        connection: null,
        config: makeConfig(isProtected),
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

describe('sdk: protected config guard', () => {

    // ─────────────────────────────────────────────────────
    // DbNamespace — protected blocks all destructive ops
    // ─────────────────────────────────────────────────────

    describe('DbNamespace on protected config', () => {

        it('should throw ProtectedConfigError for truncate()', async () => {

            const db = new DbNamespace(makeState(true));

            await expect(db.truncate()).rejects.toThrow(ProtectedConfigError);

        });

        it('should throw ProtectedConfigError for teardown()', async () => {

            const db = new DbNamespace(makeState(true));

            await expect(db.teardown()).rejects.toThrow(ProtectedConfigError);

        });

        it('should throw ProtectedConfigError for reset()', async () => {

            const db = new DbNamespace(makeState(true));

            await expect(db.reset()).rejects.toThrow(ProtectedConfigError);

        });

    });

    // ─────────────────────────────────────────────────────
    // DtNamespace — protected blocks importFile
    // ─────────────────────────────────────────────────────

    describe('DtNamespace on protected config', () => {

        it('should throw ProtectedConfigError for importFile()', async () => {

            const dt = new DtNamespace(makeState(true));

            await expect(dt.importFile('./fake.dtz')).rejects.toThrow(ProtectedConfigError);

        });

    });

    // ─────────────────────────────────────────────────────
    // ChangesNamespace — protected blocks revert and rewind
    // ─────────────────────────────────────────────────────

    describe('ChangesNamespace on protected config', () => {

        it('should throw ProtectedConfigError for revert()', async () => {

            const changes = new ChangesNamespace(makeState(true));

            await expect(changes.revert('any-change')).rejects.toThrow(ProtectedConfigError);

        });

        it('should throw ProtectedConfigError for rewind()', async () => {

            const changes = new ChangesNamespace(makeState(true));

            await expect(changes.rewind('any-change')).rejects.toThrow(ProtectedConfigError);

        });

    });

    // ─────────────────────────────────────────────────────
    // Unprotected config — guard does NOT block
    // ─────────────────────────────────────────────────────

    describe('DbNamespace on unprotected config', () => {

        it('should not throw ProtectedConfigError for truncate()', async () => {

            const db = new DbNamespace(makeState(false));

            const err = await db.truncate().catch((e: unknown) => e);

            expect(err).not.toBeInstanceOf(ProtectedConfigError);

        });

    });

    describe('DtNamespace on unprotected config', () => {

        it('should not throw ProtectedConfigError for importFile()', async () => {

            const dt = new DtNamespace(makeState(false));

            const err = await dt.importFile('./fake.dtz').catch((e: unknown) => e);

            expect(err).not.toBeInstanceOf(ProtectedConfigError);

        });

    });

    describe('ChangesNamespace on unprotected config', () => {

        it('should not throw ProtectedConfigError for revert()', async () => {

            const changes = new ChangesNamespace(makeState(false));

            const err = await changes.revert('any-change').catch((e: unknown) => e);

            expect(err).not.toBeInstanceOf(ProtectedConfigError);

        });

    });

    // ─────────────────────────────────────────────────────
    // Read-only ops — never blocked by protected flag
    // ─────────────────────────────────────────────────────

    describe('DtNamespace read-only ops on protected config', () => {

        it('should not throw ProtectedConfigError for exportTable()', async () => {

            const dt = new DtNamespace(makeState(true));

            const err = await dt.exportTable('users', './fake.dtz').catch((e: unknown) => e);

            expect(err).not.toBeInstanceOf(ProtectedConfigError);

        });

    });

});
