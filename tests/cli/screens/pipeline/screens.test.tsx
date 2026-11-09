import { afterAll, afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';
import { mkdtemp, mkdir, writeFile, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { stripVTControlCharacters } from 'node:util';
import { setTimeout } from 'node:timers/promises';
import React, { act } from 'react';
import { useInput } from 'ink';
import { render as inkRender } from 'ink-testing-library';
import { FocusProvider } from '../../../../src/tui/focus.js';
import { discoverPipelineDefinitions, inputPresence, pipelineResultIsClean, PipelineEvidence } from '../../../../src/tui/screens/pipeline/helpers.js';
import { RouterProvider, useRouter } from '../../../../src/tui/router.js';
import type { PipelineDryRunResult, PipelineJsonValue, PipelineRunResult } from '../../../../src/core/pipeline/types.js';
import { invalidDefinition } from '../../../../src/core/pipeline/errors.js';
import type { NoormPipelineRun, NoormPipelineStep } from '../../../../src/core/shared/tables.js';
import { PipelineRunScreen } from '../../../../src/tui/screens/pipeline/PipelineRunScreen.js';
import { PipelineHistoryScreen } from '../../../../src/tui/screens/pipeline/PipelineHistoryScreen.js';
import { PipelineHistoryDetailScreen } from '../../../../src/tui/screens/pipeline/PipelineHistoryDetailScreen.js';
import { PipelineListScreen } from '../../../../src/tui/screens/pipeline/PipelineListScreen.js';
import * as appContext from '../../../../src/tui/app-context.js';
import * as pipelineOperations from '../../../../src/tui/hooks/usePipelineOperations.js';
import { withPolicy } from '../../../utils/access.js';

const actualAppContext = { ...appContext };
const actualPipelineOperations = { ...pipelineOperations };

const roots: string[] = [];
let previousActEnvironment: unknown;
const actEnvironment = globalThis as Record<string, unknown>;
let inputDelivered: (() => void) | undefined;

function InputDelivery() {

    useInput(() => inputDelivered?.());

    return null;

}

function render(tree: React.ReactElement) {

    let view!: ReturnType<typeof inkRender>;
    const content = (next: React.ReactElement) => <>{next}<InputDelivery /></>;
    act(() => {

        view = inkRender(content(tree));

    });

    return {
        ...view,
        rerender: (next: React.ReactElement) => act(() => view.rerender(content(next))),
        unmount: () => act(() => view.unmount()),
    };

}
afterEach(async () => {

    actEnvironment['IS_REACT_ACT_ENVIRONMENT'] = previousActEnvironment;
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));

});

async function fixture() {

    const root = await mkdtemp(join(tmpdir(), 'noorm-pipeline-tui-'));
    roots.push(root);

    return root;

}

describe('native pipeline discovery', () => {

    it('treats a missing root as empty', async () => {

        expect(await discoverPipelineDefinitions(await fixture(), 'db/pipelines')).toEqual([]);

    });

    it('keeps malformed and escaping definitions visible without exposing manifest values', async () => {

        const root = await fixture();
        await mkdir(join(root, 'db/pipelines/broken'), { recursive: true });
        await writeFile(join(root, 'db/pipelines/broken/pipeline.yml'), 'inputs: [private-manifest-value');
        const outside = await fixture();
        await symlink(outside, join(root, 'db/pipelines/escape'));
        const entries = await discoverPipelineDefinitions(root, 'db/pipelines');
        expect(entries.map((entry) => entry.slug)).toEqual(['broken', 'escape']);
        expect(entries.every((entry) => entry.definition === null)).toBe(true);
        expect(JSON.stringify(entries)).not.toContain('private-manifest-value');

    });

    it('loads ordered metadata without rendering templates', async () => {

        const root = await fixture();
        const folder = join(root, 'db/pipelines/workflow');
        await mkdir(folder, { recursive: true });
        await writeFile(join(folder, 'pipeline.yml'), 'steps:\n  - id: first\n    sql: first.sql.tmpl\n  - id: second\n    sql: second.sql\n');
        await writeFile(join(folder, 'first.sql.tmpl'), '<% throw new Error("must-not-render") %>');
        await writeFile(join(folder, 'second.sql'), 'select 1');
        const [entry] = await discoverPipelineDefinitions(root, 'db/pipelines');
        expect(entry?.definition?.steps.map((step) => [step.id, step.needs])).toEqual([['first', []], ['second', [1]]]);

    });

});

