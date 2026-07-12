/**
 * NoormOps tests.
 *
 * Verifies the ctx.noorm namespace: lazy singleton behavior,
 * namespace getters, shared state reading, and not-connected errors.
 */
import { describe, it, expect } from 'bun:test';
import { ObserverEngine } from '@logosdx/observer';

import { Context } from '../../src/sdk/context.js';
import { NoormOps } from '../../src/sdk/noorm-ops.js';
import { noormObserver } from '../../src/sdk/index.js';
import { ChangesNamespace } from '../../src/sdk/namespaces/changes.js';
import { RunNamespace } from '../../src/sdk/namespaces/run.js';
import { DbNamespace } from '../../src/sdk/namespaces/db.js';
import { LockNamespace } from '../../src/sdk/namespaces/lock.js';
import { VaultNamespace } from '../../src/sdk/namespaces/vault.js';
import { SecretsNamespace } from '../../src/sdk/namespaces/secrets.js';
import { TemplatesNamespace } from '../../src/sdk/namespaces/templates.js';
import { TransferNamespace } from '../../src/sdk/namespaces/transfer.js';
import { DtNamespace } from '../../src/sdk/namespaces/dt.js';
import { UtilsNamespace } from '../../src/sdk/namespaces/utils.js';

import type { Config } from '../../src/core/config/types.js';
import type { Settings } from '../../src/core/settings/types.js';
import type { Identity } from '../../src/core/identity/types.js';

// ─────────────────────────────────────────────────────────────
// Test Fixtures
// ─────────────────────────────────────────────────────────────

function createMockConfig(dialect: Config['connection']['dialect'] = 'postgres'): Config {

    return {
        name: 'test',
        type: 'local',
        isTest: true,
        access: { user: 'admin', mcp: 'admin' },
        connection: { dialect, database: 'testdb' },
    };

}

const mockSettings: Settings = {};

const mockIdentity: Identity = {
    name: 'tester',
    source: 'system',
};

function createContext(dialect: Config['connection']['dialect'] = 'postgres') {

    return new Context(
        createMockConfig(dialect),
        mockSettings,
        mockIdentity,
        {},
        '/tmp/test-project',
    );

}

// ─────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────

