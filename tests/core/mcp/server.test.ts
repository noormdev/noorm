/**
 * Integration tests for the MCP server dispatch layer.
 *
 * Uses InMemoryTransport + Client to exercise the full JSON-RPC
 * pipeline through createMcpServer without a real network transport.
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { z } from 'zod';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

import { createMcpServer } from '../../../src/mcp/server.js';
import { RpcRegistry } from '../../../src/rpc/registry.js';
import type { RpcCommand, RpcSession } from '../../../src/rpc/types.js';
import type { ConfigAccess } from '../../../src/core/policy/index.js';
import type { Context } from '../../../src/sdk/context.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Build a wired Client+Server pair backed by InMemoryTransport.
 *
 * Returns the client (already connected) and a cleanup function.
 */
async function createTestPair(registry: RpcRegistry, session: RpcSession) {

    const server = createMcpServer(registry, session as never);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    const client = new Client({ name: 'test-client', version: '1.0.0' });

    await server.connect(serverTransport);
    await client.connect(clientTransport);

    const cleanup = async () => {

        await client.close();

    };

    return { client, cleanup };

}

/**
 * Call a tool and return the first text content item parsed as JSON.
 */
async function callJson(
    client: Client,
    tool: string,
    args: Record<string, unknown>,
) {

    const result = await client.callTool({ name: tool, arguments: args });
    const content = result.content[0];

    if (!content || content.type !== 'text') throw new Error('No text content');

    return {
        isError: result.isError,
        text: content.text,
        parsed: JSON.parse(content.text) as unknown,
    };

}

/**
 * Call a tool and return the raw text content (not JSON-parsed).
 */
async function callText(
    client: Client,
    tool: string,
    args: Record<string, unknown>,
) {

    const result = await client.callTool({ name: tool, arguments: args });
    const content = result.content[0];

    if (!content || content.type !== 'text') throw new Error('No text content');

    return {
        isError: result.isError,
        text: content.text,
    };

}

// ── Mock primitives ───────────────────────────────────────────────────────────

const mockContext = {} as Context;

/**
 * Builds a fake Context carrying a config with the given access — used to
 * drive the dispatch gate's `checkConfigPolicy` call. `access: undefined`
 * simulates a config that reached enforcement without `access` populated
 * (fail-closed case).
 */
function mockContextWithAccess(access: ConfigAccess | undefined, name = 'test'): Context {

    return {
        noorm: {
            config: {
                name,
                access,
                connection: { database: 'testdb' },
            },
        },
    } as unknown as Context;

}

function buildMockSession(overrides: Partial<RpcSession> = {}): RpcSession & {
    getContextCalls: string[];
} {

    const getContextCalls: string[] = [];

    return {
        channel: 'mcp',
        getContextCalls,
        getContext(config?: string) {

            getContextCalls.push(config ?? 'default');

            return mockContext;

        },
        connect: async () => ({
            name: 'test',
            dialect: 'postgres',
            database: 'testdb',
            role: 'admin',
        }),
        disconnect: async () => {},
        disconnectAll: async () => {},
        hasConnection: () => false,
        listConnections: () => [],
        ...overrides,
    };

}

