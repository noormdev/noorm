/**
 * Connection manager tests.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { sql } from 'kysely';
import {
    getConnectionManager,
    resetConnectionManager,
} from '../../../src/core/connection/index.js';
import type { Config } from '../../../src/core/config/types.js';

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
            schema: './schema',
            changesets: './changesets',
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

            const conn = await manager.getConnection(config);

            expect(conn.dialect).toBe('sqlite');
            expect(manager.hasConnection('test')).toBe(true);
            expect(manager.size).toBe(1);

        });

        it('should return cached connection on second call', async () => {

            const manager = getConnectionManager();
            const config = createTestConfig('test');

            const conn1 = await manager.getConnection(config);
            const conn2 = await manager.getConnection(config);

            expect(conn1).toBe(conn2);
            expect(manager.size).toBe(1);

        });

        it('should create separate connections for different configs', async () => {

            const manager = getConnectionManager();
            const config1 = createTestConfig('dev');
            const config2 = createTestConfig('staging');

            const conn1 = await manager.getConnection(config1);
            const conn2 = await manager.getConnection(config2);

            expect(conn1).not.toBe(conn2);
            expect(manager.size).toBe(2);
            expect(manager.hasConnection('dev')).toBe(true);
            expect(manager.hasConnection('staging')).toBe(true);

        });

    });

    describe('closeConnection', () => {

        it('should close a specific connection', async () => {

            const manager = getConnectionManager();
            const config = createTestConfig('test');

            const conn = await manager.getConnection(config);
            await manager.closeConnection('test');

            expect(manager.hasConnection('test')).toBe(false);
            expect(manager.size).toBe(0);

            // Connection should be unusable
            await expect(sql`SELECT 1`.execute(conn.db)).rejects.toThrow();

        });

        it('should be safe to close non-existent connection', async () => {

            const manager = getConnectionManager();

            // Should not throw
            await expect(manager.closeConnection('nonexistent')).resolves.toBeUndefined();

        });

    });

    describe('closeAll', () => {

        it('should close all connections', async () => {

            const manager = getConnectionManager();

            await manager.getConnection(createTestConfig('dev'));
            await manager.getConnection(createTestConfig('staging'));
            await manager.getConnection(createTestConfig('prod'));

            expect(manager.size).toBe(3);

            await manager.closeAll();

            expect(manager.size).toBe(0);
            expect(manager.hasConnection('dev')).toBe(false);
            expect(manager.hasConnection('staging')).toBe(false);
            expect(manager.hasConnection('prod')).toBe(false);

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
            await manager1.getConnection(createTestConfig('test'));

            await resetConnectionManager();

            const manager2 = getConnectionManager();

            expect(manager1).not.toBe(manager2);
            expect(manager2.size).toBe(0);

        });

    });

});
