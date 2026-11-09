import { describe, expect, it } from 'bun:test';
import {
    getPipelineConcurrency,
    schedulePipelineSteps,
} from '../../../src/core/pipeline/scheduler.js';
import type { PipelineScheduleNode } from '../../../src/core/pipeline/scheduler.js';

function barrier() {

    let release!: () => void;
    const promise = new Promise<void>((resolve) => {

        release = resolve;

    });

    return { promise, release };

}

const node = (stepNo: number, needs: number[] = []): PipelineScheduleNode => ({ stepNo, needs });

describe('pipeline: concurrency', () => {

    it('should cap graph execution by the configured pool and use the default pool size', () => {

        const graph = { mode: 'graph', transaction: 'step', concurrency: 20 } as const;
        expect(getPipelineConcurrency(graph, 'postgres', 3)).toBe(3);
        expect(getPipelineConcurrency(graph, 'mysql')).toBe(10);
        expect(getPipelineConcurrency({ ...graph, concurrency: 2 }, 'mssql', 8)).toBe(2);
        expect(getPipelineConcurrency(graph, 'postgres', 0)).toBe(1);

    });

    it('should serialize linear, pipeline transaction, and SQLite execution', () => {

        const graph = { mode: 'graph', transaction: 'step', concurrency: 8 } as const;
        expect(getPipelineConcurrency({ ...graph, mode: 'linear' }, 'postgres', 8)).toBe(1);
        expect(getPipelineConcurrency({ ...graph, transaction: 'pipeline' }, 'mysql', 8)).toBe(1);
        expect(getPipelineConcurrency(graph, 'sqlite', 8)).toBe(1);
        expect(getPipelineConcurrency({ ...graph, transaction: 'none' }, 'postgres', 8)).toBe(8);

    });

});

