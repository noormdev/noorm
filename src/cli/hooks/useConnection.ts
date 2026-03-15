/**
 * Shared connection hook for screen-level database access.
 *
 * Provides a lazy, shared database connection for the active config.
 * Connection is created on first use, reused across screens, and
 * destroyed on config change or unmount.
 *
 * For screens that need schema version tables (vault, lock), use
 * `ensureSchema: true`. For screens that need post-connect setup,
 * use the `onReady` callback.
 *
 * @example
 * ```typescript
 * // Simple read-only screen
 * const { db, dialect, loading, error } = useConnection();
 *
 * // Vault/lock screen needing schema
 * const { db, loading, error } = useConnection({ ensureSchema: true });
 *
 * // Screen needing post-connect setup
 * const { db, loading, error } = useConnection({
 *     onReady: async (db, isCancelled) => {
 *         const data = await loadData(db);
 *         if (!isCancelled()) setData(data);
 *     },
 * });
 * ```
 */
import { useEffect, useState, useRef } from 'react';
import { attempt } from '@logosdx/utils';

import type { Kysely } from 'kysely';
import type { Dialect } from '../../core/connection/types.js';
import type { NoormDatabase } from '../../core/shared/index.js';

import { useConnectionContext } from '../providers/ConnectionProvider.js';
import { ensureSchemaVersion } from '../../core/version/index.js';


/**
 * Connection state exposed to consumers.
 */
export interface ConnectionState {

    /** The Kysely database instance (null until connected). */
    db: Kysely<NoormDatabase> | null;

    /** The dialect of the connected database. */
    dialect: Dialect | null;

    /** Whether the connection is being established or onReady is running. */
    loading: boolean;

    /** Error message if connection or onReady failed. */
    error: string | null;

}

/**
 * Options for the useConnection hook.
 */
export interface UseConnectionOptions {

    /**
     * Run ensureSchemaVersion after connecting.
     * Required for screens that access vault/lock tables.
     */
    ensureSchema?: boolean;

    /**
     * Callback after connection is ready (and schema ensured if requested).
     * Runs once per connection. Receives the database instance, dialect,
     * and a cancellation check function.
     */
    onReady?: (db: Kysely<NoormDatabase>, isCancelled: () => boolean, dialect: Dialect) => Promise<void>;

}

/**
 * Provides a shared database connection for the active config.
 *
 * Requests the connection lazily on mount. Returns the current
 * connection state. Multiple screens calling this hook share
 * the same underlying connection.
 */
export function useConnection(options?: UseConnectionOptions): ConnectionState {

    const { requestConnection, state: providerState } = useConnectionContext();

    const [localState, setLocalState] = useState<{
        schemaEnsured: boolean;
        readyDone: boolean;
        readyLoading: boolean;
        readyError: string | null;
    }>({
        schemaEnsured: false,
        readyDone: false,
        readyLoading: false,
        readyError: null,
    });

    const cancelledRef = useRef(false);

    // Request connection on mount
    useEffect(() => {

        requestConnection();

    }, [requestConnection]);

    // Reset local state when provider connection changes (e.g., config switch)
    useEffect(() => {

        if (!providerState.db) {

            setLocalState({
                schemaEnsured: false,
                readyDone: false,
                readyLoading: false,
                readyError: null,
            });

        }

    }, [providerState.db]);

    // Run ensureSchema + onReady when connection becomes available
    useEffect(() => {

        if (!providerState.db || !providerState.dialect) return;
        if (localState.readyDone || localState.readyLoading) return;

        const needsSchema = options?.ensureSchema && !localState.schemaEnsured;
        const needsReady = options?.onReady && !localState.readyDone;

        if (!needsSchema && !needsReady) return;

        cancelledRef.current = false;

        setLocalState((prev) => ({ ...prev, readyLoading: true }));

        const run = async () => {

            const db = providerState.db!;
            const dialect = providerState.dialect!;

            // Ensure schema if requested
            if (options?.ensureSchema && !localState.schemaEnsured) {

                const [, schemaErr] = await attempt(() =>
                    ensureSchemaVersion(db, dialect),
                );

                if (cancelledRef.current) return;

                if (schemaErr) {

                    setLocalState((prev) => ({
                        ...prev,
                        readyLoading: false,
                        readyError: schemaErr.message,
                    }));

                    return;

                }

            }

            // Run onReady callback if provided
            if (options?.onReady) {

                const [, readyErr] = await attempt(() =>
                    options.onReady!(db, () => cancelledRef.current, dialect),
                );

                if (cancelledRef.current) return;

                if (readyErr) {

                    setLocalState((prev) => ({
                        ...prev,
                        readyLoading: false,
                        readyError: readyErr.message,
                    }));

                    return;

                }

            }

            if (!cancelledRef.current) {

                setLocalState({
                    schemaEnsured: true,
                    readyDone: true,
                    readyLoading: false,
                    readyError: null,
                });

            }

        };

        run();

        return () => {

            cancelledRef.current = true;

        };

    }, [providerState.db, providerState.dialect, localState.schemaEnsured, localState.readyDone, options?.ensureSchema]);

    // Compose final state
    const needsPostConnect = options?.ensureSchema || options?.onReady;
    const isLoading = providerState.loading || (needsPostConnect ? localState.readyLoading : false);
    const waitingForPostConnect = needsPostConnect && providerState.db && !localState.readyDone && !localState.readyError;
    const error = providerState.error ?? localState.readyError;

    return {
        db: error ? null : (waitingForPostConnect ? null : providerState.db),
        dialect: providerState.dialect,
        loading: isLoading || (waitingForPostConnect ? true : false),
        error,
    };

}
