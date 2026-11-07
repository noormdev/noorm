import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sql } from 'kysely';
import { InMemoryTransport, type McpServer } from '@modelcontextprotocol/server';
import type { StdioServerHandle } from '@modelcontextprotocol/server/stdio';
import { z } from 'zod';

import { createMcpServer } from '../../../src/mcp/server.js';
import { serveModernMcp } from '../../../src/mcp/stdio.js';
import { createRegistry } from '../../../src/rpc/index.js';
import { Context } from '../../../src/sdk/context.js';
import { parseConfig } from '../../../src/core/config/schema.js';
import { parseSettings } from '../../../src/core/settings/schema.js';
import { checkConfigPolicy } from '../../../src/core/policy/index.js';
import type { Settings } from '../../../src/core/settings/types.js';

const responseSchema = z.object({
    id: z.number(),
    result: z.record(z.string(), z.unknown()).optional(),
    error: z.object({ code: z.number(), message: z.string() }).passthrough().optional(),
});
const challengeSchema = z.object({ resultType: z.literal('input_required'), requestState: z.string(), inputRequests: z.record(z.string(), z.unknown()) });
const capabilities = { elicitation: { form: {} } };
const accepted = { approval: { action: 'accept', content: { approve: true } } };

type WireResponse = z.infer<typeof responseSchema>;
interface WireClient {
    handle: StdioServerHandle;
    request(method: string, params?: Record<string, unknown>, clientCapabilities?: unknown, version?: string): Promise<WireResponse>;
}

/** Raw wire client keeps MRTR retries explicit so replay and tampering can be exercised. */
async function connectWire(server: McpServer): Promise<WireClient> {

    const [client, transport] = InMemoryTransport.createLinkedPair();
    const pending = new Map<number, (value: WireResponse) => void>();
    let id = 0;
    client.onmessage = (message) => {

        const parsed = responseSchema.safeParse(message);
        if (!parsed.success) return;
        const resolve = pending.get(parsed.data.id);
        pending.delete(parsed.data.id);
        resolve?.(parsed.data);

    };
    const handle = serveModernMcp(server, transport);
    await client.start();

    return {
        handle,
        async request(method: string, params: Record<string, unknown> = {}, clientCapabilities: unknown = capabilities, version = '2026-07-28') {

            const requestId = ++id;
            const { promise: result, resolve } = Promise.withResolvers<WireResponse>();
            pending.set(requestId, resolve);
            await client.send({ jsonrpc: '2.0', id: requestId, method, params: {
                ...params,
                _meta: {
                    'io.modelcontextprotocol/protocolVersion': version,
                    'io.modelcontextprotocol/clientCapabilities': clientCapabilities,
                    'io.modelcontextprotocol/clientInfo': { name: 'regression-client', version: '1' },
                },
            } });

            return result;

        },
    };

}

function text(result: z.infer<typeof responseSchema>): string {

    const value = z.object({ content: z.array(z.object({ type: z.literal('text'), text: z.string() })) }).parse(result.result);

    return value.content[0]?.text ?? '';

}

