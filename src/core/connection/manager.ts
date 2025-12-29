/**
 * Connection manager with tracking and auto-cleanup.
 *
 * Tracks ALL active database connections and ensures they're closed on shutdown.
 * Connections can be cached by config name for reuse, or tracked ephemerally.
 */
import { attempt } from '@logosdx/utils';
import type { Config } from '../config/types.js';
import type { ConnectionResult } from './types.js';
import { observer } from '../observer.js';

/**
 * Internal connection entry with metadata.
 */
interface TrackedConnection {
    conn: ConnectionResult;
    configName: string;
    createdAt: Date;
}

/**
 * Manages all database connections.
 *
 * Two modes of operation:
 * 1. Cached: `getConnection(config)` - reuses existing connection for a config
 * 2. Tracked: `track(conn, name)` - tracks ephemeral connections for cleanup
 *
 * All tracked connections are automatically closed on `app:shutdown` event.
 *
 * @example
 * ```typescript
 * const manager = getConnectionManager()
 *
 * // Cached connection (reused)
 * const conn = await manager.getConnection(config)
 *
 * // Or track an ephemeral connection
 * const conn = await createConnection(config.connection, 'temp')
 * manager.track(conn, 'temp')
 *
 * // All connections closed on app:shutdown
 * ```
 */
class ConnectionManager {

    #cached = new Map<string, ConnectionResult>();
    #tracked = new Map<number, TrackedConnection>();
    #nextId = 1;
    #shuttingDown = false;
    #unsubscribe: (() => void) | null = null;

    constructor() {

        // Listen for shutdown event
        this.#unsubscribe = observer.on('app:shutdown', async () => {

            if (process.env['NOORM_DEBUG']) {

                console.error(
                    `[ConnectionManager] app:shutdown received, closing ${this.size} connections`,
                );

            }

            this.#shuttingDown = true;
            await this.closeAll();

            if (process.env['NOORM_DEBUG']) {

                console.error('[ConnectionManager] all connections closed');

            }

        });

    }

    /**
     * Track a connection for cleanup on shutdown.
     *
     * Returns an ID that can be used to untrack the connection.
     */
    track(conn: ConnectionResult, configName: string): number {

        const id = this.#nextId++;
        this.#tracked.set(id, {
            conn,
            configName,
            createdAt: new Date(),
        });

        return id;

    }

    /**
     * Stop tracking a connection (call after manual destroy).
     */
    untrack(id: number): void {

        this.#tracked.delete(id);

    }

    /**
     * Get or create a cached connection for a config.
     *
     * If a connection already exists for this config name, returns it.
     * Otherwise creates a new connection and caches it.
     */
    async getConnection(
        config: Config,
        createFn: (config: Config) => Promise<ConnectionResult>,
    ): Promise<ConnectionResult> {

        const key = config.name;

        if (this.#cached.has(key)) {

            return this.#cached.get(key)!;

        }

        const conn = await createFn(config);
        this.#cached.set(key, conn);

        return conn;

    }

    /**
     * Close a specific cached connection by config name.
     */
    async closeCached(configName: string): Promise<void> {

        const conn = this.#cached.get(configName);
        if (conn) {

            const [, err] = await attempt(() => conn.destroy());
            this.#cached.delete(configName);

            if (err) {

                observer.emit('error', { source: 'connection', error: err });

            }
            else {

                observer.emit('connection:close', { configName });

            }

        }

    }

    /**
     * Close all connections (cached and tracked).
     *
     * Called automatically on app:shutdown event.
     * Uses a timeout to prevent hanging on stubborn connections.
     */
    async closeAll(): Promise<void> {

        const CLOSE_TIMEOUT = 5000; // 5 seconds per connection

        // Close all cached connections
        const cachedNames = Array.from(this.#cached.keys());
        for (const name of cachedNames) {

            await this.closeCached(name);

        }

        // Close all tracked connections with timeout
        const trackedEntries = Array.from(this.#tracked.entries());
        for (const [id, entry] of trackedEntries) {

            const destroyWithTimeout = Promise.race([
                entry.conn.destroy(),
                new Promise<void>((resolve) => setTimeout(resolve, CLOSE_TIMEOUT)),
            ]);

            const [, err] = await attempt(() => destroyWithTimeout);
            this.#tracked.delete(id);

            if (err) {

                observer.emit('error', { source: 'connection', error: err });

            }
            else {

                observer.emit('connection:close', { configName: entry.configName });

            }

        }

    }

    /**
     * Check if a cached connection exists for a config name.
     */
    hasCached(configName: string): boolean {

        return this.#cached.has(configName);

    }

    /**
     * Get total number of active connections.
     */
    get size(): number {

        return this.#cached.size + this.#tracked.size;

    }

    /**
     * Check if shutdown is in progress.
     */
    get isShuttingDown(): boolean {

        return this.#shuttingDown;

    }

    /**
     * Cleanup (for testing).
     */
    dispose(): void {

        if (this.#unsubscribe) {

            this.#unsubscribe();
            this.#unsubscribe = null;

        }

    }

}

// Singleton instance
let instance: ConnectionManager | null = null;

/**
 * Get the global ConnectionManager instance.
 *
 * The manager automatically listens for app:shutdown and closes all connections.
 */
export function getConnectionManager(): ConnectionManager {

    if (!instance) {

        instance = new ConnectionManager();

    }

    return instance;

}

/**
 * Reset the global ConnectionManager (closes all connections).
 *
 * Primarily for testing.
 */
export async function resetConnectionManager(): Promise<void> {

    if (instance) {

        await instance.closeAll();
        instance.dispose();
        instance = null;

    }

}
