import type { z } from 'zod';
import type { Context } from '../sdk/context.js';

/**
 * A registered RPC command.
 *
 * Commands are transport-agnostic — they define what operations are available,
 * validate input via Zod, and execute against SDK/core functions.
 */
export interface RpcCommand<TInput = unknown, TOutput = unknown> {

    name: string;
    description: string;
    examples: RpcExample[];
    inputSchema: z.ZodType<TInput>;
    handler: (input: TInput, session: RpcSession) => Promise<TOutput>;

}

/**
 * Session interface for RPC command handlers.
 *
 * Provides access to database connections.
 * Implemented by SessionManager in session.ts.
 */
export interface RpcSession {

    getContext(config?: string): Context;
    connect(config?: string): Promise<{ name: string; dialect: string; database: string; protected: boolean }>;
    disconnect(config?: string): Promise<void>;
    disconnectAll(): Promise<void>;
    hasConnection(config: string): boolean;
    listConnections(): string[];

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
