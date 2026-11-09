import type { z } from 'zod';
import type { Context } from '../sdk/context.js';
import type { Channel, Permission } from '../core/policy/index.js';

/**
 * A registered RPC command.
 *
 * Commands are transport-agnostic — they define what operations are available,
 * validate input via Zod, and execute against SDK/core functions. `permission`
 * gates the command at dispatch (`src/mcp/server.ts`); `'open'` means the
 * command targets no config and skips the gate (`list_configs`).
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
 * Provides access to the request's context and the channel (`user`/`agent`)
 * the session was opened on, so handlers can run channel-aware policy
 * checks (e.g. the `sql` command's statement-class escalation).
 */
export interface RpcSession {

    readonly channel: Channel;
    /** Cancellation for this request, when the transport supports it. */
    readonly signal?: AbortSignal;
    getContext(config?: string): Context;

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