function buildRegistry() {

    const registry = new RpcRegistry();

    registry.register({
        name: 'test_cmd',
        description: 'A test command',
        examples: [{ description: 'basic', input: { value: 'hello' } }],
        inputSchema: z.object({ value: z.string().describe('Test value') }),
        permission: 'open',
        handler: async (input) => ({ echo: (input as { value: string }).value }),
    });

    registry.register({
        name: 'failing_cmd',
        description: 'A command that always throws',
        examples: [],
        inputSchema: z.object({}),
        permission: 'open',
        handler: async () => {

            throw new Error('boom');

        },
    });

    // Minimal stand-in for a session command (connect)
    registry.register({
        name: 'connect',
        description: 'Connect to a database',
        examples: [{ description: 'connect to active config', input: {} }],
        inputSchema: z.object({
            config: z.string().optional().describe('Config name'),
        }),
        permission: 'open',
        handler: async (_input, session) => session.connect(),
    });

    return registry;

}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('mcp: server dispatch (run_noorm_cmd)', () => {

    let registry: RpcRegistry;
    let mockSession: ReturnType<typeof buildMockSession>;
    let client: Client;
    let cleanup: () => Promise<void>;

    beforeEach(async () => {

        registry = buildRegistry();
        mockSession = buildMockSession();

        const pair = await createTestPair(registry, mockSession);

        client = pair.client;
        cleanup = pair.cleanup;

    });

    afterEach(async () => {

        await cleanup();

    });

    it('should return isError for unknown command with available list', async () => {

        const { isError, parsed } = await callJson(client, 'run_noorm_cmd', {
            command: 'nonexistent',
            payload: {},
        });

        const body = parsed as { error: string };

        expect(isError).toBe(true);
        expect(body.error).toContain('Unknown command');
        expect(body.error).toContain('nonexistent');
        expect(body.error).toContain('test_cmd');

    });

    it('should return isError with Zod details for invalid payload', async () => {

        const { isError, parsed } = await callJson(client, 'run_noorm_cmd', {
            command: 'test_cmd',
            payload: { wrong_field: 123 },
        });

        const body = parsed as { error: string; details: { path: string; message: string }[] };

        expect(isError).toBe(true);
        expect(body.error).toBe('Invalid payload');
        expect(Array.isArray(body.details)).toBe(true);
        expect(body.details.length).toBeGreaterThan(0);
        expect(body.details[0]!.path).toBe('value');

    });

    it('should return JSON result for valid command', async () => {

        const { isError, parsed } = await callJson(client, 'run_noorm_cmd', {
            command: 'test_cmd',
            payload: { value: 'hello' },
        });

        const body = parsed as { echo: string };

        expect(isError).toBeFalsy();
        expect(body.echo).toBe('hello');

    });

    it('should return isError with message and stack when handler throws', async () => {

        const { isError, parsed } = await callJson(client, 'run_noorm_cmd', {
            command: 'failing_cmd',
            payload: {},
        });

        const body = parsed as { error: string; stack: string };

        expect(isError).toBe(true);
        expect(body.error).toBe('boom');
        expect(typeof body.stack).toBe('string');
        expect(body.stack).toContain('boom');

    });

    it('should create config-scoped session proxy for non-session commands with config', async () => {

        await callJson(client, 'run_noorm_cmd', {
            command: 'test_cmd',
            payload: { value: 'scoped' },
            config: 'myconfig',
        });

        // test_cmd handler doesn't call getContext, but the proxy wraps it.
        // Register a command that does call session.getContext so we can observe the proxy.
        const scopedRegistry = new RpcRegistry();
        scopedRegistry.register({
            name: 'ctx_cmd',
            description: 'Calls getContext',
            examples: [],
            inputSchema: z.object({}),
            permission: 'open',
            handler: async (_input, session) => {

                session.getContext();

                return { ok: true };

            },
        });

        const scopedSession = buildMockSession();
        const scopedPair = await createTestPair(scopedRegistry, scopedSession);

        await scopedPair.client.callTool({
            name: 'run_noorm_cmd',
            arguments: { command: 'ctx_cmd', payload: {}, config: 'prod' },
        });

        await scopedPair.cleanup();

        // The proxy should have forwarded getContext() with 'prod' scoped in
        expect(scopedSession.getContextCalls).toEqual(['prod']);
        const capturedValue = scopedSession.getContextCalls[0];
        expect(capturedValue).toBe('prod');

    });

    it('should merge config into payload for session command (connect)', async () => {

        const sessionWithTracker = buildMockSession({
            connect: async (config?: string) => {

                return {
                    name: config ?? 'active',
                    dialect: 'postgres',
                    database: 'testdb',
                    role: 'admin',
                };

            },
        });

        const r = new RpcRegistry();

        r.register({
            name: 'connect',
            description: 'Connect',
            examples: [],
            inputSchema: z.object({ config: z.string().optional() }),
            permission: 'open',
            handler: async (input, session) => session.connect((input as { config?: string }).config),
        });

        const { client: c, cleanup: done } = await createTestPair(r, sessionWithTracker);

        const { parsed } = await callJson(c, 'run_noorm_cmd', {
            command: 'connect',
            config: 'staging',
            payload: {},
        });

        await done();

        const body = parsed as { name: string };

        expect(body.name).toBe('staging');

    });

});

