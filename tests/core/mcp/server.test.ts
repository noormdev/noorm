import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test';
import { existsSync } from 'node:fs';
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { sql } from 'kysely';
import { stringify as stringifyYaml } from 'yaml';
import { InMemoryTransport, type McpServer } from '@modelcontextprotocol/server';
import type { StdioServerHandle } from '@modelcontextprotocol/server/stdio';
import { z } from 'zod';

import { createMcpServer } from '../../../src/mcp/server.js';
import { serveModernMcp } from '../../../src/mcp/stdio.js';
import { createRegistry } from '../../../src/rpc/index.js';
import { Context } from '../../../src/sdk/context.js';
import { ChangesNamespace } from '../../../src/sdk/namespaces/changes.js';
import { parseConfig } from '../../../src/core/config/schema.js';
import { parseSettings } from '../../../src/core/settings/schema.js';
import { checkConfigPolicy } from '../../../src/core/policy/index.js';
import { initState, resetStateManager } from '../../../src/core/state/index.js';
import { resetSettingsManager } from '../../../src/core/settings/index.js';
import { generateKeyPair, setKeyOverride, clearKeyOverride } from '../../../src/core/identity/index.js';
import { v1 } from '../../../src/core/version/schema/migrations/v1.js';
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
    request(method: string, params?: Record<string, unknown>, clientCapabilities?: unknown, version?: string | null): Promise<WireResponse>;
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
        async request(method: string, params: Record<string, unknown> = {}, clientCapabilities: unknown = capabilities, version: string | null = '2026-07-28') {

            const requestId = ++id;
            const { promise: result, resolve } = Promise.withResolvers<WireResponse>();
            pending.set(requestId, resolve);
            await client.send({ jsonrpc: '2.0', id: requestId, method, params: {
                ...params,
                ...(version === null ? {} : { _meta: {
                    'io.modelcontextprotocol/protocolVersion': version,
                    'io.modelcontextprotocol/clientCapabilities': clientCapabilities,
                    'io.modelcontextprotocol/clientInfo': { name: 'regression-client', version: '1' },
                } }),
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
    let role: string | false;
    let password: string | undefined;
    let user: string | undefined;
    let ssl: { ca: string } | undefined;
    let wire: WireClient;
    let handle: StdioServerHandle;
    let restoreDiagnostics: () => void;
    let previousCwd: string;

    const configFor = (name: string) => parseConfig({
        name, type: 'local', isTest: true,
        connection: { dialect: 'sqlite', database: join(root, `${name}.db`), password, user, ssl },
        access: { user: 'admin', agent: role },
    });
    const contextFor = (name: string) => new Context(configFor(name), settings,
        { name: 'MCP regression', source: 'system' }, { channel: 'agent' }, root);
    /** Writes the fixture to disk, where the shipped request path reads policy and credentials from. */
    const persistFixture = async () => {

        const state = await initState(root);
        for (const name of ['test', 'other']) await state.setConfig(name, configFor(name));
        await mkdir(join(root, '.noorm'), { recursive: true });
        await writeFile(join(root, '.noorm', 'settings.yml'), stringifyYaml(settings));

    };
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
    const initializeTracker = async () => {

        const ctx = contextFor('test');
        await ctx.connect();
        try {

            await v1.up(ctx.kysely, 'sqlite');

        }
        finally {

            await ctx.disconnect();

        }

    };


    beforeEach(async () => {

        resetStateManager();
        resetSettingsManager();
        root = await mkdtemp(join(tmpdir(), 'noorm-modern-mcp-'));
        previousCwd = process.cwd();
        process.chdir(root);
        setKeyOverride((await generateKeyPair()).privateKey);
        settings = parseSettings({ access: { roles: { operator: { permissions: { 'sql:ddl': 'confirm' } } } } });
        role = 'operator';
        password = undefined;
        user = undefined;
        ssl = undefined;
        const diagnostics = spyOn(console, 'error').mockImplementation(() => {});
        restoreDiagnostics = () => {

            diagnostics.mockRestore();

        };
        const connected = await connectWire(createMcpServer(createRegistry()));
        handle = connected.handle;
        wire = {
            handle,
            request: async (...args) => {

                await persistFixture();

                return connected.request(...args);

            },
        };

    });

    afterEach(async () => {

        process.chdir(previousCwd);
        await handle?.close();
        restoreDiagnostics?.();
        clearKeyOverride();
        await rm(root, { recursive: true, force: true });
        resetStateManager();
        resetSettingsManager();

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

    it('delegates legacy negotiation while requiring metadata after a modern request', async () => {

        const legacy = await wire.request('initialize', {
            protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'legacy', version: '1' },
        }, capabilities, null);
        expect(legacy.error?.code).toBe(-32022);
        expect(legacy.error?.['data']).toMatchObject({ supported: ['2026-07-28'] });
        expect((await wire.request('server/discover')).result).toBeDefined();
        expect((await wire.request('tools/list')).result).toBeDefined();
        expect((await wire.request('tools/list', {}, capabilities, null)).error?.code).toBe(-32602);

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

    it('redacts connection credentials from the elicitation and warns about transformed values', async () => {

        password = 'private-database-password';
        const query = `CREATE TABLE credential_review (value TEXT DEFAULT '${password}')`;
        const initial = challengeSchema.parse((await call(query)).result);
        const review = JSON.stringify(initial.inputRequests);
        expect(review).not.toContain(password);
        expect(review).toContain('[REDACTED SECRET]');
        expect(review).toContain('best-effort');
        expect(review).toContain('transformed');

    });

    it('shows user and database names as written when they are the same string, but never the password', async () => {

        password = 'private-database-password';
        user = join(root, 'test.db');
        const query = `CREATE TABLE orders (note TEXT DEFAULT '${password}') -- ${user}`;
        const initial = challengeSchema.parse((await call(query)).result);
        const review = JSON.stringify(initial.inputRequests);
        expect(review).toContain(`database \\"${user}\\"`);
        expect(review).toContain(`-- ${user}`);
        expect(review).not.toContain(password);
        expect(review).toContain('[REDACTED SECRET]');

    });

    it('keeps redacting SSL material', async () => {

        ssl = { ca: 'private-ca-material' };
        const query = `CREATE TABLE ssl_review (note TEXT DEFAULT '${ssl.ca}')`;
        const review = JSON.stringify(challengeSchema.parse((await call(query)).result).inputRequests);
        expect(review).not.toContain(ssl.ca);
        expect(review).toContain('[REDACTED SECRET]');

    });

    it('runs preflight once per approval', async () => {

        settings = parseSettings({
            paths: { sql: 'sql', changes: 'changes' },
            access: { roles: { operator: { permissions: { 'change:ff': 'confirm' } } } },
        });
        await initializeTracker();
        const discover = spyOn(ChangesNamespace.prototype, 'discover');
        try {

            challengeSchema.parse((await wire.request('tools/call', { name: 'change_ff', arguments: { config: 'test' } })).result);
            expect(discover).toHaveBeenCalledTimes(1);

        }
        finally {

            discover.mockRestore();

        }

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
        expect((await call(query, { requestState: initial.requestState, inputResponses: accepted })).result?.['isError']).not.toBe(true);
        expect(await tables()).toContain('original');
        expect(await tables()).not.toContain('changed');

    });

    it('does not reuse approval for a different direct tool', async () => {

        await writeFile(join(root, 'other.sql'), 'SELECT 1;');
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
    it('reissues the same challenge without a response and preserves its original captured operation', async () => {

        const query = 'CREATE TABLE retried (id INTEGER)';
        const initial = challengeSchema.parse((await call(query)).result);
        const retry = challengeSchema.parse((await call(query, { requestState: initial.requestState })).result);
        expect(retry).toEqual(initial);
        expect(await tables()).not.toContain('retried');
        expect((await call(query, { requestState: retry.requestState, inputResponses: accepted })).result?.['isError']).not.toBe(true);
        expect(await tables()).toContain('retried');

    });

    it('retains the captured file plan when a response-free retry is reissued', async () => {

        settings = parseSettings({ access: { roles: { operator: { permissions: { 'run:file': 'confirm' } } } } });
        await initializeTracker();
        const file = join(root, 'reviewed.sql');
        const args = { config: 'test', path: 'reviewed.sql' };
        await writeFile(file, 'CREATE TABLE captured_file (id INTEGER);');
        const initial = challengeSchema.parse((await wire.request('tools/call', { name: 'run_file', arguments: args })).result);
        await writeFile(file, 'CREATE TABLE substituted_file (id INTEGER);');
        const retry = challengeSchema.parse((await wire.request('tools/call', {
            name: 'run_file', arguments: args, requestState: initial.requestState,
        })).result);
        expect(retry).toEqual(initial);
        const result = await wire.request('tools/call', {
            name: 'run_file', arguments: args, requestState: retry.requestState, inputResponses: accepted,
        });
        expect(result.result?.['isError']).not.toBe(true);
        expect(JSON.parse(text(result))).toMatchObject({ status: 'success' });
        expect(await tables()).toContain('captured_file');
        expect(await tables()).not.toContain('substituted_file');

    });

    it('rejects templates before loading helpers or performing schema setup on confirm plans', async () => {

        settings = parseSettings({
            paths: { sql: 'sql', changes: 'changes' },
            access: { roles: { operator: { permissions: {
                'run:file': 'confirm', 'run:build': 'confirm', 'change:run': 'confirm', 'change:ff': 'confirm', 'change:revert': 'confirm',
            } } } },
        });
        const sqlDir = join(root, 'sql');
        const changeDir = join(root, 'changes', '2026-01-01-template', 'change');
        await mkdir(sqlDir, { recursive: true });
        await mkdir(changeDir, { recursive: true });
        const revertDir = join(root, 'changes', '2026-01-01-template', 'revert');
        await mkdir(revertDir, { recursive: true });
        const marker = join(root, 'helper-ran');
        await writeFile(join(sqlDir, '$helpers.mjs'), `import { writeFileSync } from 'node:fs'; writeFileSync(${JSON.stringify(marker)}, 'ran'); export const x = 1;`);
        await writeFile(join(sqlDir, 'unsafe.sql.tmpl'), 'SELECT {%~ $.x %};');
        await writeFile(join(changeDir, '001.txt'), 'unsafe.sql.tmpl\n');
        await writeFile(join(revertDir, '001.sql.tmpl'), 'SELECT 1;');
        for (const [name, args] of [
            ['run_file', { path: 'sql/unsafe.sql.tmpl' }],
            ['run_build', {}],
            ['change_run', { name: '2026-01-01-template' }],
            ['change_revert', { name: '2026-01-01-template' }],
            ['change_ff', {}],
        ] as const) {

            const result = await wire.request('tools/call', { name, arguments: { config: 'test', ...args } });
            expect(result.result?.['isError']).toBe(true);
            expect(JSON.parse(text(result)).error).toMatch(/templates/i);
            expect(existsSync(marker)).toBe(false);
            if (name === 'change_ff') expect(await tables()).toEqual([]);
            else expect(existsSync(join(root, 'test.db'))).toBe(false);

        }
        await writeFile(join(sqlDir, 'safe.sql'), 'SELECT 1;');
        const args = { config: 'test', path: 'sql/safe.sql' };
        const initial = challengeSchema.parse((await wire.request('tools/call', { name: 'run_file', arguments: args })).result);
        await wire.request('tools/call', { name: 'run_file', arguments: args, requestState: initial.requestState,
            inputResponses: { approval: { action: 'decline' } } });
        expect(existsSync(marker)).toBe(false);

    });

    it('runs trusted executable templates when run_file is allowed', async () => {

        settings = parseSettings({ access: { roles: { operator: { permissions: { 'run:file': 'allow' } } } } });
        await initializeTracker();
        const sqlDir = join(root, 'sql');
        await mkdir(sqlDir);
        const marker = join(root, 'helper-ran');
        await writeFile(join(sqlDir, '$helpers.mjs'), `import { writeFileSync } from 'node:fs'; writeFileSync(${JSON.stringify(marker)}, 'ran'); export const tableName = 'trusted_template';`);
        await writeFile(join(sqlDir, 'trusted.sql.tmpl'), 'CREATE TABLE {%~ $.tableName %} (id INTEGER);');
        const result = await wire.request('tools/call', { name: 'run_file', arguments: { config: 'test', path: 'sql/trusted.sql.tmpl' } });
        expect(result.result?.['isError']).not.toBe(true);
        expect(JSON.parse(text(result))).toMatchObject({ status: 'success' });
        expect(existsSync(marker)).toBe(true);
        expect(await tables()).toContain('trusted_template');

    });

    for (const cell of ['allow', 'confirm'] as const) {

        it(`keeps run_file inside the canonical project root on ${cell}`, async () => {

            settings = parseSettings({ access: { roles: { operator: { permissions: { 'run:file': cell } } } } });
            const outside = await mkdtemp(join(tmpdir(), 'noorm-outside-'));
            try {

                const file = join(outside, 'escape.sql');
                await writeFile(file, 'CREATE TABLE escaped (id INTEGER);');
                await symlink(file, join(root, 'link.sql'));
                for (const target of [file, join('..', basename(outside), 'escape.sql'), 'link.sql']) {

                    const response = await wire.request('tools/call', { name: 'run_file', arguments: { config: 'test', path: target } });
                    expect(response.result?.['isError']).toBe(true);

                }
                expect(existsSync(join(root, 'test.db'))).toBe(false);
                await initializeTracker();
                await writeFile(join(root, 'inside.sql'), 'CREATE TABLE inside_file (id INTEGER);');
                const response = await wire.request('tools/call', { name: 'run_file', arguments: { config: 'test', path: 'inside.sql' } });
                if (cell === 'confirm') {

                    const initial = challengeSchema.parse(response.result);
                    const declined = await wire.request('tools/call', { name: 'run_file', arguments: { config: 'test', path: 'inside.sql' },
                        requestState: initial.requestState, inputResponses: { approval: { action: 'decline' } } });
                    expect(declined.result?.['isError']).toBe(true);
                    expect(await tables()).not.toContain('inside_file');

                }
                else {

                    expect(JSON.parse(text(response))).toMatchObject({ status: 'success' });
                    expect(await tables()).toContain('inside_file');

                }

            }
            finally {

                await rm(outside, { recursive: true, force: true });

            }

        });

    }

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

    it('denies a mixed batch when its write permission is denied even if DDL is allowed', async () => {

        const ctx = contextFor('test');
        await ctx.connect();
        await sql`CREATE TABLE records (id INTEGER PRIMARY KEY)`.execute(ctx.kysely);
        await sql`INSERT INTO records VALUES (1)`.execute(ctx.kysely);
        await ctx.disconnect();
        settings = parseSettings({ access: { roles: { schema_only: { extends: 'viewer', permissions: {
            'sql:write': 'deny', 'sql:ddl': 'allow',
        } } } } });
        role = 'schema_only';

        expect((await call('DELETE FROM records')).result?.['isError']).toBe(true);
        expect((await call('DELETE FROM records; CREATE TABLE marker(id int)')).result?.['isError']).toBe(true);
        expect(JSON.parse(text(await call('SELECT id FROM records')))).toMatchObject({ rows: [{ id: 1 }] });
        expect(await tables()).not.toContain('marker');

    });

    it('requests approval for a write inside an otherwise allowed DDL batch before executing any statement', async () => {

        const ctx = contextFor('test');
        await ctx.connect();
        await sql`CREATE TABLE records (id INTEGER PRIMARY KEY)`.execute(ctx.kysely);
        await sql`INSERT INTO records VALUES (1)`.execute(ctx.kysely);
        await ctx.disconnect();
        settings = parseSettings({ access: { roles: { schema_only: { extends: 'viewer', permissions: {
            'sql:write': 'confirm', 'sql:ddl': 'allow',
        } } } } });
        role = 'schema_only';
        const query = 'DELETE FROM records; CREATE TABLE marker(id int)';
        const initial = challengeSchema.parse((await call(query)).result);
        expect(JSON.stringify(initial.inputRequests)).toContain('sql:write');
        expect(JSON.stringify(initial.inputRequests)).toContain('sql:ddl');
        expect(JSON.parse(text(await call('SELECT id FROM records')))).toMatchObject({ rows: [{ id: 1 }] });
        expect(await tables()).not.toContain('marker');
        const result = await call(query, { requestState: initial.requestState, inputResponses: accepted });
        expect(result.result?.['isError']).not.toBe(true);

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

    it('requests approval for the overview tool under a confirm cell and reads after acceptance', async () => {

        settings = parseSettings({ access: { roles: { operator: { permissions: { explore: 'confirm' } } } } });
        const params = { name: 'overview', arguments: { config: 'test' } };
        const initial = challengeSchema.parse((await wire.request('tools/call', params)).result);
        const result = await wire.request('tools/call', { ...params, requestState: initial.requestState, inputResponses: accepted });
        expect(result.result?.['isError']).not.toBe(true);
        expect(JSON.parse(text(result)).tables).toBe(0);

    });

    it('reports malformed, missing and hidden resources with protocol errors', async () => {

        role = 'viewer';
        const invalid = await wire.request('resources/read', { uri: 'noorm://configs/test/objects/indexes/item' });
        expect(invalid.error?.code).toBe(-32602);
        const missingObject = await wire.request('resources/read', { uri: 'noorm://configs/test/objects/tables/absent' });
        expect(missingObject.error?.code).toBe(-32602);
        expect(missingObject.error?.['data']).toMatchObject({ uri: 'noorm://configs/test/objects/tables/absent' });
        const missing = await wire.request('resources/read', { uri: 'noorm://configs/missing/overview' });
        role = false;
        const hidden = await wire.request('resources/read', { uri: 'noorm://configs/test/overview' });
        expect(hidden.error?.code).toBe(-32602);
        expect(hidden.error?.message).toBe(missing.error?.message);
        expect(hidden.error?.['data']).toMatchObject({ uri: 'noorm://configs/test/overview' });
        expect(missing.error?.['data']).toMatchObject({ uri: 'noorm://configs/missing/overview' });

    });

});
