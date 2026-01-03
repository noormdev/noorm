/**
 * Connection manager tests.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { sql } from 'kysely';
import {
    getConnectionManager,
    resetConnectionManager,
    createConnection,
} from '../../../src/core/connection/index.js';
import type { Config } from '../../../src/core/config/types.js';
import type { ConnectionResult } from '../../../src/core/connection/types.js';

/**
 * Factory function to create connections for tests.
 */
async function testCreateFn(config: Config): Promise<ConnectionResult> {

    return createConnection(config.connection, config.name);

}

/**
 * Create a test config with SQLite in-memory database.
 */
function createTestConfig(name: string): Config {

    return {
        name,
        type: 'local',
        isTest: true,
        protected: false,
        connection: {
            dialect: 'sqlite',
            database: ':memory:',
        },
        paths: {
            sql: './sql',
            changes: './changes',
        },
    };

}

describe('connection: manager', () => {

    beforeEach(async () => {

        await resetConnectionManager();

    });

    afterEach(async () => {

        await resetConnectionManager();

    });

    describe('getConnection', () => {

        it('should create a new connection', async () => {

            const manager = getConnectionManager();
            const config = createTestConfig('test');

            const conn = await manager.getConnection(config, testCreateFn);

            expect(conn.dialect).toBe('sqlite');
            expect(manager.hasCached('test')).toBe(true);
            // size counts both cached and tracked - createConnection auto-tracks
            expect(manager.size).toBeGreaterThanOrEqual(1);

        });

        it('should return cached connection on second call', async () => {

            const manager = getConnectionManager();
            const config = createTestConfig('test');

            const conn1 = await manager.getConnection(config, testCreateFn);
            const conn2 = await manager.getConnection(config, testCreateFn);

            expect(conn1).toBe(conn2);
            // Same connection cached, size includes tracked
            expect(manager.hasCached('test')).toBe(true);

        });

        it('should create separate connections for different configs', async () => {

            const manager = getConnectionManager();
            const config1 = createTestConfig('dev');
            const config2 = createTestConfig('staging');

            const conn1 = await manager.getConnection(config1, testCreateFn);
            const conn2 = await manager.getConnection(config2, testCreateFn);

            expect(conn1).not.toBe(conn2);
            // 2 different configs cached
            expect(manager.hasCached('dev')).toBe(true);
            expect(manager.hasCached('staging')).toBe(true);

        });

    });

    describe('closeCached', () => {

        it('should close a specific connection', async () => {

            const manager = getConnectionManager();
            const config = createTestConfig('test');

            const conn = await manager.getConnection(config, testCreateFn);
            await manager.closeCached('test');

            expect(manager.hasCached('test')).toBe(false);
            expect(manager.size).toBe(0);

            // Connection should be unusable
            await expect(sql`SELECT 1`.execute(conn.db)).rejects.toThrow();

        });

        it('should be safe to close non-existent connection', async () => {

            const manager = getConnectionManager();

            // Should not throw
            await expect(manager.closeCached('nonexistent')).resolves.toBeUndefined();

        });

    });

    describe('closeAll', () => {

        it('should close all connections', async () => {

            const manager = getConnectionManager();

            await manager.getConnection(createTestConfig('dev'), testCreateFn);
            await manager.getConnection(createTestConfig('staging'), testCreateFn);
            await manager.getConnection(createTestConfig('prod'), testCreateFn);

            expect(manager.hasCached('dev')).toBe(true);
            expect(manager.hasCached('staging')).toBe(true);
            expect(manager.hasCached('prod')).toBe(true);

            await manager.closeAll();

            expect(manager.size).toBe(0);
            expect(manager.hasCached('dev')).toBe(false);
            expect(manager.hasCached('staging')).toBe(false);
            expect(manager.hasCached('prod')).toBe(false);

        });

        it('should be safe to call on empty manager', async () => {

            const manager = getConnectionManager();

            await expect(manager.closeAll()).resolves.toBeUndefined();

        });

    });

    describe('singleton behavior', () => {

        it('should return same instance on multiple calls', () => {

            const manager1 = getConnectionManager();
            const manager2 = getConnectionManager();

            expect(manager1).toBe(manager2);

        });

        it('should return new instance after reset', async () => {

            const manager1 = getConnectionManager();
            await manager1.getConnection(createTestConfig('test'), testCreateFn);

            await resetConnectionManager();

            const manager2 = getConnectionManager();

            expect(manager1).not.toBe(manager2);
            expect(manager2.size).toBe(0);

        });

    });

});