describe('pipeline: scheduler', () => {

    it('should run branches within the limit and admit a join only after both dependencies finish', async () => {

        const releases = [barrier(), barrier(), barrier(), barrier()];
        const started = [barrier(), barrier(), barrier(), barrier()];
        const events: string[] = [];
        let active = 0;
        let maxActive = 0;
        const run = schedulePipelineSteps([node(1), node(2, [1]), node(3, [1]), node(4, [2, 3])], 2, async ({ stepNo }) => {

            active++;
            maxActive = Math.max(maxActive, active);
            events.push(`start${stepNo}`);
            started[stepNo - 1]!.release();
            await releases[stepNo - 1]!.promise;
            events.push(`finish${stepNo}`);
            active--;

            return true;

        });
        await started[0]!.promise;
        expect(events).toEqual(['start1']);
        releases[0]!.release();
        await Promise.all([started[1]!.promise, started[2]!.promise]);
        expect(events).toEqual(['start1', 'finish1', 'start2', 'start3']);
        releases[2]!.release();
        releases[1]!.release();
        await started[3]!.promise;
        expect(events.indexOf('start4')).toBeGreaterThan(events.indexOf('finish2'));
        expect(events.indexOf('start4')).toBeGreaterThan(events.indexOf('finish3'));
        releases[3]!.release();
        expect(await run).toEqual({ failed: false, interrupted: false });
        expect(maxActive).toBe(2);
        expect(active).toBe(0);

    });

    it('should recompute the lowest eligible declaration after every completion', async () => {

        const order: number[] = [];
        const result = await schedulePipelineSteps([node(1, [2]), node(2), node(3)], 1, async ({ stepNo }) => {

            order.push(stepNo);

            return true;

        });
        expect(order).toEqual([2, 1, 3]);
        expect(result).toEqual({ failed: false, interrupted: false });

    });

    it('should allow an independent ready branch to progress while another branch is blocked', async () => {

        const blocked = barrier();
        const branchStarted = barrier();
        const otherFinished = barrier();
        const starts: number[] = [];
        const run = schedulePipelineSteps([node(1), node(2), node(3, [2])], 2, async ({ stepNo }) => {

            starts.push(stepNo);
            if (stepNo === 1) {

                branchStarted.release();
                await blocked.promise;

            }
            if (stepNo === 3) otherFinished.release();

            return true;

        });
        await Promise.all([branchStarted.promise, otherFinished.promise]);
        expect(starts).toEqual([1, 2, 3]);
        blocked.release();
        expect(await run).toEqual({ failed: false, interrupted: false });

    });

    it('should stop immediately on reported failure and wait for cleanup and other in-flight work', async () => {

        const cleanup = barrier();
        const peer = barrier();
        const failureReported = barrier();
        const peerStarted = barrier();
        const peerFinished = barrier();
        const starts: number[] = [];
        let settled = false;
        const run = schedulePipelineSteps([node(1), node(2), node(3, [2])], 2, async ({ stepNo }, control) => {

            starts.push(stepNo);
            if (stepNo === 1) {

                await peerStarted.promise;
                control.stop();
                failureReported.release();
                await cleanup.promise;

                return false;

            }
            if (stepNo === 2) {

                peerStarted.release();
                await peer.promise;
                peerFinished.release();

            }

            return true;

        });
        void run.then(() => {

            settled = true;

        });
        await failureReported.promise;
        peer.release();
        await peerFinished.promise;
        expect(starts).toEqual([1, 2]);
        expect(settled).toBe(false);
        cleanup.release();
        expect(await run).toEqual({ failed: true, interrupted: false });
        expect(starts).toEqual([1, 2]);

    });

    it('should stop on a false result and settle already started work', async () => {

        const peerStarted = barrier();
        const peer = barrier();
        const failed = barrier();
        const starts: number[] = [];
        let settled = false;
        const run = schedulePipelineSteps([node(1), node(2), node(3, [1])], 2, async ({ stepNo }) => {

            starts.push(stepNo);
            if (stepNo === 1) {

                await peerStarted.promise;
                failed.release();

                return false;

            }
            if (stepNo === 2) {

                peerStarted.release();
                await peer.promise;

            }

            return true;

        });
        void run.then(() => {

            settled = true;

        });
        await failed.promise;
        expect(settled).toBe(false);
        peer.release();
        expect(await run).toEqual({ failed: true, interrupted: false });
        expect(starts).toEqual([1, 2]);

    });

    it('should keep a synchronous stop primary when abort occurs before dispatch returns', async () => {

        const controller = new AbortController();
        const peer = barrier();
        const failedCleanup = barrier();
        const starts: number[] = [];
        let settled = false;
        const run = schedulePipelineSteps([node(1), node(2), node(3)], 2, async ({ stepNo }, control) => {

            starts.push(stepNo);
            if (stepNo === 1) await peer.promise;
            else {

                control.stop();
                controller.abort();
                await failedCleanup.promise;

                return false;

            }

            return true;

        }, controller.signal);
        void run.then(() => {

            settled = true;

        });
        peer.release();
        await peer.promise;
        expect(settled).toBe(false);
        failedCleanup.release();
        expect(await run).toEqual({ failed: true, interrupted: false });
        expect(starts).toEqual([1, 2]);

    });

    it('should keep a false completion primary when abort arrives while another callback settles', async () => {

        const controller = new AbortController();
        const peer = barrier();
        const starts: number[] = [];
        let settled = false;
        const run = schedulePipelineSteps([node(1), node(2), node(3)], 2, async ({ stepNo }) => {

            starts.push(stepNo);
            if (stepNo === 1) return false;
            await peer.promise;

            return true;

        }, controller.signal);
        void run.then(() => {

            settled = true;

        });
        // Let the scheduler observe the false result before the later abort.
        const turn = barrier();
        setImmediate(turn.release);
        await turn.promise;
        controller.abort();
        expect(settled).toBe(false);
        peer.release();
        expect(await run).toEqual({ failed: true, interrupted: false });
        expect(starts).toEqual([1, 2]);

    });

    it('should reject the original thrown error only after all started work settles', async () => {

        const peerStarted = barrier();
        const peer = barrier();
        const throwing = barrier();
        const error = new Error('step failure');
        const starts: number[] = [];
        let settled = false;
        const run = schedulePipelineSteps([node(1), node(2), node(3, [1])], 2, async ({ stepNo }) => {

            starts.push(stepNo);
            if (stepNo === 1) {

                await peerStarted.promise;
                throwing.release();
                throw error;

            }
            if (stepNo === 2) {

                peerStarted.release();
                await peer.promise;

            }

            return true;

        });
        const observed = run.then(
            () => {

                settled = true;

                return null;

            },
            (reason: unknown) => {

                settled = true;

                return reason;

            },
        );
        await throwing.promise;
        expect(settled).toBe(false);
        peer.release();
        expect(await observed).toBe(error);
        expect(starts).toEqual([1, 2]);

    });

    it('should not start work for a pre-aborted signal', async () => {

        const controller = new AbortController();
        controller.abort();
        const starts: number[] = [];
        const result = await schedulePipelineSteps([node(1)], 1, async ({ stepNo }) => {

            starts.push(stepNo);

            return true;

        }, controller.signal);
        expect(starts).toEqual([]);
        expect(result).toEqual({ failed: false, interrupted: true });

    });

    it('should stop dispatch on abort without cancelling active callbacks and wait for them', async () => {

        const controller = new AbortController();
        const firstStarted = barrier();
        const secondStarted = barrier();
        const first = barrier();
        const second = barrier();
        const firstFinished = barrier();
        const starts: number[] = [];
        const finishes: number[] = [];
        let settled = false;
        const run = schedulePipelineSteps([node(1), node(2), node(3, [1])], 2, async ({ stepNo }) => {

            starts.push(stepNo);
            if (stepNo === 1) {

                firstStarted.release();
                await first.promise;
                finishes.push(stepNo);
                firstFinished.release();

            }
            else if (stepNo === 2) {

                secondStarted.release();
                await second.promise;
                finishes.push(stepNo);

            }

            return true;

        }, controller.signal);
        void run.then(() => {

            settled = true;

        });
        await Promise.all([firstStarted.promise, secondStarted.promise]);
        controller.abort();
        first.release();
        await firstFinished.promise;
        expect(starts).toEqual([1, 2]);
        expect(finishes).toEqual([1]);
        expect(settled).toBe(false);
        second.release();
        expect(await run).toEqual({ failed: false, interrupted: true });
        expect(finishes).toEqual([1, 2]);
        expect(starts).toEqual([1, 2]);

    });

    it('should not report interruption when abort arrives after all work is admitted', async () => {

        const controller = new AbortController();
        const firstStarted = barrier();
        const secondStarted = barrier();
        const finish = barrier();
        const finishes: number[] = [];
        const run = schedulePipelineSteps([node(1), node(2)], 2, async ({ stepNo }) => {

            if (stepNo === 1) firstStarted.release();
            else secondStarted.release();
            await finish.promise;
            finishes.push(stepNo);

            return true;

        }, controller.signal);
        await Promise.all([firstStarted.promise, secondStarted.promise]);
        controller.abort();
        finish.release();
        expect(await run).toEqual({ failed: false, interrupted: false });
        expect(finishes).toEqual([1, 2]);

    });

    it('should not retroactively interrupt completed work on a late abort', async () => {

        const controller = new AbortController();
        const starts: number[] = [];
        const run = schedulePipelineSteps([node(1), node(2, [1])], 1, async ({ stepNo }) => {

            starts.push(stepNo);

            return true;

        }, controller.signal);
        const result = await run;
        controller.abort();
        expect(result).toEqual({ failed: false, interrupted: false });
        expect(starts).toEqual([1, 2]);

    });

});
