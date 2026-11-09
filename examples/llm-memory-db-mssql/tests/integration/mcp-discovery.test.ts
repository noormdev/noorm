/**
 * Layer 4 — MCP discovery integration test.
 *
 * Exercises the noorm MCP server (`noorm mcp serve`) end-to-end. Spawns
 * the CLI as a subprocess, connects via the MCP TypeScript SDK over
 * stdio, and checks tool discovery, database exploration, and recovery
 * after an invalid tool request.
 *
 * The modern MCP client is hoisted at the monorepo root.
 * The subprocess CWD must be the example directory for project discovery.
 * Each database request explicitly targets the suite's provisioned test config;
 * no connection handshake or active database session is required.
 */
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

const PROJECT_ROOT = new URL('../..', import.meta.url).pathname;

let client: Client;
let transport: StdioClientTransport;

/**
 * Pull the first text payload out of an MCP tool call response.
 *
 * Every tool in noorm's MCP server (`src/mcp/server.ts`) returns
 * `content: [{ type: 'text', text: '...' }]`. The SDK's `callTool` return
 * type is a union of CallToolResult and a legacy compatibility envelope,
 * so we accept `unknown` and validate at runtime — same defensive shape
 * the SDK itself recommends in its samples.
 */
function firstText(result: unknown): string {

    if (typeof result !== 'object' || result === null) {

        throw new Error(`MCP tool call did not return an object; got: ${typeof result}`);
    }

    if (!('content' in result) || !Array.isArray(result.content)) {

        throw new Error(`MCP tool call did not return content array; got keys: ${Object.keys(result).join(', ')}`);
    }

    const block = result.content[0];

    if (typeof block !== 'object' || block === null) {

        throw new Error(`First content block is not an object; got: ${JSON.stringify(block)}`);
    }

    if (!('type' in block) || block.type !== 'text') {

        throw new Error(`First content block is not text; got type: ${'type' in block ? String(block.type) : '<missing>'}`);
    }

    if (!('text' in block) || typeof block.text !== 'string') {

        throw new Error(`First content block missing text string; got: ${JSON.stringify(block)}`);
    }

    return block.text;

}

/**
 * Read the `isError` flag from an MCP tool call response without widening
 * the SDK's union type. Returns `undefined` when the field is absent
 * (success envelopes from this server omit it).
 */
function isError(result: unknown): boolean | undefined {

    if (typeof result !== 'object' || result === null) return undefined;
    if (!('isError' in result)) return undefined;

    const value = result.isError;
    if (typeof value !== 'boolean') return undefined;

    return value;

}

beforeAll(async () => {

    // Build a string-only env. process.env declares values as `string | undefined`
    // but StdioClientTransport requires `Record<string, string>`. Drop the
    // undefined entries instead of casting.
    const env: Record<string, string> = {};
    for (const [key, value] of Object.entries(process.env)) {

        if (typeof value === 'string') env[key] = value;

    }

    transport = new StdioClientTransport({
        command: 'noorm',
        args: ['mcp', 'serve'],
        cwd: PROJECT_ROOT,
        // Inherit the parent env so PATH and the noorm identity are visible.
        env,
        // Pipe stderr so the MCP server's "running on stdio" banner doesn't
        // pollute test output. We don't read it, but piping prevents the
        // child from inheriting our terminal.
        stderr: 'pipe',
    });

    client = new Client({ name: 'mcp-discovery-test', version: '0.0.1' }, {
        versionNegotiation: { mode: { pin: '2026-07-28' } },
    });
    await client.connect(transport);


}, 30_000);

afterAll(async () => {

    if (client) {

        await client.close().catch(() => undefined);
    }

    if (transport) {

        await transport.close().catch(() => undefined);
    }

});

describe('mcp-discovery: direct tools', () => {

    it('advertises the core discovery tools', async () => {

        const result = await client.listTools();
        const names = result.tools.map((tool) => tool.name);
        for (const name of ['list_configs', 'overview', 'list', 'detail', 'sql']) {

            expect(names).toContain(name);

        }

    });

    it('returns the expected object counts for `overview` against dev', async () => {

        const result = await client.callTool({
            name: 'overview',
            arguments: { config: 'test' },
        });

        expect(isError(result)).toBeFalsy();

        const payload = JSON.parse(firstText(result));

        // Counts are pinned to the schema defined in `sql/`. A drift here
        // means the build emitted unexpected objects — that's a real signal,
        // not noise. Update both sides intentionally if the schema grows.
        expect(payload).toMatchObject({
            tables: 38,
            views: 18,
            procedures: 72,
            functions: 14,
            types: 4,
        });

    });

    it('lists the four composite TVP types via `list { category: "types" }`', async () => {

        const result = await client.callTool({
            name: 'list',
            arguments: { config: 'test', category: 'types' },
        });

        expect(isError(result)).toBeFalsy();

        const payload = JSON.parse(firstText(result));

        expect(Array.isArray(payload)).toBe(true);
        expect(payload).toHaveLength(4);

        const names = payload.map((t: { name: string }) => t.name).sort();

        expect(names).toEqual([
            'MemoryIdSet',
            'TagAttachmentInput',
            'TagIdSet',
            'TaskDependencyInput',
        ]);

    });

});

describe('mcp-discovery: error resilience', () => {

    it('rejects an unknown tool and keeps the server alive', async () => {

        await expect(client.callTool({ name: 'nonexistent.command', arguments: {} })).rejects.toThrow();
        const recovered = await client.callTool({ name: 'overview', arguments: { config: 'test' } });
        expect(isError(recovered)).toBeFalsy();
        expect(JSON.parse(firstText(recovered))).toMatchObject({ tables: 38 });

    });

});
