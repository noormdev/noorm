import { parentPort } from 'worker_threads';

if (!parentPort) throw new Error('Not in worker');

// Echo back every message with ':res' suffix
parentPort.on('message', ({ event, data }: { event: string; data: Record<string, unknown> }) => {

    const cid = data?.__cid;
    const resEvent = cid ? `${event}:res:${cid}` : `${event}:res`;
    parentPort!.postMessage({ event: resEvent, data: { ...data } });

});
