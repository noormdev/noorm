/**
 * Shared connection provider for the TUI.
 *
 * Holds a single database connection keyed by the active config. The first
 * useConnection() call creates it lazily; later calls return the same one.
 * A config change retires the old connection, which stays alive until
 * retained operations settle (fatal invalidation closes it at once).
 * Provider unmount destroys it.
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
import type { Config } from '../../core/config/types.js';

import { attempt } from '@logosdx/utils';
import { createConnection } from '../../core/connection/index.js';
import { observer } from '../../core/observer.js';
import { getLifecycleManager } from '../../core/lifecycle/manager.js';
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

export interface RetainedConnection {
    db: Kysely<NoormDatabase>;
    dialect: Dialect;
    configName: string;
    release: () => Promise<void>;
    invalidate: () => Promise<void>;
}

interface ConnectionRetirement {
    promise: Promise<void>;
    resolve: () => void;
    reject: (reason: unknown) => void;
}

interface ConnectionRecord {
    connection: ConnectionResult;
    config: Config;
    configName: string;
    retains: number;
    retired: boolean;
    destroying: Promise<void> | null;
    retirement: ConnectionRetirement | null;
}

export interface ConnectionContextValue {

    /** Request the shared connection. Triggers lazy creation if needed. */
    requestConnection: () => void;

    /** Destroy the current connection. Used before DROP DATABASE etc. */
    destroyConnection: () => Promise<void>;

    /** Current connection state. */
    state: ConnectionState;

    /** Retain the exact published config/DB pair, rejecting stale callers. */
    retainConnection: (db: Kysely<NoormDatabase>, config: Config) => RetainedConnection;

}

const ConnectionContext = createContext<ConnectionContextValue | null>(null);
let nextConnectionCloseId = 0;

/**
 * Props for the ConnectionProvider.
 */
interface ConnectionProviderProps {
    children: ReactNode;
}

/**
 * Provides a shared database connection scoped to the active config.
 */