describe('native pipeline safe presentation', () => {

    it('distinguishes presence from falsy values and defaults', () => {

        const declaration = { type: 'string' as const, description: 'Text', required: true };
        expect(inputPresence('text', declaration, {})).toBe('Unset');
        expect(inputPresence('text', { ...declaration, required: false }, {})).toBe('Omitted');
        expect(inputPresence('text', { ...declaration, default: '' }, {})).toBe('Default');
        expect(inputPresence('text', declaration, { text: '' })).toBe('Supplied');

    });

    it('never treats unknown or partial outcomes as clean success', () => {

        expect(pipelineResultIsClean('success', 'committed')).toBe(true);
        expect(pipelineResultIsClean('success', 'unknown')).toBe(false);
        expect(pipelineResultIsClean('success', 'partial')).toBe(false);
        expect(pipelineResultIsClean('failed', 'rolled_back')).toBe(false);

    });

    it('renders only ordered safe evidence, never stored error, path or skip reason', () => {

        const steps = [2, 1].map((stepNo) => ({ stepNo, name: `step-${stepNo}`, status: 'failed', outcome: 'unknown', error: { phase: 'execute', stepNo, message: 'private-sql-error' }, filepath: 'private-filepath', skipReason: 'private-skip-reason' }));
        const view = render(<FocusProvider><PipelineEvidence status="success" outcome="unknown" runId={42} steps={steps} /></FocusProvider>);
        const frame = view.lastFrame() ?? '';
        expect(frame).toContain('42');
        expect(frame).toContain('unknown');
        expect(frame.indexOf('step-1')).toBeLessThan(frame.indexOf('step-2'));
        for (const secret of ['private-sql-error', 'private-filepath', 'private-skip-reason']) expect(frame).not.toContain(secret);
        expect(frame).not.toContain('completed successfully');
        view.unmount();

    });

    it('bounds maximum-slug review, failed result and history at 80×24 while retaining full details', async () => {

        await workflow();
        const ids = Array.from({ length: 30 }, (_, index) => `step${index}_${'x'.repeat(245)}`);
        const folder = join(app.projectRoot, 'db/pipelines/workflow');
        await writeFile(join(folder, 'pipeline.yml'), `steps:\n${ids.map((id, index) => `  - id: ${id}\n    sql: first.sql\n    needs: [${ids.slice(0, index).join(', ')}]\n`).join('')}`);
        const slugs = Array.from({ length: 8 }, (_, index) => `${'long-pipeline-'.repeat(17)}${'x'.repeat(16)}${index}`);
        const slug = slugs[7]!;
        expect(slug.length).toBe(255);
        await Promise.all(slugs.map((slug) => symlink(folder, join(app.projectRoot, 'db/pipelines', slug))));
        const list = render(<FocusProvider><RouterProvider initialRoute="pipeline"><PipelineListScreen params={{}} /></RouterProvider></FocusProvider>);
        try {

            act(() => {

                Object.defineProperty(list.stdout, 'columns', { configurable: true, value: 80 });
                Object.defineProperty(list.stdout, 'rows', { configurable: true, value: 24 });
                list.stdout.emit('resize');

            });
            await until(() => list.lastFrame()?.includes('long-pipeline-') === true);
            expect((list.lastFrame() ?? '').split('\n').length).toBeLessThanOrEqual(24);
            expect(list.lastFrame()).toContain('[Enter] Review');
            expect(list.lastFrame()).toContain('[Esc] Back');
            await press(list, '/');
            await press(list, slugs[7]!);
            await press(list, '\r');
            expect((list.lastFrame() ?? '').split('\n').length).toBeLessThanOrEqual(24);

        }
        finally {

            list.unmount();

        }
        const failure = { phase: 'execute' as const, stepNo: 30, message: 'private-execution-error' };
        const result: PipelineRunResult = {
            dryRun: false, runId: 9, slug, mode: 'graph', transaction: 'none', concurrency: 1,
            singleRun: false, status: 'failed', transactionOutcome: 'unknown', startedAt: new Date(), finishedAt: new Date(),
            durationMs: 1, steps: ids.map((name, index) => ({
                stepNo: index + 1, name, needs: Array.from({ length: index }, (_, dependency) => dependency + 1),
                filepath: 'first.sql', checksum: 'checksum', startedAt: new Date(), finishedAt: new Date(),
                status: index === 29 ? 'failed' : 'success', transactionOutcome: 'unknown', durationMs: 1,
                error: index === 29 ? failure : null,
            })), primaryError: failure, secondaryErrors: [],
        };
        runOperation = async () => {

            cleanupFailed = true;

            return result;

        };
        const view = render(<FocusProvider><RouterProvider initialRoute="pipeline/run"><PipelineRunScreen params={{ pipelineSlug: slug }} /></RouterProvider></FocusProvider>);
        try {

            act(() => {

                Object.defineProperty(view.stdout, 'columns', { configurable: true, value: 80 });
                Object.defineProperty(view.stdout, 'rows', { configurable: true, value: 24 });
                view.stdout.emit('resize');

            });
            await until(() => view.lastFrame()?.includes('No declared inputs') === true);
            await press(view, 's');
            for (const _id of ids.slice(1)) await press(view, '\x1b[B');
            const review = view.lastFrame() ?? '';
            expect(review.split('\n').length + 4).toBeLessThanOrEqual(24);
            expect(review).toContain('[r] Run');
            expect(review).toContain('[Esc] Back');
            await press(view, 'd');
            expect(stripVTControlCharacters(view.lastFrame() ?? '').replace(/[\s│]/g, '')).toContain(slug);
            await press(view, '\x1b');
            await press(view, '\r');
            let detail = stripVTControlCharacters(view.lastFrame() ?? '').replace(/[\s│]/g, '');
            expect(detail).toContain(ids[29]!);
            expect(detail).toContain(`Dependencies:${Array.from({ length: 29 }, (_, index) => index + 1).join(',')}`);
            await press(view, '\x1b');
            for (let revisit = 0; revisit < 2; revisit++) {

                expect(view.lastFrame()).toContain('30.');
                await press(view, '\r');
                expect(stripVTControlCharacters(view.lastFrame() ?? '').replace(/[\s│]/g, '')).toContain(ids[29]!);
                await press(view, '\x1b');

            }
            await press(view, 's');
            await press(view, 's');
            await press(view, 'r');
            await press(view, '\x1b');
            await press(view, '\r');
            expect(stripVTControlCharacters(view.lastFrame() ?? '').replace(/[\s│]/g, '')).toContain(ids[29]!);
            await press(view, '\x1b');
            await press(view, 'r');
            await press(view, 'y');
            await until(() => view.lastFrame()?.includes('Execution status: failed') === true);
            for (const _id of ids.slice(1)) await press(view, '\x1b[B');
            const evidence = view.lastFrame() ?? '';
            expect(evidence.split('\n').length + 4).toBeLessThanOrEqual(24);
            expect(evidence).toContain('Transaction outcome: unknown');
            expect(evidence).toContain('Error phase: execute · Step 30');
            expect(evidence).toContain('Connection cleanup failed');
            expect(evidence).not.toContain('private-execution-error');
            expect(evidence).toContain('[Enter] Step details');
            expect(evidence).toContain('[Esc] Back');
            await press(view, '\r');
            detail = stripVTControlCharacters(view.lastFrame() ?? '').replace(/[\s│]/g, '');
            expect(detail).toContain(ids[29]!);
            expect(detail).toContain(`Dependencies:${Array.from({ length: 29 }, (_, index) => index + 1).join(',')}`);
            expect(detail).toContain('Errorphase:execute');
            await press(view, '\x1b');
            await press(view, 'd');
            expect(stripVTControlCharacters(view.lastFrame() ?? '').replace(/[\s│]/g, '')).toContain(slug);
            await press(view, '\x1b');
            for (let revisit = 0; revisit < 2; revisit++) {

                expect(view.lastFrame()).toContain('30.');
                expect(view.lastFrame()).toContain('Dependencies:');
                await press(view, '\r');
                expect(stripVTControlCharacters(view.lastFrame() ?? '').replace(/[\s│]/g, '')).toContain(ids[29]!);
                await press(view, '\x1b');

            }
            await press(view, 'r');
            await press(view, '\r');
            expect(stripVTControlCharacters(view.lastFrame() ?? '').replace(/[\s│]/g, '')).toContain(ids[29]!);
            await press(view, '\x1b');
            await press(view, 'r');
            await press(view, 'y');
            await until(() => view.lastFrame()?.includes('Execution status: failed') === true);
            await press(view, '\r');
            expect(stripVTControlCharacters(view.lastFrame() ?? '').replace(/[\s│]/g, '')).toContain(ids[0]!);

        }
        finally {

            view.unmount();

        }

        const run: NoormPipelineRun = {
            id: 9, slug, config_name: app.activeConfigName, executed_by: 'operator', cli_version: 'test',
            created_at: new Date(), manifest_checksum: 'checksum', transaction_policy: 'none', single_run: false,
            status: 'failed', transaction_outcome: 'unknown', started_at: new Date(), finished_at: new Date(),
            error_message: 'private-history-error', duration_ms: 1, active_key: 'private-active-key',
        };
        historyOperation = async () => Array.from({ length: 30 }, (_, index) => ({ ...run, id: index + 1 }));
        detailOperation = async () => ({
            run,
            steps: result.steps.map((step) => ({
                pipeline_run_id: 9, step_no: step.stepNo, name: step.name, needs: JSON.stringify(step.needs),
                filepath: step.filepath, checksum: step.checksum, status: step.status, transaction_outcome: step.transactionOutcome,
                started_at: step.startedAt, finished_at: step.finishedAt, duration_ms: step.durationMs,
                error_message: 'private-step-error', skip_reason: '',
            })),
        });
        for (const historyDetail of [false, true]) {

            const history = render(<FocusProvider><RouterProvider initialRoute={historyDetail ? 'pipeline/history/detail' : 'pipeline/history'}>
                {historyDetail
                    ? <PipelineHistoryDetailScreen params={{ pipelineRunId: 9 }} />
                    : <PipelineHistoryScreen params={{ pipelineSlug: slug }} />}
            </RouterProvider></FocusProvider>);
            try {

                act(() => {

                    Object.defineProperty(history.stdout, 'columns', { configurable: true, value: 80 });
                    Object.defineProperty(history.stdout, 'rows', { configurable: true, value: 24 });
                    history.stdout.emit('resize');

                });
                await until(() => history.lastFrame()?.includes(historyDetail ? 'Execution status: failed' : '#30') === true);
                for (const _id of ids.slice(1)) await press(history, '\x1b[B');
                const frame = history.lastFrame() ?? '';
                expect(frame.split('\n').length + 4).toBeLessThanOrEqual(24);
                expect(frame).toContain('[Esc] Back');
                expect(frame).toContain(historyDetail ? '[Enter] Step details' : '[Enter] Run');
                for (const secret of ['private-history-error', 'private-active-key', 'private-step-error']) expect(frame).not.toContain(secret);
                if (historyDetail) {

                    await press(history, '\r');
                    const detail = stripVTControlCharacters(history.lastFrame() ?? '').replace(/[\s│]/g, '');
                    expect(detail).toContain(ids[29]!);
                    expect(detail).toContain(`Dependencies:${Array.from({ length: 29 }, (_, index) => index + 1).join(',')}`);
                    await press(history, '\x1b');

                }
                await press(history, 'd');
                expect(stripVTControlCharacters(history.lastFrame() ?? '').replace(/[\s│]/g, '')).toContain(slug);
                await press(history, '\x1b');
                if (historyDetail) {

                    for (let revisit = 0; revisit < 2; revisit++) {

                        expect(history.lastFrame()).toContain('30.');
                        await press(history, '\r');
                        expect(stripVTControlCharacters(history.lastFrame() ?? '').replace(/[\s│]/g, '')).toContain(ids[29]!);
                        await press(history, '\x1b');

                    }
                    await press(history, 'r');
                    await until(() => history.lastFrame()?.includes('Execution status: failed') === true);
                    await press(history, '\r');
                    expect(stripVTControlCharacters(history.lastFrame() ?? '').replace(/[\s│]/g, '')).toContain(ids[29]!);

                }

            }
            finally {

                history.unmount();

            }

        }

    });

    it('shows retained cleanup failure separately without changing committed execution evidence', async () => {

        await workflow();
        runOperation = async () => {

            cleanupFailed = true;

            return { dryRun: false, runId: 42, slug: 'workflow', mode: 'linear', transaction: 'none', concurrency: 1,
                singleRun: false, status: 'success', transactionOutcome: 'committed', startedAt: new Date(), finishedAt: new Date(),
                durationMs: 1, steps: [], primaryError: null, secondaryErrors: [] };

        };
        const view = render(<RunView />);
        try {

            await until(() => view.lastFrame()?.includes('No declared inputs') === true);
            await press(view, 'r');
            await press(view, 'y');
            await until(() => view.lastFrame()?.includes('Connection cleanup failed') === true);
            expect(view.lastFrame()).toContain('Execution status: success');
            expect(view.lastFrame()).toContain('Transaction outcome: committed');
            expect(view.lastFrame()).toContain('Run ID: 42');
            expect(view.lastFrame()).not.toContain('Transaction outcome: unknown');

        }
        finally {

            view.unmount();

        }

    });

    for (const kind of ['history', 'detail'] as const) {

        it(`shows loading rather than false absence for initial and changed ${kind} lookups`, async () => {

            const firstHistory = Promise.withResolvers<NoormPipelineRun[]>();
            const nextHistory = Promise.withResolvers<NoormPipelineRun[]>();
            const firstDetail = Promise.withResolvers<{ run: NoormPipelineRun; steps: NoormPipelineStep[] } | null>();
            const nextDetail = Promise.withResolvers<{ run: NoormPipelineRun; steps: NoormPipelineStep[] } | null>();
            historyOperation = () => firstHistory.promise;
            detailOperation = () => firstDetail.promise;
            const content = kind === 'history'
                ? <PipelineHistoryScreen params={{ pipelineSlug: 'a' }} />
                : <PipelineHistoryDetailScreen params={{ pipelineRunId: 1 }} />;
            const view = render(<FocusProvider><RouterProvider initialRoute={kind === 'history' ? 'pipeline/history' : 'pipeline/history/detail'}>{content}</RouterProvider></FocusProvider>);
            const absence = kind === 'history' ? 'No pipeline runs' : 'Run not found';
            const loading = kind === 'history' ? 'Loading pipeline history' : 'Loading pipeline run';
            try {

                await until(() => view.lastFrame()?.includes(loading) === true);
                expect(view.frames.some((frame) => frame.includes(absence))).toBe(false);
                await act(async () => {

                    firstHistory.resolve([]);
                    firstDetail.resolve(null);

                });
                await until(() => view.lastFrame()?.includes(absence) === true);
                await press(view, kind === 'history' ? 'h' : 'i');
                await press(view, '\r');
                await press(view, '\x7f');
                await press(view, kind === 'history' ? 'b' : '2');
                await press(view, '\r');
                await press(view, '\x1b[B');
                if (kind === 'history') await press(view, '\x1b[B');
                historyOperation = () => nextHistory.promise;
                detailOperation = () => nextDetail.promise;
                const frames = view.frames.length;
                await press(view, '\r');
                await until(() => view.lastFrame()?.includes(loading) === true);
                expect(view.frames.slice(frames).some((frame) => frame.includes(absence))).toBe(false);
                expect(kind === 'history' ? historyRequests.at(-1)?.slug : lookedUpIds.at(-1)).toBe(kind === 'history' ? 'b' : 2);
                await act(async () => {

                    nextHistory.resolve([]);
                    nextDetail.resolve(null);

                });
                await until(() => view.lastFrame()?.includes(absence) === true);

            }
            finally {

                view.unmount();

            }

        });

    }

});

