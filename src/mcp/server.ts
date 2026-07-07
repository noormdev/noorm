import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { attempt, attemptSync } from '@logosdx/utils';

import type { RpcRegistry } from '../rpc/registry.js';
import type { SessionManager } from '../rpc/session.js';
import { checkConfigPolicy } from '../core/policy/index.js';
import type { RpcSession } from '../rpc/types.js';

/**
 * Create the MCP server with two tools: run_noorm_cmd and noorm_help.
 *
 * Wraps the RPC registry as an MCP transport layer. Commands are
 * discovered at runtime so the tool list stays in sync with the registry.
 */
export function createMcpServer(registry: RpcRegistry, session: SessionManager): McpServer {

    const server = new McpServer({
        name: 'noorm',
        version: '1.0.0',
    });

    // === run_noorm_cmd ===

    const runSchema = z.object({
        command: z.string().describe('Command name: "connect", "overview", "sql", "list_configs", etc.'),
        config: z.string().optional().describe('Config name for session lookup (defaults to active)'),
        payload: z.record(z.string(), z.unknown()).optional().describe('Command-specific input validated against its schema'),
    });

    server.tool(
        'run_noorm_cmd',
        'Execute a noorm command. Use noorm_help to discover available commands and their parameters.',
        runSchema.shape,
        async ({ command, config, payload }) => {

            const cmd = registry.get(command);

            if (!cmd) {

                const available = registry.list().map((c) => c.name).join(', ');

                return {
                    content: [{
                        type: 'text' as const,
                        text: JSON.stringify({ error: `Unknown command: "${command}". Available: ${available}` }),
                    }],
                    isError: true,
                };

            }

            // Merge config into payload for session commands (connect/disconnect).
            // For other commands, config selects which active session to use.
            const isSessionCmd = command === 'connect' || command === 'disconnect';
            let input = payload ?? {};

            if (isSessionCmd && config) {

                input = { ...input, config };

            }

            // Validate payload against command schema
            const validation = cmd.inputSchema.safeParse(input);

            if (!validation.success) {

                return {
                    content: [{
                        type: 'text' as const,
                        text: JSON.stringify({
                            error: 'Invalid payload',
                            details: validation.error.issues.map((i) => ({
                                path: i.path.join('.'),
                                message: i.message,
                            })),
                        }),
                    }],
                    isError: true,
                };

            }

            // Gate config-scoped commands before the handler ever runs. `'open'`
            // commands (list_configs, connect, disconnect) target no config and
            // skip this — target resolution itself requires an active connection.
            if (cmd.permission !== 'open') {

                const [target, targetErr] = attemptSync(() => session.getContext(config));

                if (targetErr) {

                    return {
                        content: [{
                            type: 'text' as const,
                            text: JSON.stringify({ error: targetErr.message }),
                        }],
                        isError: true,
                    };

                }

                const check = checkConfigPolicy(session.channel, target.noorm.config, cmd.permission);

                if (!check.allowed) {

                    return {
                        content: [{
                            type: 'text' as const,
                            text: JSON.stringify({ error: check.blockedReason ?? `"${cmd.permission}" is not allowed.` }),
                        }],
                        isError: true,
                    };

                }

            }

            // For non-session commands, scope the session to the requested config
            // so handlers calling session.getContext() internally get the right connection.
            const sessionForHandler = !isSessionCmd && config
                ? createConfigScopedSession(session, config)
                : session;

            const [result, err] = await attempt(
                () => cmd.handler(validation.data, sessionForHandler),
            );

            if (err) {

                return {
                    content: [{
                        type: 'text' as const,
                        text: JSON.stringify({ error: err.message, stack: err.stack }),
                    }],
                    isError: true,
                };

            }

            return {
                content: [{
                    type: 'text' as const,
                    text: JSON.stringify(result, null, 2),
                }],
            };

        },
    );

    // === noorm_help ===

    const helpSchema = z.object({
        command: z.string().optional().describe('Command name for detailed help. Omit to list all commands.'),
    });

    server.tool(
        'noorm_help',
        'Get help for noorm commands. Lists all available commands or shows detailed help for a specific command including parameters and examples.',
        helpSchema.shape,
        async ({ command }) => {

            if (command) {

                const help = registry.getHelp(command);

                if (!help) {

                    const available = registry.list().map((c) => c.name).join(', ');

                    return {
                        content: [{
                            type: 'text' as const,
                            text: JSON.stringify({ error: `Unknown command: "${command}". Available: ${available}` }),
                        }],
                        isError: true,
                    };

                }

                return {
                    content: [{ type: 'text' as const, text: help }],
                };

            }

            // List all commands
            const commands = registry.list();
            const lines = [
                '# noorm Commands',
                '',
                ...commands.map((c) => `- **${c.name}** — ${c.description}`),
                '',
                'Use noorm_help({ command: "<name>" }) for detailed help on a specific command.',
            ];

            return {
                content: [{ type: 'text' as const, text: lines.join('\n') }],
            };

        },
    );

    return server;

}

/**
 * Create a session proxy that scopes getContext() to a specific config.
 *
 * When the MCP envelope includes `config`, non-session commands should
 * use that config for session lookup without the command needing to know.
 */
function createConfigScopedSession(session: SessionManager, config: string): RpcSession {

    return new Proxy(session, {
        get(target, prop, receiver) {

            if (prop === 'getContext') {

                return () => target.getContext(config);

            }

            return Reflect.get(target, prop, receiver);

        },
    });

}