export function ConnectionProvider({ children }: ConnectionProviderProps): ReactElement {

    const { activeConfig, activeConfigName, projectRoot } = useAppContext();
    const currentConfigRef = useRef({ config: activeConfig, name: activeConfigName });
    currentConfigRef.current = { config: activeConfig, name: activeConfigName };
    const connRef = useRef<ConnectionRecord | null>(null);
    const pendingRef = useRef<{ config: Config; name: string } | null>(null);
    const mountedRef = useRef(true);
    const shuttingDownRef = useRef(false);

    const empty: ConnectionState = { db: null, dialect: null, loading: false, error: null };
    const [state, setState] = useState<ConnectionState>(empty);

    const closeConnection = useCallback((connection: ConnectionResult): Promise<void> => {

        const lifecycle = getLifecycleManager(projectRoot);
        const name = `tui-connection-close:${++nextConnectionCloseId}`;
        const pending = Promise.resolve().then(() => connection.destroy()).catch((error: unknown) => {

            if (lifecycle.exitCode === 0) lifecycle.setExitCode(1);
            throw error;

        }).finally(() => lifecycle.unregisterResource(name));
        lifecycle.registerResource({
            name, phase: 'releasing',
            cleanup: async () => {

                await attempt(() => pending);

            },
        });

        return pending;

    }, [projectRoot]);

    const closeRecord = useCallback((record: ConnectionRecord): Promise<void> => {

        if (!record.destroying) {

            record.destroying = closeConnection(record.connection);
            if (record.retirement) {

                record.destroying.then(record.retirement.resolve, record.retirement.reject);

            }

        }

        return record.destroying;

    }, [closeConnection]);

    const retire = useCallback((record: ConnectionRecord): Promise<void> => {

        record.retired = true;
        if (record.retains === 0 || record.destroying) return closeRecord(record);
        if (!record.retirement) {

            let resolve!: () => void;
            let reject!: (reason: unknown) => void;
            const promise = new Promise<void>((onResolve, onReject) => {

                resolve = onResolve;
                reject = onReject;

            });
            record.retirement = { promise, resolve, reject };

        }

        return record.retirement.promise;

    }, [closeRecord]);

    const destroyConnection = useCallback(async () => {

        const record = connRef.current;
        connRef.current = null;
        pendingRef.current = null;
        if (mountedRef.current) setState({ db: null, dialect: null, loading: false, error: null });
        if (record) await retire(record);

    }, [retire]);

    const retainConnection = useCallback((db: Kysely<NoormDatabase>, config: Config): RetainedConnection => {

        const record = connRef.current;
        const current = currentConfigRef.current;
        if (!mountedRef.current || shuttingDownRef.current || !record || record.retired || record.connection.db !== db
            || record.config !== config || current.config !== config || current.name !== record.configName) {

            throw new Error('The database target changed. Review the pipeline again.');

        }
        record.retains++;
        let released: Promise<void> | null = null;

        return {
            db,
            dialect: record.connection.dialect,
            configName: record.configName,
            release: () => {

                if (released) return released;
                record.retains--;
                released = record.retired && record.retains === 0 ? closeRecord(record) : Promise.resolve();

                return released;

            },
            invalidate: async () => {

                record.retired = true;
                if (connRef.current === record) {

                    connRef.current = null;
                    if (mountedRef.current) setState({ db: null, dialect: null, loading: false, error: null });

                }
                await closeRecord(record);

            },
        };

    }, [closeRecord]);

    useEffect(() => {

        const record = connRef.current;
        if (record && (record.config !== activeConfig || record.configName !== activeConfigName)) {

            void attempt(destroyConnection);

        }

    }, [activeConfig, activeConfigName, destroyConnection]);

    useEffect(() => {

        mountedRef.current = true;

        return () => {

            mountedRef.current = false;
            void attempt(destroyConnection);

        };

    }, [destroyConnection]);

    useEffect(() => observer.on('app:shutdown', () => {

        shuttingDownRef.current = true;
        void attempt(destroyConnection);

    }), [destroyConnection]);

    const requestConnection = useCallback(() => {

        if (!mountedRef.current || shuttingDownRef.current || !activeConfig || !activeConfigName) return;
        const current = currentConfigRef.current;
        if (current.config !== activeConfig || current.name !== activeConfigName) return;
        const record = connRef.current;
        if (record && !record.retired && record.config === activeConfig && record.configName === activeConfigName) return;
        if (pendingRef.current?.config === activeConfig && pendingRef.current.name === activeConfigName) return;

        if (record) {

            connRef.current = null;
            void attempt(() => retire(record));

        }
        const pending = { config: activeConfig, name: activeConfigName };
        pendingRef.current = pending;
        setState({ db: null, dialect: null, loading: true, error: null });

        const connect = async () => {

            const [conn, connErr] = await attempt(() => createConnection(activeConfig.connection, activeConfigName));
            const latest = currentConfigRef.current;
            if (!mountedRef.current || pendingRef.current !== pending
                || latest.config !== activeConfig || latest.name !== activeConfigName) {

                if (pendingRef.current === pending) pendingRef.current = null;
                if (conn) await attempt(() => closeConnection(conn));

                return;

            }
            pendingRef.current = null;
            if (connErr || !conn) {

                setState({
                    db: null, dialect: null, loading: false,
                    error: `Connection failed: ${connErr?.message ?? 'Unknown error'}`,
                });

                return;

            }
            connRef.current = {
                connection: conn, config: activeConfig, configName: activeConfigName,
                retains: 0, retired: false, destroying: null, retirement: null,
            };
            setState({ db: conn.db as Kysely<NoormDatabase>, dialect: conn.dialect, loading: false, error: null });

        };

        void connect();

    }, [activeConfig, activeConfigName, retire, closeConnection]);

    const record = connRef.current;
    const publishedState = record && (record.config !== activeConfig || record.configName !== activeConfigName)
        ? empty : state;
    const value: ConnectionContextValue = {
        requestConnection, destroyConnection, retainConnection, state: publishedState,
    };

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
