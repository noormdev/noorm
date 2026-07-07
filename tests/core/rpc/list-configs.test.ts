/**
 * rpc commands: list_configs mcp-channel invisibility.
 *
 * Uses a real StateManager (via the module singleton `list_configs` reads
 * through `initState()`) rather than mocking state, so the test proves the
 * actual filtering behavior end-to-end. `setKeyOverride` supplies the
 * encryption key in-memory — the same mechanism CI identity bootstrap uses —
 * so persistence never touches the real `~/.noorm/identity.key`.
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { initState, resetStateManager } from '../../../src/core/state/index.js';
import { generateKeyPair, setKeyOverride, clearKeyOverride } from '../../../src/core/identity/index.js';
import { configCommands } from '../../../src/rpc/commands/config.js';
import type { Config, ConfigSummary } from '../../../src/core/config/types.js';
import type { RpcSession } from '../../../src/rpc/types.js';
import type { Channel } from '../../../src/core/policy/index.js';

/** `configCommands` is typed `RpcCommand[]` (generics erased) — narrow the handler's `unknown` result without casting. */
function isConfigSummaryArray(value: unknown): value is ConfigSummary[] {

    return Array.isArray(value);

}

function testConfig(name: string, overrides: Partial<Config> = {}): Config {

    return {
        name,
        type: 'local',
        isTest: true,
        protected: false,
        access: { user: 'admin', mcp: 'admin' },
        connection: { dialect: 'sqlite', database: ':memory:' },
        ...overrides,
    };

}

function sessionFor(channel: Channel): RpcSession {

    return {
        channel,
        getContext: () => {

            throw new Error('not used by list_configs');

        },
        connect: async () => ({ name: 'x', dialect: 'sqlite', database: ':memory:', role: 'admin' }),
        disconnect: async () => {},
        disconnectAll: async () => {},
        hasConnection: () => false,
        listConnections: () => [],
    };

}

describe('rpc commands: list_configs', () => {

    const cmd = configCommands.find((c) => c.name === 'list_configs')!;

    let tempDir: string;

    beforeEach(async () => {

        resetStateManager();
        tempDir = mkdtempSync(join(tmpdir(), 'noorm-list-configs-'));

        const { privateKey } = await generateKeyPair();
        setKeyOverride(privateKey);

        const manager = await initState(tempDir);

        await manager.setConfig('visible', testConfig('visible'));
        await manager.setConfig('hidden', testConfig('hidden', { access: { user: 'admin', mcp: false } }));

    });

    afterEach(() => {

        clearKeyOverride();
        resetStateManager();
        rmSync(tempDir, { recursive: true, force: true });

    });

    it('should omit configs with access.mcp === false on the mcp channel', async () => {

        const result = await cmd.handler({}, sessionFor('mcp'));

        if (!isConfigSummaryArray(result)) throw new Error('expected an array of ConfigSummary');

        const names = result.map((c) => c.name);

        expect(names).toContain('visible');
        expect(names).not.toContain('hidden');

    });

    it('should include all configs on the user channel', async () => {

        const result = await cmd.handler({}, sessionFor('user'));

        if (!isConfigSummaryArray(result)) throw new Error('expected an array of ConfigSummary');

        const names = result.map((c) => c.name);

        expect(names).toContain('visible');
        expect(names).toContain('hidden');

    });

});