const app = {
    projectRoot: '',
    settings: { paths: { pipelines: 'db/pipelines' } },
    activeConfigName: 'test',
    activeConfig: { name: 'test', access: withPolicy({ user: 'admin', agent: 'viewer' }), connection: { dialect: 'sqlite' } },
};
const modes = { dryRun: false, force: false };
let operationTarget = {};
let cleanupFailed = false;
let runOperation: () => Promise<PipelineDryRunResult | PipelineRunResult>;
let historyOperation: () => Promise<NoormPipelineRun[]>;
let detailOperation: () => Promise<{ run: NoormPipelineRun; steps: NoormPipelineStep[] } | null>;
const submittedInputs: (Record<string, PipelineJsonValue> | undefined)[] = [];
const lookedUpIds: number[] = [];
const historyRequests: { slug: string; limit?: number }[] = [];
mock.module('../../../../src/tui/app-context.js', () => ({
    ...actualAppContext,
    useAppContext: () => app,
    useGlobalModes: () => modes,
}));
mock.module('../../../../src/tui/hooks/usePipelineOperations.js', () => ({
    ...actualPipelineOperations,
    usePipelineOperations: () => ({
        cleanupFailed,
        target: operationTarget, connection: { loading: false, error: null, db: {}, dialect: 'sqlite' },
        running: false, pipelinesPath: '', run: (_slug: string, options: { input?: Record<string, PipelineJsonValue> }) => {

            submittedInputs.push(options.input);

            return runOperation();

        }, stop: () => {},
        history: (slug: string, limit?: number) => {

            historyRequests.push({ slug, limit });

            return historyOperation();

        }, getRun: (id: number) => {

            lookedUpIds.push(id);

            return detailOperation();

        },
    }),
}));

