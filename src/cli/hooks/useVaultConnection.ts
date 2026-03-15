/**
 * Vault connection lifecycle hook.
 *
 * Encapsulates the connect → ensureSchemaVersion → ready pattern
 * shared by all vault screens. Delegates to the shared useConnection
 * hook for connection management.
 *
 * @example
 * ```typescript
 * const { phase, error, connRef } = useVaultConnection();
 * ```
 */
import { useState, useRef, useEffect } from 'react';

import type { Kysely } from 'kysely';
import type { MutableRefObject } from 'react';
import type { ConnectionResult, Dialect } from '../../core/connection/types.js';
import type { NoormDatabase } from '../../core/shared/index.js';

import { useAppContext } from '../app-context.js';
import { useConnection } from './useConnection.js';


/**
 * Connection phase — screens extend with their own action phases.
 */
type ConnectionPhase = 'connecting' | 'ready' | 'error';

/**
 * Hook return value.
 */
export interface VaultConnectionResult {

    /** Current connection phase. */
    phase: ConnectionPhase;

    /** Error message if phase is 'error'. */
    error: string | null;

    /** Mutable ref to the active connection (null until ready). */
    connRef: MutableRefObject<ConnectionResult | null>;

    /** Set phase manually (for screens that need custom phases). */
    setPhase: (phase: ConnectionPhase) => void;

    /** Set error manually. */
    setError: (error: string | null) => void;

}

/**
 * Options for the vault connection hook.
 */
export interface UseVaultConnectionOptions {

    /**
     * Optional callback after connection is established and schema is ensured.
     * Runs before phase transitions to 'ready'. If the callback throws,
     * phase transitions to 'error' instead.
     *
     * Receives the database instance and a cancellation check function.
     */
    onReady?: (db: Kysely<NoormDatabase>, isCancelled: () => boolean, dialect: Dialect) => Promise<void>;

    /** Extra dependencies for the useEffect (beyond activeConfig/activeConfigName/identity). */
    extraDeps?: unknown[];

}

/**
 * Manages vault screen connection lifecycle.
 *
 * Delegates to useConnection({ ensureSchema: true }) for shared
 * connection management. The onReady callback runs after the
 * connection and schema are ready.
 */
export function useVaultConnection(options?: UseVaultConnectionOptions): VaultConnectionResult {

    const { identity } = useAppContext();

    const [phase, setPhase] = useState<ConnectionPhase>('connecting');
    const [error, setError] = useState<string | null>(null);

    // Compatibility ref — wraps the shared connection's db in a ConnectionResult-like shape
    const connRef = useRef<ConnectionResult | null>(null);

    const { db, dialect, loading, error: connError } = useConnection({
        ensureSchema: true,
        onReady: options?.onReady,
    });

    // Sync phase with connection state
    useEffect(() => {

        if (!identity) {

            setError('Identity not set up');
            setPhase('error');

            return;

        }

        if (connError) {

            setError(connError);
            setPhase('error');
            connRef.current = null;

            return;

        }

        if (loading) {

            setPhase('connecting');

            return;

        }

        if (db && dialect) {

            // Build a compatibility connRef for screens that use it
            connRef.current = {
                db: db as Kysely<unknown>,
                dialect,
                destroy: async () => {
                    // No-op — shared connection is managed by the provider
                },
            };
            setPhase('ready');
            setError(null);

        }

    }, [db, dialect, loading, connError, identity]);

    return { phase, error, connRef, setPhase, setError };

}
