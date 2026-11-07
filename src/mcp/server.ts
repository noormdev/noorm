import { McpServer, ProtocolError, type CallToolResult, type InputRequiredResult, type ServerContext } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { attempt } from '@logosdx/utils';

import { createContext } from '../sdk/index.js';
import type { Context } from '../sdk/context.js';
import type { RpcRegistry } from '../rpc/registry.js';
import type { RpcCommand, RpcSession } from '../rpc/types.js';
import { classifyStatements, isVisibleToChannel, type Permission } from '../core/policy/index.js';
import { configNotFoundMessage } from '../core/config/resolver.js';
import { ApprovalManager, canonicalJson } from './approval.js';
import { prepareCommand } from './prepared.js';
import { registerExploreResources } from './resources.js';
import { registerNoormPrompts } from './prompts.js';

export type WithConfig = <T>(config: string, action: (ctx: Context) => Promise<T>) => Promise<T>;

export interface McpServerOptions {
    /** Request-scoped context boundary; also supports isolated database fixtures. */
    withConfig?: WithConfig;
}

/** Resolve policy and credentials anew per request; no preceding connect or active session. */
export const withConfigContext: WithConfig = async (config, action) => {

    const ctx = await createContext({ config, channel: 'agent' });
    if (!isVisibleToChannel(ctx.noorm.config.access, 'agent')) throw new Error(configNotFoundMessage(config));

    // Connecting is deferred until after the dispatch permission gate where possible.
    try {

        return await action(ctx);

    }
    finally {

        await ctx.disconnect();

    }

};

/** Adapter for transport-independent RPC handlers, scoped to this request's explicit target. */
function requestSession(ctx?: Context, signal?: AbortSignal): RpcSession {

    const context = (config?: string): Context => {

        if (!ctx || (config && config !== ctx.noorm.config.name)) throw new Error('An explicit config is required');

        return ctx;

    };

    return {
        channel: 'agent',
        signal,
        getContext: context,
        async connect(config) {

            const target = context(config);
            await target.connect();

            return {
                name: target.noorm.config.name,
                dialect: target.dialect,
                database: target.noorm.config.connection.database,
                role: target.noorm.config.access.agent === false ? 'viewer' : target.noorm.config.access.agent,
            };

        },
        async disconnect(config) {

            await context(config).disconnect();

        },
        async disconnectAll() {

            if (ctx) await ctx.disconnect();

        },
        hasConnection: (config) => Boolean(ctx?.connected && config === ctx.noorm.config.name),
        listConnections: () => ctx?.connected ? [ctx.noorm.config.name] : [],
    };

}

function toolError(message: string): CallToolResult {

    return { content: [{ type: 'text', text: JSON.stringify({ error: message }) }], isError: true };

}

