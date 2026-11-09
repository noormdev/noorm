import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { resolve } from 'node:path';

import { attempt, attemptSync } from '@logosdx/utils';

import type { Config } from '../../core/config/types.js';
import { attachPolicyContext, getPolicyContext } from '../../core/policy/index.js';
import type { Identity } from '../../core/identity/types.js';
import type { PipelineDryRunResult, PipelineRunResult } from '../../core/pipeline/types.js';
import type { NoormPipelineRun } from '../../core/shared/tables.js';
import type { StateManager } from '../../core/state/manager.js';
import type { ConnectionState } from './useConnection.js';
import type { RetainedConnection } from '../providers/ConnectionProvider.js';
import { getLifecycleManager } from '../../core/lifecycle/manager.js';
import { buildPipelineContext } from '../../core/pipeline/context.js';
import { runPipeline } from '../../core/pipeline/executor.js';
import { getPipelineRun, listPipelineHistory, type PipelineHistoryRecord } from '../../core/pipeline/history.js';
import { DEFAULT_PIPELINES_PATH } from '../../core/settings/defaults.js';
import { getPackageVersion } from '../../core/state/version.js';
import { ensureSchemaVersion } from '../../core/version/index.js';
import { useAppContext } from '../app-context.js';
import { useConnectionContext } from '../providers/ConnectionProvider.js';
import { resolveScreenIdentity } from '../utils/identity.js';
import { useConnection } from './useConnection.js';

const targetBrand: unique symbol = Symbol('pipeline target');

/** An in-memory confirmation identity, not a serializable connection token. */
export interface PipelineOperationTarget {
    readonly [targetBrand]: true;
}

export interface PipelineOperationOptions {
    input?: unknown;
    dryRun: boolean;
    yes: true;
    target: PipelineOperationTarget;
}

export interface PipelineOperations {
    connection: ConnectionState;
    pipelinesPath: string;
    running: boolean;
    cleanupFailed: boolean;
    target: PipelineOperationTarget | null;
    run: (slug: string, options: PipelineOperationOptions) => Promise<PipelineDryRunResult | PipelineRunResult>;
    history: (slug: string, limit?: number) => Promise<NoormPipelineRun[]>;
    getRun: (runId: number) => Promise<PipelineHistoryRecord | null>;
    stop: () => void;
}

interface TargetSnapshot {
    target: PipelineOperationTarget;
    sourceConfig: Config;
    config: Config;
    stateManager: StateManager;
    identity: Identity;
    projectRoot: string;
    pipelinesPath: string;
}

interface ActiveOperation {
    target: PipelineOperationTarget;
    controller: AbortController;
    promise: Promise<PipelineDryRunResult | PipelineRunResult>;
}

let nextOperationId = 0;

