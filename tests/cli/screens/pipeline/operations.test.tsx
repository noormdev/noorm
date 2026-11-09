import React from 'react';
import { afterAll, afterEach, beforeEach, describe, expect, it, mock, spyOn } from 'bun:test';
import { render } from 'ink-testing-library';
import { Text } from 'ink';
import { sql, SqliteDriver, type KyselyPlugin } from 'kysely';
import { Database } from 'bun:sqlite';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as pause } from 'node:timers/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import type { Config } from '../../../../src/core/config/types.js';
import type { ConnectionResult } from '../../../../src/core/connection/types.js';
import { ensureSchemaVersion } from '../../../../src/core/version/index.js';
import type { PipelineContext } from '../../../../src/core/pipeline/types.js';
import * as appContext from '../../../../src/tui/app-context.js';
import * as connections from '../../../../src/core/connection/index.js';
import * as pipelineContext from '../../../../src/core/pipeline/context.js';
import { getLifecycleManager, resetLifecycleManager } from '../../../../src/core/lifecycle/manager.js';
import * as pipelineHistory from '../../../../src/core/pipeline/history.js';
import { observer } from '../../../../src/core/observer.js';
import { ConnectionProvider, useConnectionContext, type ConnectionContextValue } from '../../../../src/tui/providers/ConnectionProvider.js';
import { usePipelineOperations, type PipelineOperations } from '../../../../src/tui/hooks/usePipelineOperations.js';
import { ShutdownProvider, useShutdown, type ShutdownContextValue } from '../../../../src/tui/shutdown.js';
import { withPolicy } from '../../../utils/access.js';

const actualAppContext = { ...appContext };
const createConnection = connections.createConnection;
const listPipelineHistory = pipelineHistory.listPipelineHistory;
const finalizePipelineRun = pipelineHistory.finalizePipelineRun;
interface TestAppContext {
    projectRoot: string;
    activeConfig: Config;
    activeConfigName: string;
    settings: { paths: { pipelines: string } };
    identity: null;
    stateManager: object;
}

let app: TestAppContext;
mock.module('../../../../src/tui/app-context.js', () => ({
    ...actualAppContext,
    useAppContext: () => app,
}));

interface Deferred<T = void> {
    promise: Promise<T>;
    resolve: (value: T | PromiseLike<T>) => void;
}

function deferred<T = void>(): Deferred<T> {

    let resolve!: (value: T | PromiseLike<T>) => void;
    const promise = new Promise<T>((done) => {

        resolve = done;

    });

    return { promise, resolve };

}

async function until(predicate: () => boolean) {

    for (let index = 0; index < 100; index++) {

        if (predicate()) return;
        await pause(10);

    }
    throw new Error('Operation did not reach the expected boundary');

}

function config(name: string): Config {

    return {
        name, type: 'local', isTest: true, access: withPolicy({ user: 'admin', agent: 'admin' }),
        connection: { dialect: 'sqlite', database: ':memory:' },
    };

}

let operations: PipelineOperations;
let connection: ConnectionContextValue;
let shutdown: ShutdownContextValue;
let root: string;
let preparation: Deferred | null;
let preparationEntered: Deferred;
const mounts: (() => void)[] = [];
const gates: Deferred[] = [];

function Probe() {

    operations = usePipelineOperations();
    connection = useConnectionContext();

    return <Text>{operations.running ? 'busy' : 'idle'}{operations.cleanupFailed ? ' cleanup failed' : ''}</Text>;

}

function ShutdownProbe() {

    shutdown = useShutdown();

    return <Text>application</Text>;

}

async function mountOperations() {

    const view = render(<ConnectionProvider><Probe /></ConnectionProvider>);
    mounts.push(view.unmount);
    await until(() => operations.target !== null);

    return view;

}

async function mountShutdown() {

    await resetLifecycleManager();
    const lifecycle = getLifecycleManager(root, { registerSignalHandlers: false });
    const view = render(<ShutdownProvider projectRoot={root}><ShutdownProbe /></ShutdownProvider>);
    mounts.push(view.unmount);
    await until(() => lifecycle.isRunning);
    expect(lifecycle.exitCode).toBe(0);

    return lifecycle;

}

async function buildTestPipelineContext(input: pipelineContext.PipelineContextInput): Promise<PipelineContext> {

    await ensureSchemaVersion(input.db, input.dialect);
    const gate = preparation;
    preparationEntered.resolve();
    await gate?.promise;

    return {
        db: input.db, dialect: input.dialect, connectionConfig: input.config.connection,
        disposeMemoryConnection: input.disposeMemoryConnection, configName: input.configName,
        identity: input.identity, projectRoot: input.projectRoot, pipelinesPath: input.pipelinesPath,
        cliVersion: 'test', yes: input.yes, signal: input.signal, access: input.config.access,
        channel: input.channel, config: { ...input.config }, secrets: {}, globalSecrets: {},
    };

}

