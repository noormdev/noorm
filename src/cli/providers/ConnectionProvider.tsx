/**
 * Shared connection provider for the TUI.
 *
 * Holds a single database connection keyed by activeConfigName. First
 * useConnection() call triggers lazy creation; subsequent calls return
 * the existing connection. Config change destroys old and creates new
 * lazily. Provider unmount destroys the connection.
 *
 * @example
 * ```tsx
 * <ConnectionProvider>
 *     <App />
 * </ConnectionProvider>
 * ```
 */
import { createContext, useContext, useRef, useCallback, useEffect, useState } from 'react';

import type { ReactElement, ReactNode } from 'react';
import type { Kysely } from 'kysely';
import type { ConnectionResult } from '../../core/connection/types.js';
import type { Dialect } from '../../core/connection/types.js';
import type { NoormDatabase } from '../../core/shared/index.js';

import { attempt } from '@logosdx/utils';
import { createConnection } from '../../core/connection/index.js';
import { useAppContext } from '../app-context.js';


/**
 * Connection state exposed to consumers.
 */
export interface ConnectionState {

    /** The Kysely database instance (null until connected). */
    db: Kysely<NoormDatabase> | null;

    /** The dialect of the connected database. */
    dialect: Dialect | null;

    /** Whether the connection is being established. */
    loading: boolean;

    /** Error message if connection failed. */
    error: string | null;

}

/**
 * Internal context value.
 */
interface ConnectionContextValue {

    /** Request the shared connection. Triggers lazy creation if needed. */
    requestConnection: () => void;

    /** Current connection state. */
    state: ConnectionState;

}

const ConnectionContext = createContext<ConnectionContextValue | null>(null);

/**
 * Props for the ConnectionProvider.
 */
interface ConnectionProviderProps {
    children: ReactNode;
}

/**
 * Provides a shared database connection scoped to the active config.
 *
 * Wraps the app to enable connection reuse across screens. Connection
 * is created lazily on first request and destroyed on config change
 * or unmount.
 */
export function ConnectionProvider({ children }: ConnectionProviderProps): ReactElement {

    const { activeConfig, activeConfigName } = useAppContext();

    const connRef = useRef<ConnectionResult | null>(null);
    const configKeyRef = useRef<string | null>(null);
    const connectingRef = useRef(false);

    const [state, setState] = useState<ConnectionState>({
        db: null,
        dialect: null,
        loading: false,
        error: null,
    });

    // Destroy current connection
    const destroyConnection = useCallback(async () => {

        if (connRef.current) {

            const conn = connRef.current;
            connRef.current = null;
            configKeyRef.current = null;
            connectingRef.current = false;

            setState({ db: null, dialect: null, loading: false, error: null });

            await conn.destroy();

        }

    }, []);

    // When active config changes, destroy old connection
    useEffect(() => {

        const currentKey = activeConfigName ?? null;

        if (configKeyRef.current && configKeyRef.current !== currentKey) {

            destroyConnection();

        }

    }, [activeConfigName, destroyConnection]);

    // Cleanup on unmount
    useEffect(() => {

        return () => {

            if (connRef.current) {

                connRef.current.destroy();
                connRef.current = null;

            }

        };

    }, []);

    // Request connection (lazy creation)
    const requestConnection = useCallback(() => {

        // Already connected to this config
        if (connRef.current && configKeyRef.current === activeConfigName) return;

        // Already connecting
        if (connectingRef.current) return;

        // No config to connect to
        if (!activeConfig || !activeConfigName) return;

        connectingRef.current = true;
        configKeyRef.current = activeConfigName;

        setState((prev) => ({ ...prev, loading: true, error: null }));

        const connect = async () => {

            const [conn, connErr] = await attempt(() =>
                createConnection(activeConfig.connection, activeConfigName),
            );

            connectingRef.current = false;

            // Config changed while connecting — discard
            if (configKeyRef.current !== activeConfigName) {

                if (conn) await conn.destroy();

                return;

            }

            if (connErr || !conn) {

                setState({
                    db: null,
                    dialect: null,
                    loading: false,
                    error: `Connection failed: ${connErr?.message ?? 'Unknown error'}`,
                });

                return;

            }

            connRef.current = conn;

            setState({
                db: conn.db as Kysely<NoormDatabase>,
                dialect: conn.dialect,
                loading: false,
                error: null,
            });

        };

        connect();

    }, [activeConfig, activeConfigName]);

    const value: ConnectionContextValue = { requestConnection, state };

    return (
        <ConnectionContext.Provider value={value}>
            {children}
        </ConnectionContext.Provider>
    );

}

/**
 * Access the shared connection context.
 *
 * Internal — use useConnection() instead.
 */
export function useConnectionContext(): ConnectionContextValue {

    const ctx = useContext(ConnectionContext);

    if (!ctx) {

        throw new Error('useConnectionContext must be used within a ConnectionProvider');

    }

    return ctx;

}