describe('mcp: server dispatch — policy gate (CP3)', () => {

    /**
     * Registers a single gated command and wires a session whose
     * `getContext` resolves to a config with the given access, so the
     * dispatch gate's `checkConfigPolicy` call is exercised end-to-end.
     */
    async function setup(
        permission: RpcCommand['permission'],
        access: ConfigAccess | undefined,
    ) {

        const called = { value: false };
        const registry = new RpcRegistry();

        registry.register({
            name: 'gated_cmd',
            description: 'A permission-gated command',
            examples: [],
            inputSchema: z.object({}),
            permission,
            handler: async () => {

                called.value = true;

                return { ok: true };

            },
        });

        const session = buildMockSession({
            getContext: () => mockContextWithAccess(access),
        });

        const { client, cleanup } = await createTestPair(registry, session);

        return { client, cleanup, called };

    }

    it('should deny and never invoke the handler when the resolved role denies the permission (viewer)', async () => {

        const { client, cleanup, called } = await setup('change:run', { user: 'admin', mcp: 'viewer' });

        const { isError, parsed } = await callJson(client, 'run_noorm_cmd', { command: 'gated_cmd', payload: {} });

        await cleanup();

        const body = parsed as { error: string };

        expect(isError).toBe(true);
        expect(body.error).toContain('change:run');
        expect(called.value).toBe(false);

    });

    it('should collapse an operator confirm cell to deny on the mcp channel', async () => {

        const { client, cleanup, called } = await setup('change:run', { user: 'admin', mcp: 'operator' });

        const { isError, parsed } = await callJson(client, 'run_noorm_cmd', { command: 'gated_cmd', payload: {} });

        await cleanup();

        const body = parsed as { error: string };

        expect(isError).toBe(true);
        expect(body.error.toLowerCase()).toContain('cli');
        expect(called.value).toBe(false);

    });

    it('should allow and invoke the handler when the resolved role allows the permission (admin)', async () => {

        const { client, cleanup, called } = await setup('change:run', { user: 'admin', mcp: 'admin' });

        const { isError } = await callJson(client, 'run_noorm_cmd', { command: 'gated_cmd', payload: {} });

        await cleanup();

        expect(isError).toBeFalsy();
        expect(called.value).toBe(true);

    });

    it('should fail closed and deny when the resolved config has no access at all', async () => {

        const { client, cleanup, called } = await setup('explore', undefined);

        const { isError } = await callJson(client, 'run_noorm_cmd', { command: 'gated_cmd', payload: {} });

        await cleanup();

        expect(isError).toBe(true);
        expect(called.value).toBe(false);

    });

    it("should skip the gate entirely for 'open' commands, even when getContext would throw", async () => {

        const registry = new RpcRegistry();

        registry.register({
            name: 'open_cmd',
            description: 'An open command',
            examples: [],
            inputSchema: z.object({}),
            permission: 'open',
            handler: async () => ({ ok: true }),
        });

        const session = buildMockSession({
            getContext: () => {

                throw new Error('should not be called for an open command');

            },
        });

        const { client, cleanup } = await createTestPair(registry, session);

        const { isError } = await callJson(client, 'run_noorm_cmd', { command: 'open_cmd', payload: {} });

        await cleanup();

        expect(isError).toBeFalsy();

    });

});

describe('mcp: server dispatch (noorm_help)', () => {

    let registry: RpcRegistry;
    let mockSession: ReturnType<typeof buildMockSession>;
    let client: Client;
    let cleanup: () => Promise<void>;

    beforeEach(async () => {

        registry = buildRegistry();
        mockSession = buildMockSession();

        const pair = await createTestPair(registry, mockSession);

        client = pair.client;
        cleanup = pair.cleanup;

    });

    afterEach(async () => {

        await cleanup();

    });

    it('should list all commands when no command is specified', async () => {

        const { isError, text } = await callText(client, 'noorm_help', {});

        expect(isError).toBeFalsy();
        expect(text).toContain('test_cmd');
        expect(text).toContain('failing_cmd');
        expect(text).toContain('connect');

    });

    it('should return detailed help for a specific command', async () => {

        const { isError, text } = await callText(client, 'noorm_help', {
            command: 'test_cmd',
        });

        expect(isError).toBeFalsy();
        expect(text).toContain('test_cmd');
        expect(text).toContain('A test command');
        expect(text).toContain('value');
        expect(text).toContain('basic');

    });

    it('should return isError for help on unknown command', async () => {

        const { isError, parsed } = await callJson(client, 'noorm_help', {
            command: 'nonexistent',
        });

        const body = parsed as { error: string };

        expect(isError).toBe(true);
        expect(body.error).toContain('Unknown command');
        expect(body.error).toContain('nonexistent');
        expect(body.error).toContain('test_cmd');

    });

});
