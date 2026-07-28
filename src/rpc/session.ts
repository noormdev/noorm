import { attempt } from '@logosdx/utils';

import { createContext, type Context } from '../sdk/index.js';
import { configNotFoundMessage } from '../core/config/resolver.js';
import { isVisibleToChannel, type Channel, type Role } from '../core/policy/index.js';
import { RpcError, type RpcSession } from './types.js';

/**
 * Session connection info returned after connecting.
 */
export interface SessionInfo {
    name: string;
    dialect: string;
    database: string;
    role: Role;
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
     * The channel this session was opened on. Drives policy checks
     * (`checkConfigPolicy`) and mcp-channel invisibility in `connect`/
     * `getContext`. Defaults to `'user'` so pre-existing `new SessionManager()`
     * call sites keep working; `mcp serve` passes `'mcp'` explicitly.
     */
    readonly channel: Channel;

    constructor(channel: Channel = 'user') {

        this.channel = channel;

    }

    /**
     * Connect to a database configuration.
     *
     * Creates a Context, connects, and stores it.
     * If config is omitted, resolves the active config from state.
     *
     * On the `mcp` channel, a config with `access.mcp === false` (or no
     * `access` at all — fail closed per docs/spec/config-access-roles.md)
     * is invisible: this throws the byte-identical error an unknown config
     * name produces, rather than surfacing that the config exists but is
     * off-limits.
     */
    async connect(config?: string): Promise<SessionInfo> {

        const [ctx, ctxErr] = await attempt(() => createContext({ config }));

        if (ctxErr) {

            throw new RpcError('Failed to create context', ctxErr.message);

        }

        const resolvedName = ctx.noorm.config.name;
        const rawAccess = ctx.noorm.config.access;

        if (!isVisibleToChannel(rawAccess, this.channel)) {

            throw new RpcError('Failed to create context', configNotFoundMessage(resolvedName));

        }

        const [, connectErr] = await attempt(() => ctx.connect());

        if (connectErr) {

            throw new RpcError('Failed to connect', connectErr.message);

        }

        this.#contexts.set(resolvedName, ctx);

        return {
            name: resolvedName,
            dialect: ctx.dialect,
            database: ctx.noorm.config.connection.database,
            // access.mcp === false is unreachable here — the invisibility
            // guard above already denies before a context is ever stored.
            role: this.channel === 'mcp' ? (rawAccess.mcp === false ? 'viewer' : rawAccess.mcp) : rawAccess.user,
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
     * Throws if not connected. Does not re-check `access` — `connect()` is
     * the sole writer into `#contexts` and already gates on it, and a config
     * edit lands in a separate CLI process; it can't mutate this process's
     * already-held `Context.config`, so it only takes effect on the next
     * `connect()`. Re-checking a snapshot on every call would add cost
     * without closing any real gap.
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