describe('modern MCP protocol and authorization', () => {

    let root: string;
    let settings: Settings;
    let role: string;
    let wire: WireClient;
    let handle: StdioServerHandle;
    let restoreDiagnostics: () => void;

    const configFor = (name: string) => parseConfig({
        name, type: 'local', isTest: true,
        connection: { dialect: 'sqlite', database: join(root, `${name}.db`) },
        access: { user: 'admin', agent: role },
    });
    const contextFor = (name: string) => new Context(configFor(name), settings,
        { name: 'MCP regression', source: 'system' }, { channel: 'agent' }, root);
    const call = (query: string, retry: Record<string, unknown> = {}, config = 'test', caps: unknown = capabilities) => wire.request('tools/call', {
        name: 'sql', arguments: { config, query }, ...retry,
    }, caps);
    const tables = async () => {

        const ctx = contextFor('test');
        await ctx.connect();
        try {

            return (await sql<{ name: string }>`
                SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name
            `.execute(ctx.kysely)).rows.map((row) => row.name);

        }
        finally {

            await ctx.disconnect();

        }

    };

    beforeEach(async () => {

        root = await mkdtemp(join(tmpdir(), 'noorm-modern-mcp-'));
        settings = parseSettings({ access: { roles: { operator: { permissions: { 'sql:ddl': 'confirm' } } } } });
        role = 'operator';
        const diagnostics = spyOn(console, 'error').mockImplementation(() => {});
        restoreDiagnostics = () => {

            diagnostics.mockRestore();

        };
        wire = await connectWire(createMcpServer(createRegistry(), {
            withConfig: async (name, action) => {

                if (!['test', 'other'].includes(name)) throw new Error('Config not found');
                const ctx = contextFor(name);
                try {

                    return await action(ctx);

                }
                finally {

                    await ctx.disconnect();

                }

            },
        }));
        handle = wire.handle;

    });

    afterEach(async () => {

        await handle?.close();
        restoreDiagnostics?.();
        await rm(root, { recursive: true, force: true });

    });

    it('serves discovery and cacheable catalogs without initialization, and rejects unsupported versions', async () => {

        const discovery = await wire.request('server/discover');
        expect(discovery.result).toMatchObject({ resultType: 'complete', supportedVersions: ['2026-07-28'] });
        const tools = await wire.request('tools/list');
        expect(tools.result).toMatchObject({ resultType: 'complete', cacheScope: 'public' });
        expect(z.object({ ttlMs: z.number().int().nonnegative() }).parse(tools.result).ttlMs).toBeGreaterThanOrEqual(0);
        expect(z.object({ tools: z.array(z.object({ name: z.string() })) }).parse(tools.result).tools.map((item) => item.name).sort())
            .toEqual(['change_ff', 'change_history', 'change_revert', 'change_run', 'detail', 'list', 'list_configs', 'overview', 'run_build', 'run_file', 'sql']);
        expect((await wire.request('tools/list', {}, capabilities, '1900-01-01')).error?.code).toBe(-32022);
        expect((await wire.request('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'legacy', version: '1' } })).error).toBeDefined();

    });

    it('validates direct tool inputs and rejects legacy or unknown tools', async () => {

        const invalid = [
            { name: 'overview', arguments: {} },
            { name: 'sql', arguments: { config: 'test', query: 42 } },
            { name: 'sql', arguments: { config: 'test', payload: { query: 'SELECT 1' } } },
            { name: 'sql', arguments: { config: 'test', query: 'SELECT 1', payload: {} } },
            { name: 'run_noorm_cmd', arguments: { command: 'overview', config: 'test' } },
            { name: 'noorm_help', arguments: {} },
            { name: 'connect', arguments: { config: 'test' } },
            { name: 'unknown', arguments: {} },
        ];
        for (const params of invalid) {

            expect((await wire.request('tools/call', params)).error?.code).toBe(-32602);

        }
        expect(await tables()).toEqual([]);

    });

    it('validates prompt arguments and fetching a cookbook does not change the database', async () => {

        expect((await wire.request('prompts/get', { name: 'noorm_explore_database', arguments: {} })).error?.code).toBe(-32602);
        expect((await wire.request('prompts/get', { name: 'noorm_run_sql_file', arguments: { config: 'test' } })).error?.code).toBe(-32602);
        expect((await wire.request('prompts/get', { name: 'noorm_automation', arguments: { task: '' } })).error?.code).toBe(-32602);
        expect((await wire.request('prompts/get', {
            name: 'noorm_ci', arguments: { provider: 'GitHub Actions', target: 'production', config: 'test' },
        })).error?.code).toBe(-32602);
        expect((await wire.request('prompts/get', {
            name: 'noorm_ci', arguments: { provider: 'GitLab CI', target: 'test' },
        })).error?.code).toBe(-32602);
        const before = await tables();
        const prompt = await wire.request('prompts/get', { name: 'noorm_explore_database', arguments: { config: 'test' } });
        expect(prompt.error).toBeUndefined();
        expect(await tables()).toEqual(before);

    });

    it('executes DDL only after explicit acceptance, and consumes approval once even for concurrent retries', async () => {

        const query = 'CREATE TABLE approved (id INTEGER PRIMARY KEY)';
        const initial = challengeSchema.parse((await call(query)).result);
        expect(await tables()).not.toContain('approved');
        const retry = { requestState: initial.requestState, inputResponses: accepted };
        const outcomes = await Promise.all([call(query, retry), call(query, retry)]);
        expect(outcomes.filter((result) => result.result?.['isError'] !== true && !result.error)).toHaveLength(1);
        expect(await tables()).toContain('approved');
        expect((await call(query, retry)).result?.['isError']).toBe(true);

    });

    it.each(['decline', 'cancel'])('does not execute when the client returns %s', async (action) => {

        const query = 'CREATE TABLE refused (id INTEGER)';
        const initial = challengeSchema.parse((await call(query)).result);
        const result = await call(query, { requestState: initial.requestState, inputResponses: { approval: { action } } });
        expect(result.result?.['isError']).toBe(true);
        expect(await tables()).not.toContain('refused');

    });

    it('rejects forged, changed-query, and changed-config approvals', async () => {

        const query = 'CREATE TABLE original (id INTEGER)';
        const initial = challengeSchema.parse((await call(query)).result);
        expect((await call(query, { requestState: `${initial.requestState}tampered`, inputResponses: accepted })).error?.code).toBe(-32602);
        const changed = await call('CREATE TABLE changed (id INTEGER)', { requestState: initial.requestState, inputResponses: accepted });
        expect(changed.result?.['isError']).toBe(true);
        const second = challengeSchema.parse((await call(query)).result);
        expect((await call(query, { requestState: second.requestState, inputResponses: accepted }, 'other')).result?.['isError']).toBe(true);
        expect(await tables()).toEqual([]);

    });

    it('does not reuse approval for a different direct tool', async () => {

        const initial = challengeSchema.parse((await call('CREATE TABLE original (id INTEGER)')).result);
        const result = await wire.request('tools/call', {
            name: 'run_file',
            arguments: { config: 'test', path: 'other.sql' },
            requestState: initial.requestState,
            inputResponses: accepted,
        });
        expect(result.result?.['isError']).toBe(true);
        expect(JSON.parse(text(result)).error).toMatch(/does not match/i);
        expect(await tables()).toEqual([]);

    });

    it('invalidates approval when effective policy changes', async () => {

        const query = 'CREATE TABLE stale (id INTEGER)';
        const initial = challengeSchema.parse((await call(query)).result);
        settings = parseSettings({ access: { roles: { operator: { permissions: { 'sql:ddl': 'deny' } } } } });
        const result = await call(query, { requestState: initial.requestState, inputResponses: accepted });
        expect(result.result?.['isError']).toBe(true);
        expect(await tables()).not.toContain('stale');

    });

    it('rejects expired approval without executing the operation', async () => {

        const query = 'CREATE TABLE expired (id INTEGER)';
        const initial = challengeSchema.parse((await call(query)).result);
        const future = Date.now() + 24 * 60 * 60 * 1000;
        const clock = spyOn(Date, 'now').mockImplementation(() => future);
        try {

            const result = await call(query, { requestState: initial.requestState, inputResponses: accepted });
            expect(result.error?.code).toBe(-32602);

        }
        finally {

            clock.mockRestore();

        }
        expect(await tables()).not.toContain('expired');

    });

    it('fails closed without form elicitation and does not treat unsolicited acceptance as approval', async () => {

        const query = 'CREATE TABLE bypass (id INTEGER)';
        expect((await call(query, {}, 'test', {})).error?.code).toBe(-32021);
        expect((await call(query, { inputResponses: accepted })).result?.['isError']).toBe(true);
        expect(await tables()).toEqual([]);

    });

    it('preserves operator DML access and viewer denial, including writes hidden inside a CTE', async () => {

        const ctx = contextFor('test');
        await ctx.connect();
        await sql`CREATE TABLE records (id INTEGER PRIMARY KEY)`.execute(ctx.kysely);
        await ctx.disconnect();
        expect((await call('INSERT INTO records VALUES (1)')).result?.['isError']).not.toBe(true);
        const read = await call('SELECT id FROM records');
        expect(JSON.parse(text(read))).toMatchObject({ rows: [{ id: 1 }] });
        role = 'viewer';
        expect((await call('DELETE FROM records')).result?.['isError']).toBe(true);
        expect((await call('WITH gone AS (DELETE FROM records RETURNING *) SELECT * FROM gone')).result?.['isError']).toBe(true);
        expect(JSON.parse(text(await call('SELECT id FROM records')))).toMatchObject({ rows: [{ id: 1 }] });

    });

    it('keeps agent confirmation denied outside MCP approval even when NOORM_YES is set', () => {

        const prior = process.env['NOORM_YES'];
        process.env['NOORM_YES'] = '1';
        try {

            const config = contextFor('test').noorm.config;
            expect(checkConfigPolicy('agent', config, 'sql:ddl').allowed).toBe(false);

        }
        finally {

            if (prior === undefined) delete process.env['NOORM_YES'];
            else process.env['NOORM_YES'] = prior;

        }

    });

    it('applies the same exploration policy to resources and requests approval for confirm reads', async () => {

        settings = parseSettings({ access: { roles: { operator: { permissions: { explore: 'confirm' } } } } });
        const params = { uri: 'noorm://configs/test/overview' };
        const initial = challengeSchema.parse((await wire.request('resources/read', params)).result);
        const result = await wire.request('resources/read', { ...params, requestState: initial.requestState, inputResponses: accepted });
        expect(result.error).toBeUndefined();
        const content = z.object({ contents: z.array(z.object({ text: z.string(), mimeType: z.string() })) }).parse(result.result);
        expect(content.contents[0]?.mimeType).toBe('application/json');
        expect(JSON.parse(content.contents[0]?.text ?? '{}').tables).toBe(0);
        settings = parseSettings({ access: { roles: { operator: { permissions: { explore: 'deny' } } } } });
        expect((await wire.request('resources/read', params)).error).toBeDefined();

    });

});
