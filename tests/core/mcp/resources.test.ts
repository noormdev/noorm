import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sql } from 'kysely';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { McpServer } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import type { StdioServerHandle } from '@modelcontextprotocol/server/stdio';

import { parseExploreResource, registerExploreResources } from '../../../src/mcp/resources.js';
import { initState, resetStateManager } from '../../../src/core/state/index.js';
import { generateKeyPair, setKeyOverride, clearKeyOverride } from '../../../src/core/identity/index.js';
import { getConfigPermission, isVisibleToChannel } from '../../../src/core/policy/index.js';
import type { Config } from '../../../src/core/config/types.js';
import { Context } from '../../../src/sdk/context.js';

function config(name: string, hidden = false): Config {

    return {
        name, type: 'local', isTest: true,
        access: { user: 'admin', agent: hidden ? false : 'viewer' },
        connection: { dialect: 'sqlite', database: ':memory:' },
    };

}

describe('mcp: exploration resources', () => {

    let dir: string;
    let ctx: Context;
    let client: Client;
    let serverHandle: StdioServerHandle;

    beforeEach(async () => {

        resetStateManager();
        dir = mkdtempSync(join(tmpdir(), 'noorm-mcp-resources-'));
        const { privateKey } = await generateKeyPair();
        setKeyOverride(privateKey);
        const state = await initState(dir);
        const visible = config('visible db');
        await state.setConfig('visible db', visible);
        await state.setConfig('hidden', config('hidden', true));
        ctx = new Context(visible, {}, { name: 'tester', source: 'system' }, {}, dir);
        await ctx.connect();
        await sql`CREATE TABLE "weird name" (id INTEGER PRIMARY KEY, value TEXT)`.execute(ctx.kysely);

        const server = new McpServer({ name: 'resources-test', version: '1.0.0' });
        registerExploreResources(server, async (name, action) => {

            const current = state.getConfig(name);
            if (!current || !isVisibleToChannel(current.access, 'agent')) throw new Error('Configuration not found');
            if (getConfigPermission('agent', ctx.noorm.config, 'explore') !== 'allow') throw new Error('Exploration denied');

            return action(ctx);

        }, dir);
        const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
        client = new Client({ name: 'test', version: '1.0.0' }, {
            versionNegotiation: { mode: { pin: '2026-07-28' } },
        });
        serverHandle = serveStdio(() => server, { legacy: 'reject', transport: serverTransport });
        await client.connect(clientTransport);

    });

    afterEach(async () => {

        await client?.close();
        await serverHandle?.close();
        await ctx?.disconnect();
        clearKeyOverride();
        resetStateManager();
        rmSync(dir, { recursive: true, force: true });

    });

    it('should discover visible configurations deterministically without a prior connection', async () => {

        const first = await client.listResources();
        const second = await client.listResources();
        expect(first.resources).toEqual(second.resources);
        expect(first.resources).toHaveLength(11);
        expect(first.resources.map((item) => item.uri)).toContain('noorm://configs/visible%20db/overview');
        expect(JSON.stringify(first)).not.toContain('hidden');
        expect(JSON.stringify(first)).not.toContain(':memory:');
        expect((await client.listResourceTemplates()).resourceTemplates).toHaveLength(4);
        await expect(client.readResource({ uri: 'noorm://configs/hidden/overview' })).rejects.toThrow();

    });

    it('should read real SQLite overview, list, and encoded object detail as JSON', async () => {

        const root = 'noorm://configs/visible%20db';
        const read = async (uri: string) => {

            const result = await client.readResource({ uri });
            expect(result['ttlMs']).toBe(0);
            expect(result['cacheScope']).toBe('private');
            const content = result.contents[0];
            expect(content?.mimeType).toBe('application/json');
            if (!content || !('text' in content)) throw new Error('Expected JSON text');

            return JSON.parse(content.text);

        };
        expect((await read(`${root}/overview`)).tables).toBe(1);
        expect((await read(`${root}/objects/tables`)).map((table: { name: string }) => table.name)).toContain('weird name');
        expect((await read(`${root}/objects/tables/weird%20name`)).name).toBe('weird name');
        expect((await read(`${root}/objects/tables/weird%20name?schema=main`)).name).toBe('weird name');
        await expect(client.readResource({ uri: `${root}/objects/tables/${encodeURIComponent('x"; DROP TABLE "weird name";--')}` })).rejects.toThrow();
        expect((await read(`${root}/overview`)).tables).toBe(1);
        await expect(client.readResource({ uri: `${root}/objects/not-a-category` })).rejects.toThrow();
        await expect(client.readResource({ uri: `${root}/objects/indexes/foo` })).rejects.toThrow();

    });

    it('should parse encoded identifiers once and reject malformed shapes and queries', () => {

        expect(parseExploreResource(new URL('noorm://configs/my%20db/objects/tables/a%2Fb?schema=sales%20west'))).toEqual({
            config: 'my db', kind: 'detail', category: 'tables', name: 'a/b', schema: 'sales west',
        });
        for (const value of [
            'noorm://configs/x/objects/tables/foo?schema=',
            'noorm://configs/x/objects/tables/foo?schema=a&schema=b',
            'noorm://configs/x/objects/tables/foo?unknown=x',
            'noorm://configs/x/objects/tables/foo?schema=%FF',
            'noorm://configs/x/objects/tables/%00',
            'noorm://configs/x/objects/tables/%ZZ',
            'noorm://configs/x/objects/indexes/name',
            'noorm://configs/x/overview?schema=a',
        ]) expect(() => parseExploreResource(new URL(value))).toThrow();

    });

});
