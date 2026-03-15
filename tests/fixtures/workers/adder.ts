import { parentPort } from 'worker_threads';

if (!parentPort) throw new Error('Not in worker');

parentPort.on('message', ({ event, data }: { event: string; data: Record<string, unknown> }) => {

    if (event === 'add') {

        const result = data.a + data.b;
        const resEvent = data.__cid ? `add:res:${data.__cid}` : 'add:res';
        parentPort!.postMessage({ event: resEvent, data: { result, index: data.index } });

    }

});