/** Owns operation lifetime independently of the screen displaying its result. */
export function usePipelineOperations(): PipelineOperations {

    const { activeConfig, activeConfigName, settings, identity, stateManager, projectRoot } = useAppContext();
    const connection = useConnection();
    const { retainConnection } = useConnectionContext();
    const configuredPath = settings?.paths?.pipelines ?? DEFAULT_PIPELINES_PATH;
    const mountedRef = useRef(true);
    const operationRef = useRef<ActiveOperation | null>(null);
    const [running, setRunning] = useState(false);
    const [cleanupFailed, setCleanupFailed] = useState(false);

    const snapshot = useMemo<TargetSnapshot | null>(() => {

        if (!activeConfig || !activeConfigName || !stateManager || !connection.db || !connection.dialect
            || connection.loading || connection.error) return null;

        // structuredClone drops the non-enumerable policy context, which would deny every cell.
        const config = structuredClone(activeConfig);
        const policyContext = getPolicyContext(activeConfig.access);
        if (policyContext) attachPolicyContext(config.access, policyContext);

        return {
            target: Object.freeze({ [targetBrand]: true as const }),
            sourceConfig: activeConfig,
            config,
            stateManager,
            identity: resolveScreenIdentity(identity),
            projectRoot,
            pipelinesPath: configuredPath,
        };

    }, [activeConfig, activeConfigName, settings, identity, stateManager, projectRoot,
        configuredPath, connection.db, connection.dialect, connection.loading, connection.error]);
    const latestRef = useRef(snapshot);
    latestRef.current = snapshot;
    const connectionRef = useRef(connection);
    connectionRef.current = connection;

    const stop = useCallback(() => {

        operationRef.current?.controller.abort();

    }, []);

    useEffect(() => {

        mountedRef.current = true;

        return () => {

            mountedRef.current = false;
            stop();

        };

    }, [stop]);

    useEffect(() => {

        if (operationRef.current && operationRef.current.target !== snapshot?.target) stop();

    }, [snapshot, stop]);

    const capture = useCallback((target: PipelineOperationTarget | undefined): { snapshot: TargetSnapshot; lease: RetainedConnection } => {

        const current = latestRef.current;
        const db = connectionRef.current.db;
        if (!mountedRef.current || !current || !db || current.target !== target) {

            throw new Error('The database target changed. Review the pipeline again.');

        }
        const lifecycle = getLifecycleManager(current.projectRoot);
        if (lifecycle.isShuttingDown || lifecycle.state === 'stopped' || lifecycle.state === 'failed') {

            throw new Error('The application is shutting down.');

        }

        return { snapshot: current, lease: retainConnection(db, current.sourceConfig) };

    }, [retainConnection]);

    const run = useCallback((slug: string, options: PipelineOperationOptions): Promise<PipelineDryRunResult | PipelineRunResult> => {

        if (operationRef.current) return Promise.reject(new Error('A pipeline operation is already running.'));
        const [captured, captureError] = attemptSync(() => capture(options.target));
        if (captureError) return Promise.reject(captureError);
        const { snapshot: current, lease } = captured;
        const controller = new AbortController();
        const lifecycle = getLifecycleManager(current.projectRoot);
        const name = `tui-pipeline:${++nextOperationId}`;
        const dryRun = options.dryRun;
        const input = options.input;
        const operation: ActiveOperation = {
            target: current.target, controller,
            promise: Promise.resolve().then(async () => {

                try {

                    controller.signal.throwIfAborted();
                    const context = await buildPipelineContext({
                        db: lease.db, dialect: lease.dialect, config: current.config, configName: lease.configName,
                        identity: current.identity, projectRoot: current.projectRoot, stateManager: current.stateManager,
                        pipelinesPath: current.pipelinesPath, channel: 'user', yes: true,
                        signal: controller.signal, disposeMemoryConnection: lease.invalidate,
                    });
                    controller.signal.throwIfAborted();

                    return await runPipeline(context, slug, { input, dryRun, signal: controller.signal });

                }
                finally {

                    const [, releaseError] = await attempt(() => lease.release());

                    if (releaseError) {

                        if (lifecycle.exitCode === 0) lifecycle.setExitCode(1);
                        if (mountedRef.current) setCleanupFailed(true);

                    }
                    lifecycle.unregisterResource(`${name}:stop`);
                    lifecycle.unregisterResource(`${name}:complete`);
                    operationRef.current = null;
                    if (mountedRef.current) setRunning(false);

                }

            }),
        };
        operationRef.current = operation;
        lifecycle.registerResource({
            name: `${name}:stop`, phase: 'stopping', cleanup: async () => controller.abort(),
        });
        lifecycle.registerResource({
            name: `${name}:complete`, phase: 'completing',
            cleanup: () => operation.promise.then(() => undefined, () => undefined),
        });
        setCleanupFailed(false);
        setRunning(true);

        return operation.promise;

    }, [capture]);

    const read = useCallback(<T,>(query: (lease: RetainedConnection, current: TargetSnapshot) => Promise<T>): Promise<T> => {

        const [captured, captureError] = attemptSync(() => capture(latestRef.current?.target));
        if (captureError) return Promise.reject(captureError);
        const { snapshot: current, lease } = captured;
        const lifecycle = getLifecycleManager(current.projectRoot);
        const name = `tui-pipeline-read:${++nextOperationId}`;
        const promise = Promise.resolve().then(async () => {

            let result: T;
            try {

                await ensureSchemaVersion(lease.db, lease.dialect);
                result = await query(lease, current);

            }
            finally {

                const [, releaseError] = await attempt(() => lease.release());

                if (releaseError) {

                    if (lifecycle.exitCode === 0) lifecycle.setExitCode(1);
                    if (mountedRef.current) setCleanupFailed(true);

                }
                lifecycle.unregisterResource(name);

            }
            if (!mountedRef.current || latestRef.current !== current) {

                throw new Error('The database target changed. Reload pipeline history.');

            }

            return result;

        });
        lifecycle.registerResource({
            name, phase: 'completing', cleanup: () => promise.then(() => undefined, () => undefined),
        });

        return promise;

    }, [capture]);

    const history = useCallback((slug: string, limit?: number) => read((lease, current) => listPipelineHistory({
        db: lease.db, dialect: lease.dialect, configName: lease.configName,
        executedBy: current.identity.name, cliVersion: getPackageVersion(),
    }, slug, { limit })), [read]);

    const getRun = useCallback((runId: number) => read((lease, current) => getPipelineRun({
        db: lease.db, dialect: lease.dialect, configName: lease.configName,
        executedBy: current.identity.name, cliVersion: getPackageVersion(),
    }, runId)), [read]);

    return {
        connection, pipelinesPath: resolve(projectRoot, configuredPath), running, cleanupFailed,
        target: snapshot?.target ?? null, run, history, getRun, stop,
    };

}
