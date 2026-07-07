import type { z } from 'zod';
import type { Context } from '../sdk/context.js';
import type { Config } from '../core/config/types.js';
import { checkPolicy } from '../core/policy/index.js';
import type { Channel, Permission, PolicyCheck, Role } from '../core/policy/index.js';

/**
 * A registered RPC command.
 *
 * Commands are transport-agnostic — they define what operations are available,
 * validate input via Zod, and execute against SDK/core functions. `permission`
 * gates the command at dispatch (`src/mcp/server.ts`); `'open'` means the
 * command targets no config and skips the gate (`list_configs`, `connect`,
 * `disconnect`).
 */
export interface RpcCommand<TInput = unknown, TOutput = unknown> {

    name: string;
    description: string;
    examples: RpcExample[];
    inputSchema: z.ZodType<TInput>;
    permission: Permission | 'open';
    handler: (input: TInput, session: RpcSession) => Promise<TOutput>;

}

/**
 * Session interface for RPC command handlers.
 *
 * Provides access to database connections and the channel (`user`/`mcp`)
 * the session was opened on, so handlers can run channel-aware policy
 * checks (e.g. the `sql` command's statement-class escalation).
 * Implemented by SessionManager in session.ts.
 */
export interface RpcSession {

    readonly channel: Channel;
    getContext(config?: string): Context;
    connect(config?: string): Promise<{ name: string; dialect: string; database: string; role: Role }>;
    disconnect(config?: string): Promise<void>;
    disconnectAll(): Promise<void>;
    hasConnection(config: string): boolean;
    listConnections(): string[];

}

/**
 * Runs `checkPolicy` against a config's access, failing closed when
 * `access` is absent instead of trusting the type-level optionality
 * (docs/spec/config-access-roles.md#data-model). In practice this never
 * triggers on the RPC path — every config reaching a command handler came
 * through `parseConfig`/state load, which always populates `access`.
 *
 * @example
 * const check = checkConfigPolicy('mcp', ctx.noorm.config, 'sql:write');
 * if (!check.allowed) throw new RpcError(check.blockedReason ?? 'denied');
 */
export function checkConfigPolicy(channel: Channel, config: Config, permission: Permission): PolicyCheck {

    if (!config.access) {

        return {
            allowed: false,
            requiresConfirmation: false,
            blockedReason: `Config "${config.name}" has no access configuration.`,
        };

    }

    return checkPolicy(channel, { name: config.name, access: config.access }, permission);

}

/**
 * Example usage for a command, shown in help output.
 */
export interface RpcExample {

    description: string;
    input: Record<string, unknown>;

}

/**
 * Command summary for listing.
 */
export interface RpcCommandInfo {

    name: string;
    description: string;

}

/**
 * Error thrown by RPC command handlers.
 */
export class RpcError extends Error {

    override readonly name = 'RpcError' as const;

    constructor(message: string, detail?: string) {

        super(detail ? `${message}: ${detail}` : message);

    }

}
