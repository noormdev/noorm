import { describe, it, expect } from 'bun:test';
import { attempt } from '@logosdx/utils';

import { sessionCommands } from '../../../src/rpc/commands/session.js';
import { queryCommands } from '../../../src/rpc/commands/query.js';
import { exploreCommands } from '../../../src/rpc/commands/explore.js';
import { changesCommands } from '../../../src/rpc/commands/changes.js';
import { runCommands } from '../../../src/rpc/commands/run.js';
import { RpcError } from '../../../src/rpc/types.js';
import type { RpcSession } from '../../../src/rpc/types.js';
import type { ConfigAccess, Channel } from '../../../src/core/policy/index.js';
import type { Context } from '../../../src/sdk/context.js';

// === Mock factories ===

interface MockContextOptions {
    configName?: string;
    dialect?: string;
    database?: string;
    access?: ConfigAccess;
    channel?: Channel;
}

/**
 * Creates a mock RpcSession with a fake context for unit testing handlers.
 *
 * Provides full mock noorm operations so handlers can reach the policy
 * check and session delegation logic without needing a real database.
 * Defaults to the `mcp` channel since that's what CP3 gates; individual
 * tests override `channel` to prove the same handler logic is channel-generic.
 */
function createMockSession(options: MockContextOptions = {}): RpcSession {

    const mockContext = {
        kysely: {},
        dialect: options.dialect ?? 'postgres',
        noorm: {
            config: {
                name: options.configName ?? 'test',
                access: options.access ?? { user: 'admin', mcp: 'admin' },
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
        channel: options.channel ?? 'mcp',
        getContext: () => mockContext,
        connect: async (config?: string) => ({
            name: config ?? 'test',
            dialect: 'postgres',
            database: 'testdb',
            role: 'admin',
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
        channel: 'mcp',
        getContext: () => {

            throw new RpcError('Not connected — call connect first');

        },
        connect: async () => ({ name: 'test', dialect: 'postgres', database: 'testdb', role: 'admin' }),
        disconnect: async () => {},
        disconnectAll: async () => {},
        hasConnection: () => false,
        listConnections: () => [],
    };

}

// === Group 1: SQL access-role escalation ===

describe('rpc commands: sql', () => {

    const cmd = queryCommands[0]!;

    it('should deny INSERT (sql:write) for a viewer role', async () => {

        const session = createMockSession({ access: { user: 'admin', mcp: 'viewer' } });
        const input = cmd.inputSchema.parse({ query: 'INSERT INTO t VALUES (1)' });

        await expect(cmd.handler(input, session)).rejects.toThrow(/sql:write/i);

    });

    it('should deny DROP (sql:ddl) for a viewer role', async () => {

        const session = createMockSession({ access: { user: 'admin', mcp: 'viewer' } });
        const input = cmd.inputSchema.parse({ query: 'DROP TABLE users' });

        await expect(cmd.handler(input, session)).rejects.toThrow(/sql:ddl/i);

    });

    it('should deny UPDATE (sql:write) for a viewer role', async () => {

        const session = createMockSession({ access: { user: 'admin', mcp: 'viewer' } });
        const input = cmd.inputSchema.parse({ query: 'UPDATE users SET name = \'bob\'' });

        await expect(cmd.handler(input, session)).rejects.toThrow(/sql:write/i);

    });

    it('should deny DELETE (sql:write) for a viewer role', async () => {

        const session = createMockSession({ access: { user: 'admin', mcp: 'viewer' } });
        const input = cmd.inputSchema.parse({ query: 'DELETE FROM users' });

        await expect(cmd.handler(input, session)).rejects.toThrow(/sql:write/i);

    });

    it('should allow SELECT for a viewer role (policy passes, execution reached)', async () => {

        const session = createMockSession({ access: { user: 'admin', mcp: 'viewer' } });
        const input = cmd.inputSchema.parse({ query: 'SELECT * FROM users LIMIT 10' });

        // The policy gate is the only thing in this call chain that rejects
        // for a denied permission — executeRawSqlUnchecked catches its own
        // DB errors into a `{ success: false }` result instead of rejecting.
        // So an unconditional resolve is proof the policy check allowed this
        // query; a denied permission would reject instead.
        await expect(cmd.handler(input, session)).resolves.toBeDefined();

    });

    it('should allow INSERT (sql:write) for an operator role (policy passes, execution reached)', async () => {

        const session = createMockSession({ access: { user: 'admin', mcp: 'operator' } });
        const input = cmd.inputSchema.parse({ query: 'INSERT INTO t VALUES (1)' });

        await expect(cmd.handler(input, session)).resolves.toBeDefined();

    });

    it('should deny DROP (sql:ddl) for an operator role', async () => {

        const session = createMockSession({ access: { user: 'admin', mcp: 'operator' } });
        const input = cmd.inputSchema.parse({ query: 'DROP TABLE users' });

        await expect(cmd.handler(input, session)).rejects.toThrow(/sql:ddl/i);

    });

    it('should allow DROP (sql:ddl) for an admin role (policy passes, execution reached)', async () => {

        const session = createMockSession({ access: { user: 'admin', mcp: 'admin' } });
        const input = cmd.inputSchema.parse({ query: 'DROP TABLE users' });

        await expect(cmd.handler(input, session)).resolves.toBeDefined();

    });

    it('should include config name in the denial reason', async () => {

        const session = createMockSession({ access: { user: 'admin', mcp: 'viewer' }, configName: 'prod' });
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

    it('should apply the same escalation on the user channel', async () => {

        const session = createMockSession({ access: { user: 'viewer', mcp: 'admin' }, channel: 'user' });
        const input = cmd.inputSchema.parse({ query: 'INSERT INTO t VALUES (1)' });

        await expect(cmd.handler(input, session)).rejects.toThrow(/sql:write/i);

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

                return { name: config ?? 'test', dialect: 'postgres', database: 'testdb', role: 'admin' };

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

                return { name: 'test', dialect: 'postgres', database: 'testdb', role: 'admin' };

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
