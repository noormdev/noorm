import { WorkerBridge } from './bridge.js';
import type { ResKey, PoolOptions } from './types.js';

/**
 * Manages a pool of WorkerBridge instances for parallel compute workloads.
 *
 * Dispatches requests round-robin across all workers to balance CPU-bound
 * serialization tasks without overwhelming a single thread.
 *
 * @example
 * const pool = new WorkerPool<ComputeEvents>(workerScript, { size: 4 })
 * const result = await pool.request('serialize', { row, columns, index: 0 })
 * await pool.shutdown()
 */
export class WorkerPool<TEvents extends { [K: string]: object }> {

    #workers: WorkerBridge<TEvents>[];
    #nextIndex = 0;
    #isShutdown = false;

    constructor(script: string | URL, options: PoolOptions) {

        const size = Math.max(1, options.size);
        this.#workers = Array.from({ length: size }, () =>
            new WorkerBridge<TEvents>(script),
        );

    }

    /**
     * Returns the number of workers in the pool.
     */
    get size(): number {

        return this.#workers.length;

    }

    /**
     * Returns true if the pool has been shut down.
     */
    get isShutdown(): boolean {

        return this.#isShutdown;

    }

    /**
     * Sends a request to the next available worker (round-robin) and awaits its response.
     *
     * Injects a correlation ID so concurrent requests on the same event type
     * can be matched to their originating worker.
     *
     * @example
     * const { values } = await pool.request('serialize', { row, columns, index: 0 })
     */
    async request<K extends keyof TEvents & string>(
        event: K,
        data: TEvents[K],
        options?: { signal?: AbortSignal },
    ): Promise<ResKey<K> extends keyof TEvents ? TEvents[ResKey<K>] : unknown> {

        const worker = this.#workers[this.#nextIndex]!;
        this.#nextIndex = (this.#nextIndex + 1) % this.#workers.length;

        return worker.request(event, data, options);

    }

    /**
     * Terminates all workers in the pool.
     *
     * Marks the pool as shut down and waits for every worker thread to exit
     * before resolving.
     *
     * @example
     * await pool.shutdown()
     */
    async shutdown(): Promise<void> {

        this.#isShutdown = true;
        await Promise.all(this.#workers.map(w => w.shutdown()));

    }

}
