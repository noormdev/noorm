import { parentPort } from 'worker_threads';

if (!parentPort) throw new Error('Not in worker');

// Accepts messages and never answers. Models a worker wedged in a long or
// hung computation — the caller must not wait on it indefinitely.
parentPort.on('message', () => {});
