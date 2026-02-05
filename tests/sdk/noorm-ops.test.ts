/**
 * NoormOps tests.
 *
 * Verifies the ctx.noorm namespace: lazy singleton behavior,
 * shared state reading, and not-connected errors.
 */
import { describe, it, expect } from 'vitest';

import { Context } from '../../src/sdk/context.js';
import { NoormOps } from '../../src/sdk/noorm-ops.js';

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
        protected: false,
        connection: { dialect, database: 'testdb' },
        paths: { sql: 'sql', changes: 'changes' },
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
// Lazy Singleton
// ─────────────────────────────────────────────────────────────

describe('sdk: NoormOps', () => {

    describe('lazy singleton', () => {

        it('should return a NoormOps instance', () => {

            const ctx = createContext();
            const noorm = ctx.noorm;

            expect(noorm).toBeInstanceOf(NoormOps);

        });

        it('should return the same instance on repeated access', () => {

            const ctx = createContext();
            const first = ctx.noorm;
            const second = ctx.noorm;

            expect(first).toBe(second);

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

        it('should expose observer', () => {

            const ctx = createContext();

            expect(ctx.noorm.observer).toBeDefined();
            expect(typeof ctx.noorm.observer.on).toBe('function');

        });

    });

    // ─────────────────────────────────────────────────────────
    // Not Connected Errors
    // ─────────────────────────────────────────────────────────

    describe('not connected errors', () => {

        it('should throw on listTables when not connected', async () => {

            const ctx = createContext();

            await expect(ctx.noorm.listTables()).rejects.toThrow('Not connected');

        });

        it('should throw on describeTable when not connected', async () => {

            const ctx = createContext();

            await expect(ctx.noorm.describeTable('users')).rejects.toThrow('Not connected');

        });

        it('should throw on overview when not connected', async () => {

            const ctx = createContext();

            await expect(ctx.noorm.overview()).rejects.toThrow('Not connected');

        });

        it('should throw on truncate when not connected', async () => {

            const ctx = createContext();

            await expect(ctx.noorm.truncate()).rejects.toThrow('Not connected');

        });

        it('should throw on teardown when not connected', async () => {

            const ctx = createContext();

            await expect(ctx.noorm.teardown()).rejects.toThrow('Not connected');

        });

        it('should throw on acquireLock when not connected', async () => {

            const ctx = createContext();

            await expect(ctx.noorm.acquireLock()).rejects.toThrow('Not connected');

        });

        it('should throw on getLockStatus when not connected', async () => {

            const ctx = createContext();

            await expect(ctx.noorm.getLockStatus()).rejects.toThrow('Not connected');

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