afterAll(() => {

    mock.module('../../../../src/tui/app-context.js', () => actualAppContext);
    mock.module('../../../../src/tui/hooks/usePipelineOperations.js', () => actualPipelineOperations);

});

async function until(predicate: () => boolean): Promise<void> {

    const deadline = Date.now() + 3000;
    while (!predicate() && Date.now() < deadline) await act(async () => {

        await setTimeout(5);

    });
    expect(predicate()).toBe(true);

}

async function press(view: { frames: string[]; stdin: { write: (input: string) => void } }, input: string): Promise<void> {

    const frames = view.frames.length;
    await act(async () => {

        const delivered = Promise.withResolvers<void>();
        inputDelivered = delivered.resolve;
        view.stdin.write(input);
        await delivered.promise;
        inputDelivered = undefined;

    });
    await until(() => view.frames.length > frames);

}

beforeEach(() => {

    previousActEnvironment = actEnvironment['IS_REACT_ACT_ENVIRONMENT'];
    actEnvironment['IS_REACT_ACT_ENVIRONMENT'] = true;

    operationTarget = {};
    cleanupFailed = false;
    app.activeConfigName = 'test';
    app.activeConfig.access.user = 'admin';
    modes.dryRun = false;
    modes.force = false;
    submittedInputs.length = 0;
    lookedUpIds.length = 0;
    historyRequests.length = 0;
    runOperation = async () => {

        throw new Error('No execution expected');

    };
    historyOperation = async () => [];
    detailOperation = async () => null;

});

async function workflow(inputs = '') {

    app.projectRoot = await fixture();
    const folder = join(app.projectRoot, 'db/pipelines/workflow');
    await mkdir(folder, { recursive: true });
    await writeFile(join(folder, 'pipeline.yml'), `${inputs}steps:\n  - id: first\n    sql: first.sql\n`);
    await writeFile(join(folder, 'first.sql'), 'select 1');

}

function RunView() {

    return <FocusProvider><RouterProvider initialRoute="pipeline/run" initialParams={{ pipelineSlug: 'workflow' }}>
        <PipelineRoutes />
    </RouterProvider></FocusProvider>;

}

function PipelineRoutes() {

    const { route, params } = useRouter();

    return route === 'pipeline/run'
        ? <PipelineRunScreen params={params} />
        : route === 'pipeline/history/detail'
            ? <PipelineHistoryDetailScreen params={params} />
            : <PipelineHistoryScreen params={params} />;

}

