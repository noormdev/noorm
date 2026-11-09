import { attemptSync } from '@logosdx/utils';

import type { Dialect } from '../connection/types.js';
import type { PreparedPipeline } from './types.js';

/** A step as the scheduler sees it: its 1-based number and the step numbers it waits for. */
export interface PipelineScheduleNode {
    readonly stepNo: number;
    readonly needs: readonly number[];
}

/** Resolves how many steps may run at once; one connection serves linear, single-transaction and SQLite runs. */
export function getPipelineConcurrency(
    plan: Pick<PreparedPipeline, 'mode' | 'transaction' | 'concurrency'>, dialect: Dialect, poolMax?: number,
): number {

    if (plan.mode === 'linear' || plan.transaction === 'pipeline' || dialect === 'sqlite') return 1;

    return Math.max(1, Math.min(plan.concurrency, poolMax ?? 10));

}

/** Schedule validated nodes, settling every admitted callback before returning or rejecting. */
export function schedulePipelineSteps(
    nodes: readonly PipelineScheduleNode[], concurrency: number,
    execute: (node: PipelineScheduleNode, control: { stop(): void }) => Promise<boolean>, signal?: AbortSignal,
): Promise<{ failed: boolean; interrupted: boolean }> {

    const byNumber = new Map(nodes.map((node, index) => [node.stepNo, index]));
    const pending = nodes.map((node) => node.needs.length);
    const dependents: number[][] = nodes.map(() => []);
    for (let index = 0; index < nodes.length; index++) {

        for (const dependency of nodes[index]!.needs) dependents[byNumber.get(dependency)!]!.push(index);

    }
    // A min-heap of declaration numbers makes admission dynamic without rescanning the graph.
    const ready: number[] = [];
    const push = (index: number) => {

        let position = ready.length;
        ready.push(index);
        while (position > 0) {

            const parent = (position - 1) >> 1;
            if (nodes[ready[parent]!]!.stepNo <= nodes[index]!.stepNo) break;
            ready[position] = ready[parent]!;
            position = parent;

        }
        ready[position] = index;

    };
    const pop = (): number => {

        const first = ready[0]!;
        const last = ready.pop()!;
        if (ready.length) {

            let position = 0;
            while (position * 2 + 1 < ready.length) {

                let child = position * 2 + 1;
                if (child + 1 < ready.length && nodes[ready[child + 1]!]!.stepNo < nodes[ready[child]!]!.stepNo) child++;
                if (nodes[last]!.stepNo <= nodes[ready[child]!]!.stepNo) break;
                ready[position] = ready[child]!;
                position = child;

            }
            ready[position] = last;

        }

        return first;

    };
    for (let index = 0; index < nodes.length; index++) if (pending[index] === 0) push(index);

    return new Promise((resolve, reject) => {

        let active = 0;
        let admitted = 0;
        let failed = false;
        let interrupted = false;
        let thrown = false;
        let thrownError: unknown;
        const control = { stop: () => {

            failed = true;

        } };
        const pump = () => {

            if (!failed && signal?.aborted && admitted < nodes.length) interrupted = true;
            while (!failed && !interrupted && active < concurrency && ready.length) {

                const index = pop();
                active++;
                admitted++;
                const [started, startError] = attemptSync(() => execute(nodes[index]!, control));
                if (startError) {

                    failed = true;
                    if (!thrown) {

                        thrown = true;
                        thrownError = startError;

                    }

                }
                const work = startError ? Promise.reject(startError) : started;
                void Promise.resolve(work).then((success) => {

                    if (!success) failed = true;
                    else for (const dependent of dependents[index]!) {

                        pending[dependent]!--;
                        if (pending[dependent] === 0) push(dependent);

                    }

                }, (error: unknown) => {

                    failed = true;
                    if (!thrown) {

                        thrown = true;
                        thrownError = error;

                    }

                }).then(() => {

                    active--;
                    pump();

                });
                if (!failed && signal?.aborted && admitted < nodes.length) interrupted = true;

            }
            if (active === 0 && (failed || interrupted || admitted === nodes.length)) {

                if (thrown) reject(thrownError);
                else resolve({ failed, interrupted });

            }

        };
        pump();

    });

}
