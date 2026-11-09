import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import type { StdioServerHandle } from '@modelcontextprotocol/server/stdio';

import { createMcpServer } from '../../../src/mcp/server.js';
import { createRegistry } from '../../../src/rpc/index.js';
import { configCommands } from '../../../src/rpc/commands/config.js';
import { listVisibleConfigs } from '../../../src/core/state/visible-configs.js';
import { initState, resetStateManager } from '../../../src/core/state/index.js';
import { encrypt, decrypt } from '../../../src/core/state/encryption/index.js';
import type { EncryptedPayload } from '../../../src/core/state/types.js';
import { generateKeyPair, setKeyOverride, clearKeyOverride } from '../../../src/core/identity/index.js';
import type { Config, ConfigSummary } from '../../../src/core/config/types.js';
import type { RpcSession } from '../../../src/rpc/types.js';

function config(name: string, agent: string | false = 'viewer'): Config {

    return {
        name, type: 'local', isTest: true,
        access: { user: 'admin', agent },
        connection: { dialect: 'sqlite', database: ':memory:' },
    };

}

const session: RpcSession = {
    channel: 'agent',
    getContext: () => {

        throw new Error('not used by list_configs');

    },
};

describe('list_configs: one visible set across MCP, RPC and resource discovery', () => {

    let dir: string;
    let previousCwd: string;
    let client: Client;
    let serverHandle: StdioServerHandle;

    beforeEach(async () => {

        resetStateManager();
        previousCwd = process.cwd();
        dir = mkdtempSync(join(tmpdir(), 'noorm-list-parity-'));
        const { privateKey } = await generateKeyPair();
        setKeyOverride(privateKey);
        const state = await initState(dir);
        await state.setConfig('visible', config('visible'));
        await state.setConfig('hidden', config('hidden', false));
        await state.setConfig('malformed', config('malformed'));

        const statePath = state.getStatePath();
        const stored = JSON.parse(decrypt(JSON.parse(readFileSync(statePath, 'utf8')) as EncryptedPayload, privateKey));
        stored.configs.malformed.access = { user: 'admin' };
        writeFileSync(statePath, JSON.stringify(encrypt(JSON.stringify(stored), privateKey)));
        resetStateManager();
        process.chdir(dir);

        const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
        client = new Client({ name: 'test', version: '1.0.0' }, {
            versionNegotiation: { mode: { pin: '2026-07-28' } },
        });
        serverHandle = serveStdio(() => createMcpServer(createRegistry()), { legacy: 'reject', transport: serverTransport });
        await client.connect(clientTransport);

    });

    afterEach(async () => {

        process.chdir(previousCwd);
        await client?.close();
        await serverHandle?.close();
        clearKeyOverride();
        resetStateManager();
        rmSync(dir, { recursive: true, force: true });

    });

    it('should exclude hidden and malformed configs for the agent channel', async () => {

        const configs = await listVisibleConfigs(dir, 'agent');

        expect(configs.map((item) => item.name)).toEqual(['visible']);

    });

    it('should include hidden configs but still omit malformed ones for the user channel', async () => {

        const configs = await listVisibleConfigs(dir, 'user');

        expect(configs.map((item) => item.name).sort()).toEqual(['hidden', 'visible']);

    });

    it('should return the same set from the shipped MCP tool, the RPC handler and resource discovery', async () => {

        const expected = await listVisibleConfigs(dir, 'agent');
        const rpc = configCommands.find((command) => command.name === 'list_configs')!;
        const rpcResult = await rpc.handler({}, session);
        const tool = await client.callTool({ name: 'list_configs', arguments: {} });
        const block = Array.isArray(tool.content) ? tool.content[0] : undefined;
        if (!block || block.type !== 'text') throw new Error('Expected text content');
        const toolConfigs: ConfigSummary[] = JSON.parse(block.text);
        const discovered = (await client.listResources()).resources.map((item) => item.uri);

        expect(rpcResult).toEqual(expected);
        expect(toolConfigs).toEqual(expected);
        expect(discovered.every((uri) => uri.startsWith('noorm://configs/visible/'))).toBe(true);
        expect(discovered.length).toBeGreaterThan(0);

    });

});
