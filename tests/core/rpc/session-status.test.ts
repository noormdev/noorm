/**
 * rpc commands: status.
 *
 * Uses a real StateManager (via the module singleton `status` reads through
 * `initState()`) rather than mocking state, so active-config resolution is
 * proven end-to-end the same way `list-configs.test.ts` proves agent-channel
 * filtering. `setKeyOverride` supplies the encryption key in-memory so
 * persistence never touches the real `~/.noorm/identity.key`. Only
 * `RpcSession` (`channel`, `listConnections`, `hasConnection`) is mocked.
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { initState, resetStateManager } from '../../../src/core/state/index.js';
import { generateKeyPair, setKeyOverride, clearKeyOverride } from '../../../src/core/identity/index.js';
import { sessionCommands } from '../../../src/rpc/commands/session.js';
import type { SessionStatus } from '../../../src/rpc/commands/session.js';
import type { Config } from '../../../src/core/config/types.js';
import type { RpcSession } from '../../../src/rpc/types.js';
import type { Channel } from '../../../src/core/policy/index.js';

/** `sessionCommands` is typed `RpcCommand[]` (generics erased) — narrow the handler's `unknown` result without casting. */
function isSessionStatus(value: unknown): value is SessionStatus {

    return typeof value === 'object' && value !== null && 'connections' in value;

}

function testConfig(name: string, overrides: Partial<Config> = {}): Config {

    return {
        name,
        type: 'local',
        isTest: true,
        access: { user: 'admin', agent: 'admin' },
        connection: { dialect: 'sqlite', database: ':memory:' },
        ...overrides,
    };

}

interface MockSessionOptions {
    channel?: Channel;
    connections?: string[];
    connected?: string[];
}

function sessionFor(options: MockSessionOptions = {}): RpcSession {

    const connected = new Set(options.connected ?? options.connections ?? []);

    return {
        channel: options.channel ?? 'user',
        getContext: () => {

            throw new Error('not used by status');

        },
        connect: async () => ({ name: 'x', dialect: 'sqlite', database: ':memory:', role: 'admin' }),
        disconnect: async () => {},
        disconnectAll: async () => {},
        hasConnection: (config: string) => connected.has(config),
        listConnections: () => options.connections ?? [],
    };

}

describe('rpc commands: status', () => {

    const cmd = sessionCommands.find((c) => c.name === 'status')!;

    let tempDir: string;
    let originalEnvConfig: string | undefined;

    beforeEach(async () => {

        resetStateManager();
        tempDir = mkdtempSync(join(tmpdir(), 'noorm-session-status-'));

        const { privateKey } = await generateKeyPair();
        setKeyOverride(privateKey);

        await initState(tempDir);

        originalEnvConfig = process.env['NOORM_CONFIG'];
        delete process.env['NOORM_CONFIG'];

    });

    afterEach(() => {

        if (originalEnvConfig === undefined) {

            delete process.env['NOORM_CONFIG'];

        }
        else {

            process.env['NOORM_CONFIG'] = originalEnvConfig;

        }

        clearKeyOverride();
        resetStateManager();
        rmSync(tempDir, { recursive: true, force: true });

    });

    it('should return empty connections and null active config when nothing is set up', async () => {

        const result = await cmd.handler({}, sessionFor());

        if (!isSessionStatus(result)) throw new Error('expected a SessionStatus');

        expect(result).toEqual({ connections: [], activeConfig: null, activeConnected: false });

    });

    it('should reflect session.listConnections() in connections', async () => {

        const session = sessionFor({ connections: ['dev', 'staging'] });
        const result = await cmd.handler({}, session);

        if (!isSessionStatus(result)) throw new Error('expected a SessionStatus');

        expect(result.connections).toEqual(['dev', 'staging']);

    });

    it('should reflect the state active config in activeConfig', async () => {

        const manager = await initState(tempDir);
        await manager.setConfig('dev', testConfig('dev'));
        await manager.setActiveConfig('dev');

        const result = await cmd.handler({}, sessionFor());

        if (!isSessionStatus(result)) throw new Error('expected a SessionStatus');

        expect(result.activeConfig).toBe('dev');

    });

    it('should let NOORM_CONFIG override the state active config', async () => {

        const manager = await initState(tempDir);
        await manager.setConfig('dev', testConfig('dev'));
        await manager.setConfig('prod', testConfig('prod'));
        await manager.setActiveConfig('dev');

        process.env['NOORM_CONFIG'] = 'prod';

        const result = await cmd.handler({}, sessionFor());

        if (!isSessionStatus(result)) throw new Error('expected a SessionStatus');

        expect(result.activeConfig).toBe('prod');

    });

    it('should report activeConnected: true when the active config is connected', async () => {

        const manager = await initState(tempDir);
        await manager.setConfig('dev', testConfig('dev'));
        await manager.setActiveConfig('dev');

        const session = sessionFor({ connections: ['dev'] });
        const result = await cmd.handler({}, session);

        if (!isSessionStatus(result)) throw new Error('expected a SessionStatus');

        expect(result.activeConnected).toBe(true);

    });

    it('should report activeConnected: false when the active config is not connected', async () => {

        const manager = await initState(tempDir);
        await manager.setConfig('dev', testConfig('dev'));
        await manager.setActiveConfig('dev');

        const session = sessionFor({ connections: ['other'] });
        const result = await cmd.handler({}, session);

        if (!isSessionStatus(result)) throw new Error('expected a SessionStatus');

        expect(result.activeConnected).toBe(false);

    });

    it('should hide the active config name on the agent channel when access.agent === false', async () => {

        const manager = await initState(tempDir);
        await manager.setConfig('hidden', testConfig('hidden', { access: { user: 'admin', agent: false } }));
        await manager.setActiveConfig('hidden');

        const result = await cmd.handler({}, sessionFor({ channel: 'agent' }));

        if (!isSessionStatus(result)) throw new Error('expected a SessionStatus');

        expect(result.activeConfig).toBeNull();
        expect(result.activeConnected).toBe(false);

    });

    it('should report the active config name unfiltered on the user channel for the same hidden config', async () => {

        const manager = await initState(tempDir);
        await manager.setConfig('hidden', testConfig('hidden', { access: { user: 'admin', agent: false } }));
        await manager.setActiveConfig('hidden');

        const result = await cmd.handler({}, sessionFor({ channel: 'user' }));

        if (!isSessionStatus(result)) throw new Error('expected a SessionStatus');

        expect(result.activeConfig).toBe('hidden');

    });

    it('should accept an empty object as input', () => {

        const result = cmd.inputSchema.safeParse({});

        expect(result.success).toBe(true);

    });

});