/** Stateless individual tools, cookbook prompts, and resources over the 2026-07-28 protocol. */
export function createMcpServer(registry: RpcRegistry, options: McpServerOptions = {}): McpServer {

    const approvals = new ApprovalManager();
    const withConfig = options.withConfig ?? withConfigContext;
    const unavailableCommands: Record<string, true> = { connect: true, disconnect: true, status: true };
    const commands = () => registry.list().filter((command) => !Object.hasOwn(unavailableCommands, command.name));
    const server = new McpServer({ name: 'noorm', version: '1.0.0' }, {
        supportedProtocolVersions: ['2026-07-28'],
        capabilities: { tools: {}, resources: {}, prompts: {} },
        instructions: 'Use list_configs to discover targets, then call individual tools with config and their documented arguments. Database operations require an explicit config; no connect call is required. Cookbook prompts provide workflow guidance. Permission confirmations require human approval through MCP elicitation.',
        requestState: { verify: approvals.verify },
        cacheHints: {
            'tools/list': { ttlMs: 300000, cacheScope: 'public' },
            'prompts/list': { ttlMs: 300000, cacheScope: 'public' },
            'server/discover': { ttlMs: 300000, cacheScope: 'public' },
            'resources/list': { ttlMs: 0, cacheScope: 'private' },
            'resources/templates/list': { ttlMs: 300000, cacheScope: 'public' },
            'resources/read': { ttlMs: 0, cacheScope: 'private' },
        },
    });

    const tools = new Map<string, { command: RpcCommand; inputSchema: z.ZodObject }>();
    const runCommand = async (
        cmd: RpcCommand,
        config: string | undefined,
        payload: unknown,
        request: ServerContext,
    ): Promise<CallToolResult | InputRequiredResult> => {

        const command = cmd.name;

        const [result, err] = await attempt(async () => {

            if (cmd.permission === 'open') {

                if (request.mcpReq.requestState() !== undefined || request.mcpReq.inputResponses !== undefined) throw new Error('This command does not accept approval state');

                return { content: [{ type: 'text' as const, text: JSON.stringify(await cmd.handler(payload, requestSession()), null, 2) }] };

            }

            if (!config) throw new Error('An explicit config is required for database operations');

            return withConfig(config, async (ctx) => {

                if (!isVisibleToChannel(ctx.noorm.config.access, 'agent')) throw new Error(configNotFoundMessage(config));
                let permission: Permission = cmd.permission === 'open' ? 'explore' : cmd.permission;
                if (command === 'sql') {

                    const { query } = z.object({ query: z.string() }).parse(payload);
                    const kind = classifyStatements(query, ctx.dialect);
                    permission = kind === 'read' ? 'sql:read' : kind === 'write' ? 'sql:write' : 'sql:ddl';

                }

                const permissions: Permission[] = command === 'change_ff' ? [permission, 'change:run'] : [permission];

                return approvals.run(ctx, request, { command, config, payload }, permissions,
                    async () => {

                        await ctx.connect();
                        if (request.mcpReq.signal.aborted) throw new Error('Request cancelled');

                        return prepareCommand(command, payload, ctx);

                    },
                    async () => {

                        await ctx.connect();
                        if (request.mcpReq.signal.aborted) throw new Error('Request cancelled');
                        const output = await cmd.handler(payload, requestSession(ctx, request.mcpReq.signal));

                        return { content: [{ type: 'text' as const, text: JSON.stringify(output, null, 2) }] };

                    });

            });

        });
        if (err) {

            if (err instanceof ProtocolError) throw err;
            console.error(err.stack ?? err.message);

            return toolError(err.message);

        }

        return result;

    };

    const invokeTool = async (name: string, args: unknown, request: ServerContext) => {

        const tool = tools.get(name);
        if (!tool) throw new ProtocolError(-32602, `Unknown tool: ${name}`);
        const parsed = tool.inputSchema.safeParse(args ?? {});
        if (!parsed.success) throw new ProtocolError(-32602, `Invalid arguments for tool "${name}"`, { issues: parsed.error.issues });
        const { config, ...payload } = parsed.data;

        return runCommand(tool.command, typeof config === 'string' ? config : undefined, payload, request);

    };

    for (const { name } of commands()) {

        const command = registry.get(name);
        if (!command) continue;
        if (!(command.inputSchema instanceof z.ZodObject)) throw new Error(`MCP tool "${name}" requires an object input schema`);
        const inputSchema = (command.permission === 'open'
            ? command.inputSchema
            : command.inputSchema.safeExtend({ config: z.string().min(1).describe('Target database configuration name') })).strict();
        tools.set(name, { command, inputSchema });
        server.registerTool(name, {
            description: command.description,
            inputSchema,
            ...(command.permission === 'open' || command.permission === 'explore' ? { annotations: { readOnlyHint: true } } : {}),
        }, (args, request) => invokeTool(name, args, request));

    }

    // Preserve JSON-RPC capability errors instead of the SDK's high-level tool-error flattening.
    server.server.setRequestHandler('tools/call', ({ params }, request) => invokeTool(params.name, params.arguments, request));
    registerNoormPrompts(server);

    registerExploreResources(server, async (config, action, request, uri) => withConfig(config, async (ctx) => {

        if (!isVisibleToChannel(ctx.noorm.config.access, 'agent')) throw new Error(configNotFoundMessage(config));

        return approvals.run(ctx, request, { uri }, ['explore'], async () => ({
            summary: `Read database metadata resource: ${uri}`,
            fingerprint: canonicalJson({ uri }),
            run: async (read) => read(),
        }), async () => {

            await ctx.connect();
            if (request.mcpReq.signal.aborted) throw new Error('Request cancelled');

            return action(ctx);

        });

    }));

    return server;

}
