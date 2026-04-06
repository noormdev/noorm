import { attempt } from '@logosdx/utils';

import { createContext, type Context } from '../sdk/index.js';
import { RpcError, type RpcSession } from './types.js';

/**
 * Session connection info returned after connecting.
 */
export interface SessionInfo {
    name: string;
    dialect: string;
    database: string;
    protected: boolean;
}

/**
 * Manages active database connections.
 *
 * Holds Context instances keyed by config name.
 * Kysely + tarn handle connection pooling internally.
 * Implements RpcSession for use by RPC command handlers.
 */
export class SessionManager implements RpcSession {

    #contexts = new Map<string, Context>();

    /**
     * Connect to a database configuration.
     *
     * Creates a Context, connects, and stores it.
     * If config is omitted, resolves the active config from state.
     */
    async connect(config?: string): Promise<SessionInfo> {

        const [ctx, ctxErr] = await attempt(() => createContext({ config }));

        if (ctxErr) {

            throw new RpcError('Failed to create context', ctxErr.message);

        }

        const [, connectErr] = await attempt(() => ctx.connect());

        if (connectErr) {

            throw new RpcError('Failed to connect', connectErr.message);

        }

        const resolvedName = ctx.noorm.config.name;

        this.#contexts.set(resolvedName, ctx);

        return {
            name: resolvedName,
            dialect: ctx.dialect,
            database: ctx.noorm.config.connection.database,
            protected: ctx.noorm.config.protected,
        };

    }

    /**
     * Disconnect from a configuration.
     *
     * If config is omitted, disconnects all active sessions.
     */
    async disconnect(config?: string): Promise<void> {

        if (!config) {

            await this.disconnectAll();

            return;

        }

        const ctx = this.#contexts.get(config);

        if (!ctx) return;

        await attempt(() => ctx.disconnect());
        this.#contexts.delete(config);

    }

    /**
     * Get the active context for a config.
     *
     * Throws if not connected.
     */
    getContext(config?: string): Context {

        if (config) {

            const ctx = this.#contexts.get(config);

            if (!ctx) {

                throw new RpcError(`Not connected to "${config}" — call connect first`);

            }

            return ctx;

        }

        // No config specified — return the only connection or error
        if (this.#contexts.size === 0) {

            throw new RpcError('Not connected — call connect first');

        }

        if (this.#contexts.size === 1) {

            return this.#contexts.values().next().value!;

        }

        const names = [...this.#contexts.keys()].join(', ');
        throw new RpcError(`Multiple connections active (${names}) — specify config`);

    }

    /**
     * Check if a connection exists for a config.
     */
    hasConnection(config: string): boolean {

        return this.#contexts.has(config);

    }

    /**
     * List active connection names.
     */
    listConnections(): string[] {

        return [...this.#contexts.keys()];

    }

    /**
     * Disconnect all active sessions.
     */
    async disconnectAll(): Promise<void> {

        for (const [, ctx] of this.#contexts) {

            await attempt(() => ctx.disconnect());

        }

        this.#contexts.clear();

    }

}
