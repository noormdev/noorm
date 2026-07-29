import { parentPort } from 'worker_threads';

if (!parentPort) throw new Error('Not in worker');

// Accepts a request and then kills the thread without ever answering.
// Models a compute worker that OOMs or crashes mid-serialization.
parentPort.on('message', () => {

    process.exit(7);

});
