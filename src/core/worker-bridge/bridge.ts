import { Worker, parentPort } from 'worker_threads';
import { ObserverRelay } from '@logosdx/observer';
import { randomUUID } from 'crypto';
import { WorkerPool } from './pool.js';
import type { WireMessage, ResKey, PoolOptions } from './types.js';

type Port = Worker | import('worker_threads').MessagePort

export class WorkerBridge<TEvents extends { [K: string]: object }> extends ObserverRelay<TEvents, Record<string, never>> {

    #port: Port;
    #ownsWorker: boolean;
    #deathError: Error | null = null;
    #pendingRejects = new Set<(err: Error) => void>();

    constructor(script?: string | URL) {

        const isParent = !!script;
        super({ name: isParent ? 'bridge:parent' : 'bridge:worker' });

        if (script) {

            this.#port = new Worker(script);
            this.#ownsWorker = true

            // Detect worker crash — emit error event so orchestrators can abort
            ;(this.#port as Worker).on('exit', (code: number) => {

                if (!this.isShutdown && code !== 0) {

                    this.receive('worker:exit', { code, error: `Worker exited with code ${code}` }, {} as Record<string, never>);
                    this.#failPending(new Error(`Worker exited with code ${code}`));

                }

            });

        }
        else {

            if (!parentPort) {

                throw new Error(
                    'WorkerBridge: no script provided and not in a worker thread',
                );

            }
            this.#port = parentPort;
            this.#ownsWorker = false;

        }

        this.#port.on('message', (msg: WireMessage) => {

            this.receive(msg.event, msg.data, {} as Record<string, never>);

        });

    }

    protected override send(event: string, data: unknown): void {

        this.#port.postMessage({ event, data }, []);

    }

    /**
     * Reject every outstanding request and refuse new ones.
     *
     * A worker that has exited will never post a response, so `request()`'s
     * `once()` would wait forever — there is no timeout and no other signal
     * that the thread is gone. Without this, a single crashed compute worker
     * wedges the export/import pipeline permanently.
     */
    #failPending(err: Error): void {

        this.#deathError = err;

        for (const reject of this.#pendingRejects) {

            reject(err);

        }

        this.#pendingRejects.clear();

    }

    async request<K extends keyof TEvents & string>(
        event: K,
        data: TEvents[K],
        options?: { signal?: AbortSignal },
    ): Promise<ResKey<K> extends keyof TEvents ? TEvents[ResKey<K>] : unknown> {

        if (this.#deathError) {

            throw this.#deathError;

        }

        const cid = randomUUID();
        const pending = this.once(new RegExp(`^${event}:res:${cid}$`), options);

        let onDeath!: (err: Error) => void;
        const death = new Promise<never>((_resolve, reject) => {

            onDeath = reject;

        });

        this.#pendingRejects.add(onDeath);
        this.send(event, { ...data, __cid: cid });

        // Losing the race is not an unhandled rejection: #failPending only
        // rejects deferreds still in the set, and every settled request
        // removes its own before returning.
        const { data: { data: result } } = await Promise
            .race([pending, death])
            .finally(() => this.#pendingRejects.delete(onDeath));

        return result as ResKey<K> extends keyof TEvents ? TEvents[ResKey<K>] : unknown;

    }

    static pool<T extends { [K: string]: object }>(
        script: string | URL,
        options: PoolOptions,
    ): WorkerPool<T> {

        return new WorkerPool<T>(script, options);

    }

    override async shutdown(): Promise<void> {

        super.shutdown();
        this.#failPending(new Error('WorkerBridge was shut down with requests in flight'));

        if (this.#ownsWorker && 'terminate' in this.#port) {

            await this.#port.terminate();

        }

    }

}
