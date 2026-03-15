import { Worker, parentPort, workerData } from 'worker_threads';
import type { Transferable as NodeTransferable } from 'worker_threads';
import { ObserverRelay } from '@logosdx/observer';
import { randomUUID } from 'crypto';
import { WorkerPool } from './pool.js';
import { isTransferable } from './types.js';
import type { WireMessage, ResKey, PoolOptions } from './types.js';

type Port = Worker | import('worker_threads').MessagePort

export class WorkerBridge<TEvents extends { [K: string]: object }> extends ObserverRelay<TEvents, Record<string, never>> {

    #port: Port;
    #ownsWorker: boolean;

    constructor(script?: string | URL, data?: unknown) {

        const isParent = !!script;
        super({ name: isParent ? 'bridge:parent' : 'bridge:worker' });

        if (script) {

            this.#port = new Worker(script, { workerData: data });
            this.#ownsWorker = true

            // Detect worker crash — emit error event so orchestrators can abort
            ;(this.#port as Worker).on('exit', (code: number) => {

                if (!this.isShutdown && code !== 0) {

                    this.receive('worker:exit', { code, error: `Worker exited with code ${code}` }, {} as Record<string, never>);

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

        if (isTransferable(data)) {

            this.#port.postMessage({ event, data }, data.__transfer as NodeTransferable[]);

        }
        else {

            this.#port.postMessage({ event, data }, []);

        }

    }

    async request<K extends keyof TEvents & string>(
        event: K,
        data: TEvents[K],
        options?: { signal?: AbortSignal },
    ): Promise<ResKey<K> extends keyof TEvents ? TEvents[ResKey<K>] : unknown> {

        const cid = randomUUID();
        const pending = this.once(new RegExp(`^${event}:res:${cid}$`), options);
        this.send(event, { ...data, __cid: cid });
        const { data: { data: result } } = await pending;

        return result as ResKey<K> extends keyof TEvents ? TEvents[ResKey<K>] : unknown;

    }

    transfer<K extends keyof TEvents & string>(
        event: K,
        data: TEvents[K],
        transferables: NodeTransferable[],
    ): void {

        this.#port.postMessage({ event, data }, transferables);

    }

    static pool<T extends { [K: string]: object }>(
        script: string | URL,
        options: PoolOptions,
    ): WorkerPool<T> {

        return new WorkerPool<T>(script, options);

    }

    static get workerData() {

        return workerData;

    }

    override async shutdown(): Promise<void> {

        super.shutdown();
        if (this.#ownsWorker && 'terminate' in this.#port) {

            await this.#port.terminate();

        }

    }

}