describe('sdk: NoormOps', () => {

    describe('lazy singleton', () => {

        it('should return a NoormOps instance', () => {

            const ctx = createContext();

            expect(ctx.noorm).toBeInstanceOf(NoormOps);

        });

        it('should return the same instance on repeated access', () => {

            const ctx = createContext();

            expect(ctx.noorm).toBe(ctx.noorm);

        });

    });

    describe('lazy singleton namespaces', () => {

        it('should lazily create ChangesNamespace', () => {

            const ctx = createContext();

            expect(ctx.noorm.changes).toBeInstanceOf(ChangesNamespace);
            expect(ctx.noorm.changes).toBe(ctx.noorm.changes);

        });

        it('should lazily create RunNamespace', () => {

            const ctx = createContext();

            expect(ctx.noorm.run).toBeInstanceOf(RunNamespace);
            expect(ctx.noorm.run).toBe(ctx.noorm.run);

        });

        it('should lazily create DbNamespace', () => {

            const ctx = createContext();

            expect(ctx.noorm.db).toBeInstanceOf(DbNamespace);
            expect(ctx.noorm.db).toBe(ctx.noorm.db);

        });

        it('should lazily create LockNamespace', () => {

            const ctx = createContext();

            expect(ctx.noorm.lock).toBeInstanceOf(LockNamespace);
            expect(ctx.noorm.lock).toBe(ctx.noorm.lock);

        });

        it('should lazily create VaultNamespace', () => {

            const ctx = createContext();

            expect(ctx.noorm.vault).toBeInstanceOf(VaultNamespace);
            expect(ctx.noorm.vault).toBe(ctx.noorm.vault);

        });

        it('should lazily create SecretsNamespace', () => {

            const ctx = createContext();

            expect(ctx.noorm.secrets).toBeInstanceOf(SecretsNamespace);
            expect(ctx.noorm.secrets).toBe(ctx.noorm.secrets);

        });

        it('should lazily create TemplatesNamespace', () => {

            const ctx = createContext();

            expect(ctx.noorm.templates).toBeInstanceOf(TemplatesNamespace);
            expect(ctx.noorm.templates).toBe(ctx.noorm.templates);

        });

        it('should lazily create TransferNamespace', () => {

            const ctx = createContext();

            expect(ctx.noorm.transfer).toBeInstanceOf(TransferNamespace);
            expect(ctx.noorm.transfer).toBe(ctx.noorm.transfer);

        });

        it('should lazily create DtNamespace', () => {

            const ctx = createContext();

            expect(ctx.noorm.dt).toBeInstanceOf(DtNamespace);
            expect(ctx.noorm.dt).toBe(ctx.noorm.dt);

        });

        it('should lazily create UtilsNamespace', () => {

            const ctx = createContext();

            expect(ctx.noorm.utils).toBeInstanceOf(UtilsNamespace);
            expect(ctx.noorm.utils).toBe(ctx.noorm.utils);

        });

    });

    // ─────────────────────────────────────────────────────────
    // Shared State
    // ─────────────────────────────────────────────────────────

    describe('shared state', () => {

        it('should expose config from context state', () => {

            const ctx = createContext();
            const config = ctx.noorm.config;

            expect(config.name).toBe('test');
            expect(config.connection.dialect).toBe('postgres');

        });

        it('should expose settings from context state', () => {

            const ctx = createContext();

            expect(ctx.noorm.settings).toBe(mockSettings);

        });

        it('should expose identity from context state', () => {

            const ctx = createContext();

            expect(ctx.noorm.identity).toBe(mockIdentity);
            expect(ctx.noorm.identity.name).toBe('tester');

        });

        it('should not expose observer on NoormOps', () => {

            const ctx = createContext();

            // @ts-expect-error observer was relocated to the top-level `noormObserver` export
            expect(ctx.noorm.observer).toBeUndefined();

        });

    });

    // ─────────────────────────────────────────────────────────
    // Not Connected Errors
    // ─────────────────────────────────────────────────────────

    describe('not connected errors', () => {

        it('should throw on db.listTables when not connected', async () => {

            const ctx = createContext();

            await expect(ctx.noorm.db.listTables()).rejects.toThrow('Not connected');

        });

        it('should throw on db.describeTable when not connected', async () => {

            const ctx = createContext();

            await expect(ctx.noorm.db.describeTable('users')).rejects.toThrow('Not connected');

        });

        it('should throw on db.overview when not connected', async () => {

            const ctx = createContext();

            await expect(ctx.noorm.db.overview()).rejects.toThrow('Not connected');

        });

        it('should throw on db.truncate when not connected', async () => {

            const ctx = createContext();

            await expect(ctx.noorm.db.truncate()).rejects.toThrow('Not connected');

        });

        it('should throw on db.teardown when not connected', async () => {

            const ctx = createContext();

            await expect(ctx.noorm.db.teardown()).rejects.toThrow('Not connected');

        });

        it('should throw on lock.acquire when not connected', async () => {

            const ctx = createContext();

            await expect(ctx.noorm.lock.acquire()).rejects.toThrow('Not connected');

        });

        it('should throw on lock.status when not connected', async () => {

            const ctx = createContext();

            await expect(ctx.noorm.lock.status()).rejects.toThrow('Not connected');

        });

    });

    // ─────────────────────────────────────────────────────────
    // Top-level API preserved
    // ─────────────────────────────────────────────────────────

    describe('context top-level API', () => {

        it('should still expose dialect on context', () => {

            const ctx = createContext('mysql');

            expect(ctx.dialect).toBe('mysql');

        });

        it('should still expose connected on context', () => {

            const ctx = createContext();

            expect(ctx.connected).toBe(false);

        });

        it('should throw on kysely when not connected', () => {

            const ctx = createContext();

            expect(() => ctx.kysely).toThrow('Not connected');

        });

    });

});

// ─────────────────────────────────────────────────────────────
// noormObserver (top-level export)
// ─────────────────────────────────────────────────────────────

describe('sdk: noormObserver export', () => {

    it('should be importable from the SDK entry point as an ObserverEngine instance', () => {

        expect(noormObserver).toBeInstanceOf(ObserverEngine);
        expect(typeof noormObserver.on).toBe('function');

    });

});