describe('pipeline screen keyboard behavior', () => {

    it('retains recorded step keys through lookup cancel and refresh with honest missing-row and target resets', async () => {

        const run: NoormPipelineRun = {
            id: 7, slug: 'workflow', config_name: 'test', executed_by: 'operator', cli_version: 'test',
            created_at: new Date(), manifest_checksum: 'checksum', transaction_policy: 'none', single_run: false,
            status: 'success', transaction_outcome: 'committed', started_at: new Date(), finished_at: new Date(),
            error_message: '', duration_ms: 1, active_key: null,
        };
        let numbers = [2, 5, 9];
        detailOperation = async () => ({
            run: { ...run, id: lookedUpIds.at(-1)! },
            steps: numbers.map((stepNo) => ({
                pipeline_run_id: run.id, step_no: stepNo, name: `recorded-${stepNo}`, needs: stepNo === 2 ? '[]' : '[2]',
                filepath: 'first.sql', checksum: 'checksum', status: 'success', transaction_outcome: 'committed',
                started_at: new Date(), finished_at: new Date(), duration_ms: 1, error_message: '', skip_reason: '',
            })),
        });
        const content = () => <FocusProvider><RouterProvider initialRoute="pipeline/history/detail">
            <PipelineHistoryDetailScreen params={{ pipelineRunId: 7 }} />
        </RouterProvider></FocusProvider>;
        const view = render(content());
        try {

            await until(() => view.lastFrame()?.includes('recorded-2') === true);
            await press(view, '\x1b[B');
            await press(view, '\x1b[B');
            await press(view, 'i');
            await press(view, '\x1b');
            await until(() => view.lastFrame()?.includes('recorded-9') === true);
            await press(view, '\r');
            expect(view.lastFrame()).toContain('Step 9: recorded-9');
            await press(view, '\x1b');
            numbers = [2, 9];
            await press(view, 'r');
            await until(() => view.lastFrame()?.includes('recorded-9') === true);
            await press(view, '\r');
            expect(view.lastFrame()).toContain('Step 9: recorded-9');
            await press(view, '\x1b');
            numbers = [2, 5];
            await press(view, 'r');
            await until(() => view.lastFrame()?.includes('recorded-5') === true);
            await press(view, '\r');
            expect(view.lastFrame()).toContain('Step 2: recorded-2');
            await press(view, '\x1b');
            await press(view, '\x1b[B');
            operationTarget = {};
            view.rerender(content());
            await until(() => view.lastFrame()?.includes('recorded-5') === true);
            await press(view, '\r');
            expect(view.lastFrame()).toContain('Step 2: recorded-2');
            await press(view, '\x1b');
            await press(view, '\x1b[B');
            await press(view, 'i');
            await press(view, '\r');
            await press(view, '\x7f');
            await press(view, '8');
            await press(view, '\r');
            await press(view, '\x1b[B');
            await press(view, '\r');
            await until(() => view.lastFrame()?.includes('Run ID: 8') === true);
            await press(view, '\r');
            expect(view.lastFrame()).toContain('Step 2: recorded-2');

        }
        finally {

            view.unmount();

        }

    });

    it('retains history run cursor through metadata, refresh and real route Back', async () => {

        const run: NoormPipelineRun = {
            id: 1, slug: 'workflow', config_name: 'test', executed_by: 'operator', cli_version: 'test',
            created_at: new Date(), manifest_checksum: 'checksum', transaction_policy: 'none', single_run: false,
            status: 'success', transaction_outcome: 'committed', started_at: new Date(), finished_at: new Date(),
            error_message: '', duration_ms: 1, active_key: null,
        };
        historyOperation = async () => [3, 2, 1].map((id) => ({ ...run, id }));
        detailOperation = async () => ({ run: { ...run, id: lookedUpIds.at(-1)! }, steps: [] });
        const view = render(<FocusProvider><RouterProvider initialRoute="pipeline/history" initialParams={{ pipelineSlug: 'workflow' }}>
            <PipelineRoutes />
        </RouterProvider></FocusProvider>);
        try {

            await until(() => view.lastFrame()?.includes('#3') === true);
            await press(view, '\x1b[B');
            await press(view, 'd');
            await press(view, '\x1b');
            await press(view, '\r');
            await until(() => view.lastFrame()?.includes('Run ID: 2') === true);
            expect(lookedUpIds.at(-1)).toBe(2);
            await press(view, '\x1b');
            await until(() => view.lastFrame()?.includes('#3') === true);
            await press(view, '\r');
            await until(() => view.lastFrame()?.includes('Run ID: 2') === true);
            await press(view, '\x1b');
            await until(() => view.lastFrame()?.includes('#3') === true);
            await press(view, 'r');
            await until(() => view.lastFrame()?.includes('#3') === true);
            await press(view, '\r');
            await until(() => view.lastFrame()?.includes('Run ID: 2') === true);
            await press(view, '\x1b');
            await until(() => view.lastFrame()?.includes('#3') === true);
            historyOperation = async () => [{ ...run, id: 3 }, run];
            await press(view, 'r');
            await until(() => view.lastFrame()?.includes('#3') === true);
            await press(view, '\r');
            await until(() => view.lastFrame()?.includes('Run ID: 3') === true);
            await press(view, '\x1b');
            await until(() => view.lastFrame()?.includes('#3') === true);
            await press(view, '\x1b[B');
            operationTarget = {};
            view.rerender(<FocusProvider><RouterProvider initialRoute="pipeline/history" initialParams={{ pipelineSlug: 'workflow' }}>
                <PipelineRoutes />
            </RouterProvider></FocusProvider>);
            await until(() => view.lastFrame()?.includes('#3') === true);
            await press(view, '\r');
            await until(() => view.lastFrame()?.includes('Run ID: 3') === true);

        }
        finally {

            view.unmount();

        }

    });

    it('retains dry-run step details across overlays and resets a new invocation after route Back', async () => {

        await workflow();
        const steps = [1, 2, 3].map((stepNo) => ({
            stepNo, name: `dry-step-${stepNo}`, needs: stepNo === 1 ? [] : [stepNo - 1],
            filepath: 'first.sql', checksum: 'checksum',
        }));
        modes.dryRun = true;
        runOperation = async () => ({
            dryRun: true, runId: null, slug: 'workflow', mode: 'linear', transaction: 'none',
            concurrency: 1, singleRun: false, status: 'success', transactionOutcome: 'no_effects', steps,
        });
        const view = render(<FocusProvider><RouterProvider initialRoute="pipeline/run" initialParams={{ pipelineSlug: 'workflow' }}>
            <PipelineRoutes />
        </RouterProvider></FocusProvider>);
        try {

            await until(() => view.lastFrame()?.includes('No declared inputs') === true);
            await press(view, 'r');
            await press(view, 'y');
            await until(() => view.lastFrame()?.includes('Execution status: success') === true);
            await press(view, '\x1b[B');
            await press(view, '\x1b[B');
            for (let revisit = 0; revisit < 2; revisit++) {

                await press(view, '\r');
                expect(view.lastFrame()).toContain('Step 3: dry-step-3');
                expect(view.lastFrame()).toContain('Dependencies: 2');
                await press(view, '\x1b');
                expect(view.lastFrame()).toContain('Dependencies: 2');
                await press(view, 'd');
                await press(view, '\x1b');

            }
            await press(view, '\r');
            expect(view.lastFrame()).toContain('Step 3: dry-step-3');
            await press(view, '\x1b');
            await press(view, 'h');
            await until(() => view.lastFrame()?.includes('No pipeline runs in this configuration') === true);
            await press(view, '\x1b');
            await until(() => view.lastFrame()?.includes('No declared inputs') === true);
            await press(view, 'r');
            await press(view, 'y');
            await until(() => view.lastFrame()?.includes('Execution status: success') === true);
            await press(view, '\r');
            expect(view.lastFrame()).toContain('Step 1: dry-step-1');

        }
        finally {

            view.unmount();

        }

    });

    it.each([
        ['pipeline source', false], ['operation target', false],
        ['pipeline source', true], ['operation target', true],
    ] as const)('resets review cursor when the %s changes (returned from history: %s)', async (scope, viaBack) => {

        await workflow();
        const manifest = 'steps:\n  - id: first\n    sql: first.sql\n  - id: second\n    sql: first.sql\n';
        await writeFile(join(app.projectRoot, 'db/pipelines/workflow/pipeline.yml'), manifest);
        const view = render(<RunView />);
        try {

            await until(() => view.lastFrame()?.includes('No declared inputs') === true);
            await press(view, 's');
            await press(view, '\x1b[B');
            await press(view, '\r');
            expect(view.lastFrame()).toContain('Step 2: second');
            await press(view, '\x1b');
            if (viaBack) {

                await press(view, 'h');
                await until(() => view.lastFrame()?.includes('No pipeline runs in this configuration') === true);
                await press(view, '\x1b');
                await until(() => view.lastFrame()?.includes('No declared inputs') === true);
                await press(view, 's');
                await press(view, '\r');
                expect(view.lastFrame()).toContain('Step 2: second');
                await press(view, '\x1b');

            }
            if (scope === 'pipeline source') {

                await workflow();
                await writeFile(join(app.projectRoot, 'db/pipelines/workflow/pipeline.yml'), manifest);

            }
            else operationTarget = {};
            view.rerender(<RunView />);
            await until(() => view.lastFrame()?.includes('Steps in declaration order') === true);
            await press(view, '\r');
            expect(view.lastFrame()).toContain('Step 1: first');

        }
        finally {

            view.unmount();

        }

    });

    it('keeps input presence unchanged on open/cancel and removes only a saved override on reset', async () => {

        await workflow('inputs:\n  enabled:\n    type: boolean\n    description: Enable workflow\n    required: true\n');
        const view = render(<RunView />);
        try {

            await until(() => view.lastFrame()?.includes('enabled · boolean · Unset') === true);
            await press(view, 'r');
            expect(view.lastFrame()).toContain('Missing required pipeline inputs: enabled');
            await press(view, '\r');
            expect(view.lastFrame()).toContain('Pipeline input: enabled');
            await press(view, '\x1b');
            expect(view.lastFrame()).toContain('enabled · boolean · Unset');
            await press(view, '\r');
            await press(view, '\x1b[B');
            await press(view, '\r');
            expect(view.lastFrame()).toContain('enabled · boolean · Supplied');
            await press(view, 'x');
            expect(view.lastFrame()).toContain('enabled · boolean · Unset');

        }
        finally {

            view.unmount();

        }

    });

    it('denies execution under pipeline:run policy even in dry run and force mode', async () => {

        await workflow();
        app.activeConfig.access.user = 'viewer';
        modes.dryRun = true;
        modes.force = true;
        const view = render(<RunView />);
        await until(() => view.lastFrame()?.includes('No declared inputs') === true);
        await press(view, 'r');
        await until(() => view.lastFrame()?.includes('not allowed by the active configuration policy') === true);
        expect(view.lastFrame()).not.toContain('Confirm');
        view.unmount();

    });

    it('runs under a custom role that allows pipeline:run and denies run:dir', async () => {

        await workflow();
        const permissions = { 'pipeline:run': 'allow', 'run:dir': 'deny' } as const;
        withPolicy(app.activeConfig.access, { roles: { pipeliner: { permissions } } });
        app.activeConfig.access.user = 'pipeliner';
        const view = render(<RunView />);
        try {

            await until(() => view.lastFrame()?.includes('No declared inputs') === true);
            await press(view, 'r');
            await until(() => view.lastFrame()?.includes('Run workflow on test?') === true);
            expect(view.lastFrame()).not.toContain('not allowed by the active configuration policy');

        }
        finally {

            withPolicy(app.activeConfig.access);
            view.unmount();

        }

    });

    it('requests the native protected phrase before starting an operator run', async () => {

        await workflow();
        app.activeConfig.access.user = 'operator';
        const previous = process.env['NOORM_YES'];
        process.env['NOORM_YES'] = 'false';
        const view = render(<RunView />);
        try {

            await until(() => view.lastFrame()?.includes('No declared inputs') === true);
            await press(view, 'r');
            await until(() => view.lastFrame()?.includes('yes-test') === true);
            await press(view, '\x1b');
            await until(() => view.lastFrame()?.includes('No declared inputs') === true);

        }
        finally {

            if (previous === undefined) delete process.env['NOORM_YES'];
            else process.env['NOORM_YES'] = previous;
            view.unmount();

        }

    });

    it('rejects confirmation after target identity changes', async () => {

        await workflow();
        const view = render(<RunView />);
        await until(() => view.lastFrame()?.includes('No declared inputs') === true);
        await press(view, 'r');
        await until(() => view.lastFrame()?.includes('Run workflow on test?') === true);
        operationTarget = {};
        view.rerender(<RunView />);
        await until(() => view.lastFrame()?.includes('Target changed. Review and confirm again.') === true);
        expect(view.lastFrame()).not.toContain('Run workflow on test?');
        view.unmount();

    });

    it('keeps captured mode and stays busy after stop until actual unknown result settlement', async () => {

        await workflow();
        const gate = Promise.withResolvers<PipelineRunResult>();
        runOperation = () => gate.promise;
        const view = render(<RunView />);
        await until(() => view.lastFrame()?.includes('No declared inputs') === true);
        await press(view, 'r');
        await until(() => view.lastFrame()?.includes('Run workflow on test?') === true);
        modes.dryRun = true;
        view.rerender(<RunView />);
        await press(view, 'y');
        await until(() => view.lastFrame()?.includes('Running on test') === true);
        await press(view, '\x1b');
        await until(() => (view.lastFrame() ?? '').replace(/\s+/g, ' ').includes('Stop requested. Waiting for running SQL and transaction cleanup to finish.'));
        expect(view.lastFrame()).not.toContain('Return to review');
        await act(async () => {

            gate.resolve({ dryRun: false, runId: 7, slug: 'workflow', mode: 'linear', transaction: 'none', concurrency: 1,
                singleRun: false, status: 'success', transactionOutcome: 'unknown', startedAt: new Date(), finishedAt: new Date(),
                durationMs: 1, steps: [], primaryError: { phase: 'cleanup', message: 'private-error' }, secondaryErrors: [] });

        });
        await until(() => view.lastFrame()?.includes('Not a confirmed clean success.') === true);
        expect(view.lastFrame()).toContain('Execution status: success');
        expect(view.lastFrame()).toContain('Transaction outcome: unknown');
        expect(view.lastFrame()).not.toContain('private-error');
        view.unmount();

    });

    it('keeps invalid definitions visible in the native list', async () => {

        await workflow('inputs: [private-manifest-value\n');
        const view = render(<FocusProvider><RouterProvider initialRoute="pipeline"><PipelineListScreen params={{}} /></RouterProvider></FocusProvider>);
        await until(() => view.lastFrame()?.includes('Invalid definition') === true);
        expect(view.lastFrame()).toContain('workflow');
        expect(view.lastFrame()).not.toContain('private-manifest-value');
        view.unmount();

    });

    it('should show the failed rule for an invalid manifest without any manifest value', async () => {

        await workflow('inputs: [private-manifest-value\n');
        const view = render(<FocusProvider><RouterProvider initialRoute="pipeline"><PipelineListScreen params={{}} /></RouterProvider></FocusProvider>);
        await until(() => view.lastFrame()?.includes('Invalid definition') === true);
        expect(view.lastFrame()).toContain('Invalid definition (yaml)');
        expect(view.lastFrame()).not.toContain('private-manifest-value');
        view.unmount();

    });

    it('should show the failed rule when the run screen cannot load the definition', async () => {

        await workflow('inputs: [private-manifest-value\n');
        const view = render(<RunView />);
        await until(() => view.lastFrame()?.includes('Invalid definition (yaml)') === true);
        expect(view.lastFrame()).not.toContain('private-manifest-value');
        view.unmount();

    });

    it('should name the rule and omit the history hint for a run refused before admission', async () => {

        await workflow();
        runOperation = async () => {

            throw invalidDefinition('transaction-control', 'private-refusal-text');

        };
        const view = render(<RunView />);
        await until(() => view.lastFrame()?.includes('No declared inputs') === true);
        await press(view, 'r');
        await until(() => view.lastFrame()?.includes('Run workflow on test?') === true);
        await press(view, 'y');
        await until(() => view.lastFrame()?.includes('Invalid definition (transaction-control)') === true);
        expect(view.lastFrame()).not.toContain('Inspect scoped history');
        expect(view.lastFrame()).not.toContain('private-refusal-text');
        view.unmount();

    });

    it('should point to scoped history for a run that fails after admission', async () => {

        await workflow();
        runOperation = async () => {

            throw new Error('private-driver-text');

        };
        const view = render(<RunView />);
        await until(() => view.lastFrame()?.includes('No declared inputs') === true);
        await press(view, 'r');
        await until(() => view.lastFrame()?.includes('Run workflow on test?') === true);
        await press(view, 'y');
        await until(() => view.lastFrame()?.includes('Inspect scoped history') === true);
        expect(view.lastFrame()).not.toContain('private-driver-text');
        view.unmount();

    });

    it('looks up scoped history with the default limit without a local definition', async () => {

        app.projectRoot = await fixture();
        const view = render(<FocusProvider><RouterProvider initialRoute="pipeline/history"><PipelineHistoryScreen params={{}} /></RouterProvider></FocusProvider>);
        try {

            await until(() => view.lastFrame()?.includes('Pipeline slug') === true);
            await press(view, '\r');
            await press(view, 'removed-definition');
            await press(view, '\r');
            await press(view, '\x1b[B');
            await press(view, '\x1b[B');
            await press(view, '\r');
            await until(() => view.lastFrame()?.includes('No pipeline runs in this configuration') === true);
            expect(historyRequests).toEqual([{ slug: 'removed-definition', limit: 20 }]);

        }
        finally {

            view.unmount();

        }

    });

    it('discards a delayed old-config history response and orders the current runs newest first', async () => {

        app.projectRoot = await fixture();
        const row = (id: number): NoormPipelineRun => ({
            id, slug: 'removed-definition', config_name: app.activeConfigName, executed_by: 'operator', cli_version: 'test',
            created_at: new Date(), manifest_checksum: 'checksum', transaction_policy: 'step', single_run: false,
            status: 'success', transaction_outcome: 'committed', started_at: new Date(), finished_at: new Date(),
            error_message: 'private-history-error', duration_ms: 1, active_key: 'private-active-key',
        });
        const oldRead = Promise.withResolvers<NoormPipelineRun[]>();
        const newRead = Promise.withResolvers<NoormPipelineRun[]>();
        historyOperation = () => oldRead.promise;
        const content = <FocusProvider><RouterProvider initialRoute="pipeline/history"><PipelineHistoryScreen params={{ pipelineSlug: 'removed-definition' }} /></RouterProvider></FocusProvider>;
        const view = render(content);
        await until(() => view.lastFrame()?.includes('Loading pipeline history') === true);
        operationTarget = {};
        app.activeConfigName = 'replacement';
        historyOperation = () => newRead.promise;
        view.rerender(<FocusProvider><RouterProvider initialRoute="pipeline/history"><PipelineHistoryScreen params={{ pipelineSlug: 'removed-definition' }} /></RouterProvider></FocusProvider>);
        await act(async () => {

            newRead.resolve([row(20), row(21)]);

        });
        await until(() => view.lastFrame()?.includes('#21') === true);
        await act(async () => {

            oldRead.resolve([row(99)]);

        });
        const frame = view.lastFrame() ?? '';
        expect(frame).not.toContain('#99');
        expect(frame.indexOf('#21')).toBeLessThan(frame.indexOf('#20'));
        expect(frame).not.toContain('private-history-error');
        expect(frame).not.toContain('private-active-key');
        view.unmount();

    });

    for (const unsafeId of ['0', '-1', '1.5', '9007199254740992']) {

        it(`rejects run ID ${unsafeId} before lookup and permits a corrected safe ID`, async () => {

            app.projectRoot = await fixture();
            const view = render(<FocusProvider><RouterProvider initialRoute="pipeline/history/detail"><PipelineHistoryDetailScreen params={{}} /></RouterProvider></FocusProvider>);
            try {

                await until(() => view.lastFrame()?.includes('Run ID') === true);
                await press(view, '\r');
                await press(view, unsafeId);
                await press(view, '\r');
                await press(view, '\x1b[B');
                await press(view, '\r');
                await until(() => view.lastFrame()?.includes('positive safe whole-number run ID') === true);
                expect(lookedUpIds).toEqual([]);
                await press(view, '\r');
                for (const _character of unsafeId) await press(view, '\x7f');
                await press(view, '42');
                await press(view, '\r');
                await press(view, '\x1b[B');
                await press(view, '\r');
                await until(() => view.lastFrame()?.includes('Run not found in this configuration') === true);
                expect(lookedUpIds).toEqual([42]);

            }
            finally {

                view.unmount();

            }

        });

    }

    it('resets a saved default to absence without exposing input values outside the editor', async () => {

        await workflow('inputs:\n  note:\n    type: string\n    description: Operator note\n    default: private-default-value\n');
        runOperation = async () => ({
            dryRun: false, runId: 8, slug: 'workflow', mode: 'linear', transaction: 'none', concurrency: 1,
            singleRun: false, status: 'success', transactionOutcome: 'committed', startedAt: new Date(), finishedAt: new Date(),
            durationMs: 1, steps: [], primaryError: null, secondaryErrors: [],
        });
        const view = render(<RunView />);
        try {

            await until(() => view.lastFrame()?.includes('note · string · Default') === true);
            expect(view.lastFrame()).not.toContain('private-default-value');
            await press(view, '\r');
            await until(() => view.lastFrame()?.includes('Pipeline input: note') === true);
            await press(view, '\x1b[B');
            await press(view, '\r');
            await until(() => view.lastFrame()?.includes('note · string · Supplied') === true);
            expect(view.lastFrame()).not.toContain('private-default-value');
            await press(view, 'r');
            expect(view.lastFrame()).not.toContain('private-default-value');
            await press(view, 'y');
            await until(() => view.lastFrame()?.includes('Execution status: success') === true);
            expect(submittedInputs).toEqual([{ note: 'private-default-value' }]);
            expect(view.lastFrame()).not.toContain('private-default-value');
            await press(view, 'r');
            await press(view, 'x');
            await until(() => view.lastFrame()?.includes('note · string · Default') === true);
            expect(view.lastFrame()).not.toContain('private-default-value');
            await press(view, 'r');
            expect(view.lastFrame()).not.toContain('private-default-value');
            await press(view, 'y');
            await until(() => view.lastFrame()?.includes('Execution status: success') === true);
            expect(submittedInputs).toEqual([{ note: 'private-default-value' }, {}]);
            expect(view.lastFrame()).not.toContain('private-default-value');

        }
        finally {

            view.unmount();

        }

    });

    it('scrolls to the last input, saves its edit and invokes the visible run action', async () => {

        const names = Array.from({ length: 30 }, (_, index) => `field${String(index).padStart(2, '0')}`);
        await workflow(`inputs:\n${names.map((name) => `  ${name}:\n    type: string\n    description: Description for ${name}\n`).join('')}`);
        runOperation = async () => ({
            dryRun: false, runId: 9, slug: 'workflow', mode: 'linear', transaction: 'none', concurrency: 1,
            singleRun: false, status: 'success', transactionOutcome: 'committed', startedAt: new Date(), finishedAt: new Date(),
            durationMs: 1, steps: [], primaryError: null, secondaryErrors: [],
        });
        const view = render(<RunView />);
        try {

            await until(() => view.lastFrame()?.includes('Description for field00') === true);
            for (const name of names.slice(1)) {

                await press(view, '\x1b[B');
                await until(() => view.lastFrame()?.includes(`Description for ${name}`) === true);

            }
            expect(view.lastFrame()).toContain('[r] Run');
            expect(view.lastFrame()).toContain('[Esc] Back');
            expect(view.lastFrame()).not.toContain('field00');
            await press(view, '\r');
            await until(() => view.lastFrame()?.includes('Pipeline input: field29') === true);
            await press(view, '\r');
            await press(view, 'private-last-input');
            await press(view, '\r');
            await press(view, '\x1b[B');
            await press(view, '\r');
            await until(() => view.lastFrame()?.includes('field29 · string · Supplied') === true);
            expect(view.lastFrame()).not.toContain('private-last-input');
            expect(view.lastFrame()).toContain('[r] Run');
            await press(view, 'r');
            expect(view.lastFrame()).not.toContain('private-last-input');
            await press(view, 'y');
            await until(() => view.lastFrame()?.includes('Execution status: success') === true);
            expect(submittedInputs).toEqual([{ field29: 'private-last-input' }]);
            expect(view.lastFrame()).not.toContain('private-last-input');

        }
        finally {

            view.unmount();

        }

    });

});