function delayWorkflowResult(fatalRollback = false, destroyFault = false) {

    const entered = deferred();
    const finish = deferred();
    gates.push(finish);
    const queries = new Set<unknown>();
    let workflowStarted = false;
    const destroyed: string[] = [];
    const plugin: KyselyPlugin = {
        transformQuery({ node, queryId }) {

            if (fatalRollback && workflowStarted && node.kind === 'RawNode'
                && node.sqlFragments.join('').trim().toLowerCase() === 'rollback') {

                throw new Error('Injected rollback failure before dispatch');

            }
            if (node.kind === 'RawNode' && node.sqlFragments.some((part) => part.includes('INSERT INTO markers'))) {

                queries.add(queryId);
                workflowStarted = true;

            }

            return node;

        },
        async transformResult({ result, queryId }) {

            if (queries.delete(queryId)) {

                entered.resolve();
                await finish.promise;

            }

            return result;

        },
    };
    spyOn(connections, 'createConnection').mockImplementation(async (...args) => {

        const result = await createConnection(...args);

        return {
            ...result,
            db: result.db.withPlugin(plugin),
            destroy: async () => {

                destroyed.push(args[1] ?? '');
                await result.destroy();
                if (destroyFault && args[1] === 'A') throw new Error('CLEANUP_PRIVATE_CANARY');

            },
        };

    });

    return { entered, finish, destroyed };

}

let previousActEnvironment: unknown;

beforeEach(async () => {

    // Updates here run outside act(), so act mode must be off.
    previousActEnvironment = Reflect.get(globalThis, 'IS_REACT_ACT_ENVIRONMENT');
    Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', false);
    root = await mkdtemp(join(tmpdir(), 'noorm-tui-lifetime-'));
    await mkdir(join(root, 'pipelines', 'example'), { recursive: true });
    await writeFile(join(root, 'pipelines', 'example', 'pipeline.yml'),
        'transaction: pipeline\nsteps:\n  - id: first\n    sql: first.sql\n  - id: second\n    sql: second.sql\n');
    await writeFile(join(root, 'pipelines', 'example', 'first.sql'), 'INSERT INTO markers VALUES (1);');
    await writeFile(join(root, 'pipelines', 'example', 'second.sql'), 'INSERT INTO markers VALUES (2);');
    preparation = null;
    preparationEntered = deferred();
    const selected = config('A');
    app = {
        projectRoot: root, activeConfig: selected, activeConfigName: selected.name,
        settings: { paths: { pipelines: 'pipelines' } }, identity: null,
        stateManager: {},
    };
    spyOn(pipelineContext, 'buildPipelineContext').mockImplementation(buildTestPipelineContext);
    await getLifecycleManager(root, { registerSignalHandlers: false }).start();

});

afterEach(async () => {

    const lifecycle = getLifecycleManager(root);
    for (const unmount of mounts.splice(0)) unmount();
    preparation?.resolve();
    for (const gate of gates.splice(0)) gate.resolve();
    await lifecycle.shutdown('programmatic');
    await resetLifecycleManager();
    mock.restore();
    await connections.resetConnectionManager();
    await rm(root, { recursive: true, force: true });
    Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', previousActEnvironment);

});

afterAll(() => {

    mock.module('../../../../src/tui/app-context.js', () => actualAppContext);

});

