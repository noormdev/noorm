import { describe, it, expect } from 'bun:test';
import { attempt } from '@logosdx/utils';

import { sessionCommands } from '../../../src/rpc/commands/session.js';
import { queryCommands } from '../../../src/rpc/commands/query.js';
import { exploreCommands } from '../../../src/rpc/commands/explore.js';
import { changesCommands } from '../../../src/rpc/commands/changes.js';
import { runCommands } from '../../../src/rpc/commands/run.js';
import { RpcError } from '../../../src/rpc/types.js';
import type { RpcSession } from '../../../src/rpc/types.js';
import type { Context } from '../../../src/sdk/context.js';

// === Mock factories ===

interface MockContextOptions {
    configName?: string;
    dialect?: string;
    database?: string;
    protected?: boolean;
}

/**
 * Creates a mock RpcSession with a fake context for unit testing handlers.
 *
 * Provides full mock noorm operations so handlers can reach the protection
 * check and session delegation logic without needing a real database.
 */
function createMockSession(options: MockContextOptions = {}): RpcSession {

    const mockContext = {
        kysely: {},
        dialect: options.dialect ?? 'postgres',
        noorm: {
            config: {
                name: options.configName ?? 'test',
                protected: options.protected ?? false,
                connection: { database: options.database ?? 'testdb' },
            },
            changes: {
                history: async () => [],
                apply: async () => ({ applied: true }),
                ff: async () => ({ applied: [] }),
                revert: async () => ({ reverted: true }),
            },
            run: {
                build: async () => ({ built: true }),
                file: async () => ({ executed: true }),
            },
        },
    } as unknown as Context;

    return {
        getContext: () => mockContext,
        connect: async (config?: string) => ({
            name: config ?? 'test',
            dialect: 'postgres',
            database: 'testdb',
            protected: false,
        }),
        disconnect: async () => {},
        disconnectAll: async () => {},
        hasConnection: () => true,
        listConnections: () => ['test'],
    };

}

/**
 * Creates a mock RpcSession that always throws on getContext.
 *
 * Simulates a session where no connection has been established,
 * so any command that calls session.getContext() will surface the
 * "not connected" error.
 */
function createDisconnectedSession(): RpcSession {

    return {
        getContext: () => {

            throw new RpcError('Not connected — call connect first');

        },
        connect: async () => ({ name: 'test', dialect: 'postgres', database: 'testdb', protected: false }),
        disconnect: async () => {},
        disconnectAll: async () => {},
        hasConnection: () => false,
        listConnections: () => [],
    };

}

// === Group 1: SQL Protection ===

describe('rpc commands: sql', () => {

    const cmd = queryCommands[0]!;

    it('should block INSERT on protected config', async () => {

        const session = createMockSession({ protected: true });
        const input = cmd.inputSchema.parse({ query: 'INSERT INTO t VALUES (1)' });

        await expect(cmd.handler(input, session)).rejects.toThrow(/protected/i);

    });

    it('should block DROP on protected config', async () => {

        const session = createMockSession({ protected: true });
        const input = cmd.inputSchema.parse({ query: 'DROP TABLE users' });

        await expect(cmd.handler(input, session)).rejects.toThrow(/protected/i);

    });

    it('should block UPDATE on protected config', async () => {

        const session = createMockSession({ protected: true });
        const input = cmd.inputSchema.parse({ query: 'UPDATE users SET name = \'bob\'' });

        await expect(cmd.handler(input, session)).rejects.toThrow(/protected/i);

    });

    it('should block DELETE on protected config', async () => {

        const session = createMockSession({ protected: true });
        const input = cmd.inputSchema.parse({ query: 'DELETE FROM users' });

        await expect(cmd.handler(input, session)).rejects.toThrow(/protected/i);

    });

    it('should allow SELECT on protected config (no protection error)', async () => {

        const session = createMockSession({ protected: true });
        const input = cmd.inputSchema.parse({ query: 'SELECT * FROM users LIMIT 10' });

        // Protection check passes; executeRawSql will fail without a real DB
        const [, err] = await attempt(() => cmd.handler(input, session));

        if (err) {

            expect(err.message).not.toMatch(/protected/i);

        }

    });

    it('should allow INSERT on unprotected config (no protection error)', async () => {

        const session = createMockSession({ protected: false });
        const input = cmd.inputSchema.parse({ query: 'INSERT INTO t VALUES (1)' });

        // Protection check is skipped; executeRawSql will fail without a real DB
        const [, err] = await attempt(() => cmd.handler(input, session));

        if (err) {

            expect(err.message).not.toMatch(/protected/i);

        }

    });

    it('should include config name in protection error', async () => {

        const session = createMockSession({ protected: true, configName: 'prod' });
        const input = cmd.inputSchema.parse({ query: 'DROP TABLE secrets' });

        const [, err] = await attempt(() => cmd.handler(input, session));

        expect(err).toBeDefined();
        expect(err!.message).toContain('prod');

    });

    it('should throw when not connected', async () => {

        const session = createDisconnectedSession();
        const input = cmd.inputSchema.parse({ query: 'SELECT 1' });

        await expect(cmd.handler(input, session)).rejects.toThrow(/not connected/i);

    });

});

// === Group 2: Session Commands ===

describe('rpc commands: session', () => {

    it('connect should delegate to session.connect()', async () => {

        let connectCalled = false;
        let receivedConfig: string | undefined;

        const session: RpcSession = {
            ...createMockSession(),
            connect: async (config?: string) => {

                connectCalled = true;
                receivedConfig = config;

                return { name: config ?? 'test', dialect: 'postgres', database: 'testdb', protected: false };

            },
        };

        const cmd = sessionCommands.find(c => c.name === 'connect')!;
        const input = cmd.inputSchema.parse({ config: 'dev' });
        await cmd.handler(input, session);

        expect(connectCalled).toBe(true);
        expect(receivedConfig).toBe('dev');

    });

    it('connect without config should call session.connect() with undefined', async () => {

        let receivedConfig: string | undefined = 'sentinel';

        const session: RpcSession = {
            ...createMockSession(),
            connect: async (config?: string) => {

                receivedConfig = config;

                return { name: 'test', dialect: 'postgres', database: 'testdb', protected: false };

            },
        };

        const cmd = sessionCommands.find(c => c.name === 'connect')!;
        const input = cmd.inputSchema.parse({});
        await cmd.handler(input, session);

        expect(receivedConfig).toBeUndefined();

    });

    it('disconnect should delegate to session.disconnect()', async () => {

        let disconnectCalled = false;
        let receivedConfig: string | undefined;

        const session: RpcSession = {
            ...createMockSession(),
            disconnect: async (config?: string) => {

                disconnectCalled = true;
                receivedConfig = config;

            },
        };

        const cmd = sessionCommands.find(c => c.name === 'disconnect')!;
        const input = cmd.inputSchema.parse({ config: 'dev' });
        await cmd.handler(input, session);

        expect(disconnectCalled).toBe(true);
        expect(receivedConfig).toBe('dev');

    });

    it('disconnect should return { disconnected: true }', async () => {

        const session = createMockSession();
        const cmd = sessionCommands.find(c => c.name === 'disconnect')!;
        const input = cmd.inputSchema.parse({});
        const result = await cmd.handler(input, session);

        expect(result).toEqual({ disconnected: true });

    });

    it('connect should return connection info', async () => {

        const session = createMockSession();
        const cmd = sessionCommands.find(c => c.name === 'connect')!;
        const input = cmd.inputSchema.parse({ config: 'mydb' });
        const result = await cmd.handler(input, session);

        expect(result).toMatchObject({ name: 'mydb', dialect: 'postgres', database: 'testdb' });

    });

});

// === Group 3: Commands on Disconnected Session ===