describe('pipeline operation ownership', () => {

    it('discards an old asynchronous connection without publishing it over a ready replacement', async () => {

        const acquired = deferred<ConnectionResult>();
        const finish = deferred();
        gates.push(finish);
        spyOn(connections, 'createConnection').mockImplementation(async (...args) => {

            const result = await createConnection(...args);
            if (args[1] === 'A') {

                acquired.resolve(result);
                await finish.promise;

            }

            return result;

        });
        const view = render(<ConnectionProvider><Probe /></ConnectionProvider>);
        mounts.push(view.unmount);
        const original = await acquired.promise;
        app = { ...app, activeConfig: config('B'), activeConfigName: 'B' };
        view.rerender(<ConnectionProvider><Probe /></ConnectionProvider>);
        await until(() => operations.target !== null);
        const replacement = operations.connection.db!;
        expect(replacement).not.toBe(original.db);
        finish.resolve();
        await until(() => connections.getConnectionManager().size === 1);
        await expect(sql`SELECT 1`.execute(original.db)).rejects.toThrow();
        expect(operations.connection.db).toBe(replacement);
        await expect(sql`SELECT 1`.execute(replacement)).resolves.toBeDefined();

    });

    it('retires a retained connection on config change and closes it only after idempotent release', async () => {

        const view = await mountOperations();
        const original = app.activeConfig!;
        const db = operations.connection.db!;
        const lease = connection.retainConnection(db, original);
        await sql`CREATE TABLE retained_marker (value INTEGER)`.execute(db);
        app = { ...app, activeConfig: config('B'), activeConfigName: 'B' };
        view.rerender(<ConnectionProvider><Probe /></ConnectionProvider>);
        await until(() => operations.connection.db !== null && operations.connection.db !== db);
        await sql`INSERT INTO retained_marker VALUES (7)`.execute(lease.db);
        expect((await sql<{ value: number }>`SELECT value FROM retained_marker`.execute(lease.db)).rows).toEqual([{ value: 7 }]);
        expect(() => connection.retainConnection(db, original)).toThrow();
        await lease.release();
        await lease.release();
        await expect(sql`SELECT 1`.execute(db)).rejects.toThrow();
        await expect(sql`SELECT 1`.execute(operations.connection.db!)).resolves.toBeDefined();

    });

    it('ordinary destruction waits for a retained handle and stops publishing it immediately', async () => {

        await mountOperations();
        const db = operations.connection.db!;
        const lease = connection.retainConnection(db, app.activeConfig!);
        const secondLease = connection.retainConnection(db, app.activeConfig!);
        let destroyed = false;
        const destroying = connection.destroyConnection().then(() => {

            destroyed = true;

        });
        await until(() => operations.connection.db === null);
        expect(destroyed).toBe(false);
        await expect(sql`SELECT 1`.execute(lease.db)).resolves.toBeDefined();
        await lease.release();
        await lease.release();
        expect(destroyed).toBe(false);
        await secondLease.release();
        await destroying;
        expect(destroyed).toBe(true);
        await expect(sql`SELECT 1`.execute(db)).rejects.toThrow();

    });

    it('retains the original memory database through success and confirmed rollback', async () => {

        await mountOperations();
        const db = operations.connection.db!;
        await sql`CREATE TABLE markers (value INTEGER)`.execute(db);
        const result = await operations.run('example', { dryRun: false, yes: true, target: operations.target! });
        expect(result.status).toBe('success');
        expect((await sql<{ value: number }>`SELECT value FROM markers ORDER BY value`.execute(db)).rows).toEqual([{ value: 1 }, { value: 2 }]);
        await writeFile(join(root, 'pipelines', 'example', 'second.sql'), 'INSERT INTO missing_table VALUES (3);');
        const failed = await operations.run('example', { dryRun: false, yes: true, target: operations.target! });
        expect(failed.status).toBe('failed');
        expect(failed.transactionOutcome).toBe('rolled_back');
        expect(operations.connection.db).toBe(db);
        expect((await sql<{ value: number }>`SELECT value FROM markers ORDER BY value`.execute(db)).rows).toHaveLength(2);
        expect((await operations.history('example')).map((run) => run.id)).toEqual([failed.runId!, result.runId!]);
        expect((await operations.getRun(failed.runId!))?.steps.map((step) => step.step_no)).toEqual([1, 2]);
        expect(operations.cleanupFailed).toBe(false);
        expect(getLifecycleManager(root).exitCode).toBe(0);

    });

    it('invalidates a retired memory handle immediately without clearing or closing its replacement', async () => {

        const view = await mountOperations();
        const db = operations.connection.db!;
        const lease = connection.retainConnection(db, app.activeConfig!);
        app = { ...app, activeConfig: config('B'), activeConfigName: 'B' };
        view.rerender(<ConnectionProvider><Probe /></ConnectionProvider>);
        await until(() => operations.connection.db !== null && operations.connection.db !== db);
        const replacement = operations.connection.db!;
        await lease.invalidate();
        await lease.invalidate();
        await expect(sql`SELECT 1`.execute(db)).rejects.toThrow();
        expect(operations.connection.db).toBe(replacement);
        await lease.release();
        await expect(sql`SELECT 1`.execute(replacement)).resolves.toBeDefined();

    });

    it('rejects a stale confirmation even for a changed config with the same name', async () => {

        const view = await mountOperations();
        const target = operations.target!;
        app = { ...app, activeConfig: config('A') };
        view.rerender(<ConnectionProvider><Probe /></ConnectionProvider>);
        await until(() => operations.target !== null && operations.target !== target);
        await expect(operations.run('example', { dryRun: false, yes: true, target })).rejects.toThrow();
        expect(await operations.history('example')).toEqual([]);

    });

    it('rejects duplicate submissions and stops before core if preparation was aborted', async () => {

        preparation = deferred();
        await mountOperations();
        const options = { dryRun: false, yes: true as const, target: operations.target! };
        const pending = operations.run('example', options);
        const settled = Promise.allSettled([pending]);
        await Promise.race([preparationEntered.promise, pending]);
        await until(() => operations.running);
        await expect(operations.run('example', options)).rejects.toThrow();
        operations.stop();
        expect(operations.running).toBe(true);
        preparation.resolve();
        expect(await settled).toEqual([
            { status: 'rejected', reason: expect.objectContaining({ name: 'AbortError' }) },
        ]);
        await until(() => !operations.running);
        expect(await operations.history('example')).toEqual([]);

    });

    it('keeps a mounted stopped operation busy until real SQL and bookkeeping settle', async () => {

        const delayed = delayWorkflowResult();
        await mountOperations();
        await sql`CREATE TABLE markers (value INTEGER)`.execute(operations.connection.db!);
        const pending = operations.run('example', { dryRun: false, yes: true, target: operations.target! });
        await delayed.entered.promise;
        operations.stop();
        await until(() => operations.running);
        delayed.finish.resolve();
        const result = await pending;
        expect(result.dryRun).toBe(false);
        expect(result.status).toBe('interrupted');
        expect(result.transactionOutcome).toBe('rolled_back');
        expect((await operations.getRun(result.runId!))?.run.status).toBe('interrupted');
        expect((await sql`SELECT * FROM markers`.execute(operations.connection.db!)).rows).toEqual([]);

    });

    it('fatal core rollback invalidates its retained memory handle without destroying the replacement or deadlocking', async () => {

        const delayed = delayWorkflowResult(true);
        const view = await mountOperations();
        const original = operations.connection.db!;
        await sql`CREATE TABLE markers (value INTEGER)`.execute(original);
        const pending = operations.run('example', { dryRun: false, yes: true, target: operations.target! });
        await delayed.entered.promise;
        app = { ...app, activeConfig: config('B'), activeConfigName: 'B' };
        view.rerender(<ConnectionProvider><Probe /></ConnectionProvider>);
        await until(() => operations.connection.db !== null && operations.connection.db !== original);
        const replacement = operations.connection.db!;
        delayed.finish.resolve();
        const result = await pending;
        expect(result.transactionOutcome).toBe('unknown');
        expect(result.status).not.toBe('success');
        expect(delayed.destroyed).toEqual(['A']);
        await expect(sql`SELECT 1`.execute(original)).rejects.toThrow();
        expect(operations.connection.db).toBe(replacement);
        await expect(sql`SELECT 1`.execute(replacement)).resolves.toBeDefined();

    });

    it('preserves a confirmed native commit when retained cleanup fails after bookkeeping', async () => {

        const lifecycle = await mountShutdown();
        delayWorkflowResult(false, true).finish.resolve();
        spyOn(pipelineHistory, 'finalizePipelineRun').mockImplementation(async (...args) => {

            await finalizePipelineRun(...args);
            void connection.destroyConnection().catch(() => undefined);

        });
        const view = await mountOperations();
        await sql`CREATE TABLE markers (value INTEGER)`.execute(operations.connection.db!);
        const result = await operations.run('example', { dryRun: false, yes: true, target: operations.target! });

        if (result.dryRun) throw new Error('Expected an admitted pipeline run');
        expect(result.runId).toBeGreaterThan(0);
        expect(result.status).toBe('success');
        expect(result.transactionOutcome).toBe('committed');
        expect(result.primaryError).toBeNull();
        expect(result.secondaryErrors).toEqual([]);
        await until(() => operations.cleanupFailed);
        await until(() => !!view.lastFrame()?.includes('cleanup failed'));
        expect(view.lastFrame()).not.toContain('CLEANUP_PRIVATE_CANARY');
        expect(lifecycle.exitCode).toBe(1);
        const codes: number[] = [];
        const off = observer.on('app:exit', ({ code }) => codes.push(code));
        try {

            await shutdown.gracefulExit();
            expect(codes).toEqual([1]);
            expect(lifecycle.exitCode).toBe(1);

        }
        finally {

            off();

        }

    });

    it.each([
        ['quit', 0], ['quit', 7],
        ['unmount', 0], ['unmount', 7],
        ['config', 0], ['config', 7],
    ] as const)('awaits native zero-retain destruction after %s retirement (prior=%s)', async (boundary, priorCode) => {

        const diagnostics = spyOn(console, 'error').mockImplementation(() => undefined);
        const lifecycle = await mountShutdown();
        const filename = join(root, 'completed.sqlite');
        app.activeConfig.connection.database = filename;
        const view = await mountOperations();
        const db = operations.connection.db!;
        await sql`CREATE TABLE markers (value INTEGER)`.execute(db);
        const result = await operations.run('example', { dryRun: false, yes: true, target: operations.target! });
        if (result.dryRun) throw new Error('Expected an admitted pipeline run');
        await until(() => !operations.running);
        expect(connection.state.db).toBe(db);
        expect(result.status).toBe('success');
        expect(result.transactionOutcome).toBe('committed');
        expect(result.primaryError).toBeNull();
        expect(result.secondaryErrors).toEqual([]);
        expect(operations.cleanupFailed).toBe(false);
        const snapshot = () => {

            const persisted = new Database(filename, { readonly: true });
            try {

                return {
                    runs: persisted.prepare('SELECT * FROM __noorm_pipeline_run__ ORDER BY id').all(),
                    steps: persisted.prepare('SELECT * FROM __noorm_pipeline_step__ ORDER BY step_no').all(),
                    markers: persisted.prepare('SELECT * FROM markers ORDER BY value').all(),
                };

            }
            finally {

                persisted.close();

            }

        };
        const before = snapshot();
        expect(before.runs).toEqual([expect.objectContaining({
            id: result.runId, status: 'success', transaction_outcome: 'committed',
        })]);
        expect(before.markers).toEqual([{ value: 1 }, { value: 2 }]);
        const entered = deferred();
        const finish = deferred();
        gates.push(finish);
        const destroy = SqliteDriver.prototype.destroy;
        const closingDrivers: SqliteDriver[] = [];
        spyOn(SqliteDriver.prototype, 'destroy').mockImplementation(async function (this: SqliteDriver) {

            closingDrivers.push(this);
            if (closingDrivers.length !== 1) return destroy.call(this);
            entered.resolve();
            await finish.promise;
            await destroy.call(this);
            throw new Error('ZERO_RETAIN_PRIVATE_CANARY');

        });
        lifecycle.setExitCode(priorCode);
        const codes: number[] = [];
        const off = observer.on('app:exit', ({ code }) => codes.push(code));
        let pending: Promise<void> | undefined;
        try {

            if (boundary === 'config') {

                app = { ...app, activeConfig: config('B'), activeConfigName: 'B' };
                view.rerender(<ConnectionProvider><Probe /></ConnectionProvider>);

            }
            else if (boundary === 'unmount') view.unmount();
            else pending = shutdown.gracefulExit();
            await entered.promise;
            expect(connections.getConnectionManager().size).toBeLessThanOrEqual(1);
            pending ??= shutdown.gracefulExit();
            await pause(30);
            expect(codes).toEqual([]);
            expect(snapshot()).toEqual(before);
            finish.resolve();
            await pending;
            expect(codes).toEqual([priorCode || 1]);
            expect(lifecycle.exitCode).toBe(priorCode || 1);
            expect(snapshot()).toEqual(before);
            expect(result.status).toBe('success');
            expect(result.transactionOutcome).toBe('committed');
            expect(result.primaryError).toBeNull();
            expect(result.secondaryErrors).toEqual([]);
            expect(view.lastFrame()).not.toContain('ZERO_RETAIN_PRIVATE_CANARY');
            expect(diagnostics).not.toHaveBeenCalled();
            await expect(sql`SELECT 1`.execute(db)).rejects.toThrow();
            expect(closingDrivers.filter((driver) => driver === closingDrivers[0])).toHaveLength(1);

        }
        finally {

            finish.resolve();
            await pending;
            off();

        }

    });

    it('preserves native fatal execution evidence when retained destruction also fails', async () => {

        const delayed = delayWorkflowResult(true, true);
        const view = await mountOperations();
        const original = operations.connection.db!;
        await sql`CREATE TABLE markers (value INTEGER)`.execute(original);
        const pending = operations.run('example', { dryRun: false, yes: true, target: operations.target! });
        await delayed.entered.promise;
        app = { ...app, activeConfig: config('B'), activeConfigName: 'B' };
        view.rerender(<ConnectionProvider><Probe /></ConnectionProvider>);
        await until(() => operations.connection.db !== null && operations.connection.db !== original);
        delayed.finish.resolve();
        const result = await pending;

        if (result.dryRun) throw new Error('Expected an admitted pipeline run');
        expect(result.runId).toBeGreaterThan(0);
        expect(result.status).toBe('interrupted');
        expect(result.transactionOutcome).toBe('unknown');
        expect(result.primaryError).toMatchObject({ phase: 'interrupted' });
        expect(result.secondaryErrors).toEqual(expect.arrayContaining([
            expect.objectContaining({ phase: 'rollback' }),
            expect.objectContaining({ phase: 'cleanup' }),
        ]));
        await until(() => operations.cleanupFailed);
        expect(typeof operations.cleanupFailed).toBe('boolean');
        await until(() => !!view.lastFrame()?.includes('cleanup failed'));
        expect(view.lastFrame()).not.toContain('CLEANUP_PRIVATE_CANARY');
        expect(getLifecycleManager(root).exitCode).toBe(1);
        await getLifecycleManager(root).shutdown('user');
        expect(getLifecycleManager(root).exitCode).toBe(1);

    });

    it('preserves the preparation rejection when retired native destruction fails', async () => {

        const delayed = delayWorkflowResult(false, true);
        const primary = new Error('original preparation failure');
        const finish = deferred();
        gates.push(finish);
        const buildContext = spyOn(pipelineContext, 'buildPipelineContext').mockImplementation(async () => {

            preparationEntered.resolve();
            await finish.promise;
            throw primary;

        });
        const view = await mountOperations();
        const original = operations.connection.db!;
        const pending = operations.run('example', { dryRun: false, yes: true, target: operations.target! });
        const settled = Promise.allSettled([pending]);
        await preparationEntered.promise;
        app = { ...app, activeConfig: config('B'), activeConfigName: 'B' };
        view.rerender(<ConnectionProvider><Probe /></ConnectionProvider>);
        await until(() => operations.connection.db !== null && operations.connection.db !== original);
        finish.resolve();
        expect(await settled).toEqual([{ status: 'rejected', reason: primary }]);
        await expect(pending).rejects.toBe(primary);
        await until(() => operations.cleanupFailed);
        expect(delayed.destroyed).toEqual(['A']);
        expect(getLifecycleManager(root).exitCode).toBe(1);
        await until(() => !!view.lastFrame()?.includes('cleanup failed'));
        expect(view.lastFrame()).not.toContain('CLEANUP_PRIVATE_CANARY');
        buildContext.mockImplementation(buildTestPipelineContext);
        preparation = deferred();
        gates.push(preparation);
        const cleanPending = operations.run('example', { dryRun: true, yes: true, target: operations.target! });
        await until(() => operations.running && !operations.cleanupFailed);
        preparation.resolve();
        const clean = await cleanPending;
        expect(clean.dryRun).toBe(true);
        await until(() => !operations.cleanupFailed);
        expect(delayed.destroyed).toEqual(['A']);
        await expect(sql`SELECT 1`.execute(operations.connection.db!)).resolves.toBeDefined();

    });

    it.each(['screen', 'provider'] as const)('keeps its completing waiter after %s unmount until the original operation settles', async (owner) => {

        const delayed = delayWorkflowResult();
        const view = await mountOperations();
        const db = operations.connection.db!;
        await sql`CREATE TABLE markers (value INTEGER)`.execute(db);
        const pending = operations.run('example', { dryRun: false, yes: true, target: operations.target! });
        await delayed.entered.promise;
        if (owner === 'provider') view.unmount();
        else view.rerender(<ConnectionProvider><Text>another screen</Text></ConnectionProvider>);
        let exited = false;
        const shuttingDown = getLifecycleManager().shutdown('user').then(() => {

            exited = true;

        });
        await pause(30);
        expect(exited).toBe(false);
        delayed.finish.resolve();
        const result = await pending;
        await shuttingDown;
        expect(result.status).toBe('interrupted');
        expect(result.transactionOutcome).toBe('rolled_back');
        await expect(sql`SELECT 1`.execute(db)).rejects.toThrow();
        expect(connections.getConnectionManager().size).toBe(0);

    });

    it('actual global shutdown preserves factory-created connections through completing and closes them in releasing', async () => {

        const captured = await createConnection({ dialect: 'sqlite', database: ':memory:' }, 'tracked');
        const completing = deferred();
        let markerDuringCompleting = false;
        const lifecycle = getLifecycleManager();
        lifecycle.registerResource({ name: 'real-work', phase: 'completing', cleanup: async () => {

            await completing.promise;
            await sql`CREATE TABLE shutdown_marker (value INTEGER)`.execute(captured.db);
            await sql`INSERT INTO shutdown_marker VALUES (1)`.execute(captured.db);
            markerDuringCompleting = (await sql`SELECT * FROM shutdown_marker`.execute(captured.db)).rows.length === 1;

        } });
        const shuttingDown = lifecycle.shutdown('user');
        await pause(20);
        expect(connections.getConnectionManager().isShuttingDown).toBe(true);
        await expect(sql`SELECT 1`.execute(captured.db)).resolves.toBeDefined();
        completing.resolve();
        await shuttingDown;
        expect(markerDuringCompleting).toBe(true);
        expect(connections.getConnectionManager().size).toBe(0);
        await expect(sql`SELECT 1`.execute(captured.db)).rejects.toThrow();
        expect(lifecycle.exitCode).toBe(0);

    });

    it('shutdown waits for asynchronous preparation after stopping has requested abort', async () => {

        const lifecycle = getLifecycleManager(root);
        preparation = deferred();
        await mountOperations();
        const db = operations.connection.db!;
        const pending = operations.run('example', { dryRun: false, yes: true, target: operations.target! });
        const settled = Promise.allSettled([pending]);
        await Promise.race([preparationEntered.promise, pending]);
        let completed = false;
        const completing = deferred();
        const off = observer.on('app:shutdown:phase', ({ phase, status }) => {

            if (phase === 'completing' && status === 'running') completing.resolve();

        });
        try {

            const shuttingDown = lifecycle.shutdown('user').then(() => {

                completed = true;

            });
            await completing.promise;
            expect(completed).toBe(false);
            await expect(sql`SELECT 1`.execute(db)).resolves.toBeDefined();
            preparation.resolve();
            expect(await settled).toEqual([
                { status: 'rejected', reason: expect.objectContaining({ name: 'AbortError' }) },
            ]);
            await shuttingDown;

        }
        finally {

            off();

        }
        expect(connections.getConnectionManager().size).toBe(0);

    });

    it('scopes history to the captured config and rejects late results after target replacement', async () => {

        const view = await mountOperations();
        const db = operations.connection.db!;
        await sql`CREATE TABLE markers (value INTEGER)`.execute(db);
        const result = await operations.run('example', { dryRun: false, yes: true, target: operations.target! });
        const entered = deferred<Parameters<typeof listPipelineHistory>[0]>();
        const reads: Parameters<typeof listPipelineHistory>[0][] = [];
        const finish = deferred();
        gates.push(finish);
        spyOn(pipelineHistory, 'listPipelineHistory').mockImplementation(async (...args) => {

            reads.push(args[0]);
            const result = await listPipelineHistory(...args);
            if (args[0].db === db) {

                entered.resolve(args[0]);
                await finish.promise;

            }

            return result;

        });
        const target = operations.target;
        const reading = operations.history('example');
        const settled = Promise.allSettled([reading]);
        const captured = await entered.promise;
        expect(captured.db).toBe(db);
        expect(captured.configName).toBe('A');
        app = { ...app, activeConfig: config('B'), activeConfigName: 'B' };
        view.rerender(<ConnectionProvider><Probe /></ConnectionProvider>);
        await until(() => operations.connection.db !== null && operations.connection.db !== db);
        await until(() => operations.target !== null && operations.target !== target);
        await expect(sql`SELECT 1`.execute(db)).resolves.toBeDefined();
        finish.resolve();
        expect(await settled).toEqual([
            { status: 'rejected', reason: expect.any(Error) },
        ]);
        expect(await operations.history('example')).toEqual([]);
        expect(reads[1]?.db).toBe(operations.connection.db!);
        expect(reads[1]?.configName).toBe('B');
        expect(await operations.getRun(result.runId!)).toBeNull();
        await expect(operations.history('example', 0)).rejects.toThrow();
        await expect(operations.getRun(0)).rejects.toThrow();

    });

});