describe('rpc commands: disconnected session', () => {

    it('overview should throw when not connected', async () => {

        const session = createDisconnectedSession();
        const cmd = exploreCommands.find(c => c.name === 'overview')!;
        const input = cmd.inputSchema.parse({});

        await expect(cmd.handler(input, session)).rejects.toThrow(/not connected/i);

    });

    it('list should throw when not connected', async () => {

        const session = createDisconnectedSession();
        const cmd = exploreCommands.find(c => c.name === 'list')!;
        const input = cmd.inputSchema.parse({ category: 'tables' });

        await expect(cmd.handler(input, session)).rejects.toThrow(/not connected/i);

    });

    it('detail should throw when not connected', async () => {

        const session = createDisconnectedSession();
        const cmd = exploreCommands.find(c => c.name === 'detail')!;
        const input = cmd.inputSchema.parse({ category: 'tables', name: 'users' });

        await expect(cmd.handler(input, session)).rejects.toThrow(/not connected/i);

    });

    it('change_history should throw when not connected', async () => {

        const session = createDisconnectedSession();
        const cmd = changesCommands.find(c => c.name === 'change_history')!;
        const input = cmd.inputSchema.parse({});

        await expect(cmd.handler(input, session)).rejects.toThrow(/not connected/i);

    });

    it('change_ff should throw when not connected', async () => {

        const session = createDisconnectedSession();
        const cmd = changesCommands.find(c => c.name === 'change_ff')!;
        const input = cmd.inputSchema.parse({});

        await expect(cmd.handler(input, session)).rejects.toThrow(/not connected/i);

    });

    it('change_run should throw when not connected', async () => {

        const session = createDisconnectedSession();
        const cmd = changesCommands.find(c => c.name === 'change_run')!;
        const input = cmd.inputSchema.parse({ name: 'some-change' });

        await expect(cmd.handler(input, session)).rejects.toThrow(/not connected/i);

    });

    it('change_revert should throw when not connected', async () => {

        const session = createDisconnectedSession();
        const cmd = changesCommands.find(c => c.name === 'change_revert')!;
        const input = cmd.inputSchema.parse({ name: 'some-change' });

        await expect(cmd.handler(input, session)).rejects.toThrow(/not connected/i);

    });

    it('run_build should throw when not connected', async () => {

        const session = createDisconnectedSession();
        const cmd = runCommands.find(c => c.name === 'run_build')!;
        const input = cmd.inputSchema.parse({});

        await expect(cmd.handler(input, session)).rejects.toThrow(/not connected/i);

    });

    it('run_file should throw when not connected', async () => {

        const session = createDisconnectedSession();
        const cmd = runCommands.find(c => c.name === 'run_file')!;
        const input = cmd.inputSchema.parse({ path: 'sql/foo.sql' });

        await expect(cmd.handler(input, session)).rejects.toThrow(/not connected/i);

    });

});

// === Group 4: Handler Return Values ===

describe('rpc commands: return values', () => {

    it('change_history should return array from noorm.changes.history()', async () => {

        const session = createMockSession();
        const cmd = changesCommands.find(c => c.name === 'change_history')!;
        const input = cmd.inputSchema.parse({});
        const result = await cmd.handler(input, session);

        expect(Array.isArray(result)).toBe(true);

    });

    it('change_run should return applied result', async () => {

        const session = createMockSession();
        const cmd = changesCommands.find(c => c.name === 'change_run')!;
        const input = cmd.inputSchema.parse({ name: '2026-01-15-add-users' });
        const result = await cmd.handler(input, session);

        expect(result).toEqual({ applied: true });

    });

    it('change_ff should return ff result', async () => {

        const session = createMockSession();
        const cmd = changesCommands.find(c => c.name === 'change_ff')!;
        const input = cmd.inputSchema.parse({});
        const result = await cmd.handler(input, session);

        expect(result).toEqual({ applied: [] });

    });

    it('change_revert should return reverted result', async () => {

        const session = createMockSession();
        const cmd = changesCommands.find(c => c.name === 'change_revert')!;
        const input = cmd.inputSchema.parse({ name: '2026-01-15-add-users' });
        const result = await cmd.handler(input, session);

        expect(result).toEqual({ reverted: true });

    });

    it('run_build should return build result', async () => {

        const session = createMockSession();
        const cmd = runCommands.find(c => c.name === 'run_build')!;
        const input = cmd.inputSchema.parse({ force: true });
        const result = await cmd.handler(input, session);

        expect(result).toEqual({ built: true });

    });

    it('run_file should return execution result', async () => {

        const session = createMockSession();
        const cmd = runCommands.find(c => c.name === 'run_file')!;
        const input = cmd.inputSchema.parse({ path: 'sql/schema.sql' });
        const result = await cmd.handler(input, session);

        expect(result).toEqual({ executed: true });

    });

});