describe('bounded terminal shutdown', () => {

    it('does not clear prior failure when shutdown explicitly requests zero', async () => {

        const lifecycle = getLifecycleManager(root);
        lifecycle.setExitCode(7);
        await lifecycle.shutdown('signal', 0);
        expect(lifecycle.exitCode).toBe(7);

    });

    it('does not clear a failure raised by an early shutdown listener', async () => {

        const lifecycle = await mountShutdown();
        const off = observer.on('app:shutdown', () => lifecycle.setExitCode(1));
        const codes: number[] = [];
        const offExit = observer.on('app:exit', ({ code }) => codes.push(code));
        try {

            await shutdown.gracefulExit();
            expect(codes).toEqual([1]);
            expect(lifecycle.exitCode).toBe(1);

        }
        finally {

            off();
            offExit();

        }

    });

    it.each([false, true])('preserves an earlier cleanup exit code through managed quit (forced=%s)', async (forced) => {

        const lifecycle = await mountShutdown();
        lifecycle.setExitCode(7);
        const finish = deferred();
        const entered = deferred();
        gates.push(finish);
        if (forced) lifecycle.registerResource({
            name: 'held-completion', phase: 'completing', cleanup: async () => {

                entered.resolve();
                await finish.promise;

            },
        });
        const codes: number[] = [];
        const off = observer.on('app:exit', ({ code }) => codes.push(code));
        try {

            const pending = shutdown.gracefulExit();
            if (forced) {

                await entered.promise;
                expect(codes).toEqual([]);
                await shutdown.gracefulExit();
                finish.resolve();

            }
            await pending;
            expect(codes).toEqual([forced ? 1 : 7]);
            expect(lifecycle.exitCode).toBe(7);

        }
        finally {

            off();
            finish.resolve();

        }

    });

    it.each(['ui', 'sql/repl'])('%s preserves the emitted exit code when clearing and unmounting Ink', (entry) => {

        const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url));
        const source = (path: string) => JSON.stringify(join(repoRoot, 'src', path));
        // Isolate module-loading boundaries from this file's real Ink/provider tests.
        const script = `
            import { mock } from 'bun:test';
            import { observer } from ${source('core/observer.ts')};
            Object.defineProperty(process.stdin, 'isTTY', { value: true });
            mock.module('ink', () => ({
                render: () => ({
                    waitUntilExit: async () => observer.emit('app:exit', { code: 7 }),
                    clear: () => process.stdout.write('cleared\\n'),
                    unmount: () => process.stdout.write('unmounted\\n'),
                }),
            }));
            mock.module(${source('tui/app.tsx')}, () => ({ App: () => null }));
            const { default: command } = await import(${source(`cli/${entry}.ts`)});
            await command.run({ args: { _: [], yes: false }, rawArgs: [], cmd: command, data: {} });
        `;
        const result = spawnSync(process.execPath, ['--eval', script], {
            cwd: repoRoot, encoding: 'utf8', timeout: 10000,
            env: { ...process.env, NOORM_YES: 'false' },
        });
        expect(result.error).toBeUndefined();
        expect(result.status).toBe(7);
        expect(result.stdout).toBe('cleared\nunmounted\n');

    });

    it('shows a timed-out completing phase as incomplete and emits a nonzero exit', async () => {

        await resetLifecycleManager();
        const lifecycle = getLifecycleManager(root, {
            registerSignalHandlers: false,
            timeouts: { operations: 20, locks: 100, connections: 100, logger: 100 },
        });
        const finish = deferred();
        lifecycle.registerResource({ name: 'unfinished', phase: 'completing', cleanup: () => finish.promise });
        const codes: number[] = [];
        const off = observer.on('app:exit', ({ code }) => codes.push(code));
        const view = render(<ShutdownProvider projectRoot={root}><ShutdownProbe /></ShutdownProvider>);
        mounts.push(view.unmount);
        await until(() => lifecycle.isRunning);
        await shutdown.gracefulExit();
        await until(() => !!view.lastFrame()?.includes('timed out'));
        expect(view.lastFrame()).toContain('incomplete');
        expect(view.lastFrame()).not.toContain('✓ Completing tasks');
        expect(codes).toEqual([1]);
        expect(lifecycle.exitCode).toBe(1);
        finish.resolve();
        off();

    });

    it('second quit exits nonzero without pretending that in-flight work settled', async () => {

        await resetLifecycleManager();
        const lifecycle = getLifecycleManager(root, { registerSignalHandlers: false });
        const finish = deferred();
        lifecycle.registerResource({ name: 'unfinished', phase: 'completing', cleanup: () => finish.promise });
        const codes: number[] = [];
        const off = observer.on('app:exit', ({ code }) => codes.push(code));
        const view = render(<ShutdownProvider projectRoot={root}><ShutdownProbe /></ShutdownProvider>);
        mounts.push(view.unmount);
        await until(() => lifecycle.isRunning);
        const pending = shutdown.gracefulExit();
        await until(() => lifecycle.isShuttingDown);
        await shutdown.gracefulExit();
        expect(codes).toEqual([1]);
        finish.resolve();
        await pending;
        expect(codes).toEqual([1]);
        off();

    });

});
