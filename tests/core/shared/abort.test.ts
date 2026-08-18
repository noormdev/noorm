/**
 * Cancellation primitive tests.
 *
 * The intent being pinned is that a caller can stop waiting without losing
 * track of what it stopped waiting for: the abandoned work still settles, and
 * its result has to reach the salvage handler or the resource leaks.
 */
import { describe, it, expect } from 'bun:test';
import { attempt, attemptSync } from '@logosdx/utils';

import {
    OperationAbortedError,
    raceAbort,
    throwIfAborted,
} from '../../../src/core/shared/abort.js';

/**
 * A promise plus the handles to settle it later, so a test can decide when
 * "the driver came back" happens relative to the abort.
 */
function deferred<T>() {

    let resolve!: (value: T) => void;
    let reject!: (error: Error) => void;

    const promise = new Promise<T>((res, rej) => {

        resolve = res;
        reject = rej;

    });

    return { promise, resolve, reject };

}

describe('shared: abort', () => {

    describe('throwIfAborted', () => {

        it('should do nothing without a signal', () => {

            const [, err] = attemptSync(() => throwIfAborted(undefined));

            expect(err).toBeNull();

        });

        it('should do nothing while the signal is live', () => {

            const controller = new AbortController();

            const [, err] = attemptSync(() => throwIfAborted(controller.signal));

            expect(err).toBeNull();

        });

        it('should throw OperationAbortedError once aborted', () => {

            const controller = new AbortController();
            controller.abort();

            const [, err] = attemptSync(() => throwIfAborted(controller.signal));

            expect(err).toBeInstanceOf(OperationAbortedError);

        });

    });

    describe('raceAbort', () => {

        it('should hand back the work promise untouched when no signal is given', async () => {

            const work = Promise.resolve('done');

            expect(raceAbort(work)).toBe(work);
            expect(await raceAbort(work)).toBe('done');

        });

        it('should resolve normally when the work wins the race', async () => {

            const controller = new AbortController();

            const value = await raceAbort(Promise.resolve('done'), controller.signal);

            expect(value).toBe('done');

        });

        it('should propagate the work error when the work fails first', async () => {

            const controller = new AbortController();
            const boom = new Error('boom');

            const [value, err] = await attempt(() =>
                raceAbort(Promise.reject(boom), controller.signal),
            );

            expect(err).toBe(boom);
            expect(value).toBeNull();

        });

        it('should reject with OperationAbortedError as soon as the signal fires', async () => {

            const controller = new AbortController();
            const never = deferred<string>();

            const raced = attempt(() => raceAbort(never.promise, controller.signal));

            controller.abort();

            const [value, err] = await raced;

            expect(err).toBeInstanceOf(OperationAbortedError);
            expect(value).toBeNull();

        });

        it('should reject an already-aborted signal without waiting for the work', async () => {

            const controller = new AbortController();
            controller.abort();

            const [, err] = await attempt(() =>
                raceAbort(deferred<string>().promise, controller.signal),
            );

            expect(err).toBeInstanceOf(OperationAbortedError);

        });

        it('should hand a late result to onAbandoned so the caller can close it', async () => {

            const controller = new AbortController();
            const late = deferred<string>();
            const salvaged: string[] = [];

            const raced = attempt(() =>
                raceAbort(late.promise, controller.signal, (value) => salvaged.push(value)),
            );

            controller.abort();
            await raced;

            expect(salvaged).toEqual([]);

            late.resolve('a live pool nobody is holding');
            await new Promise((r) => setTimeout(r, 10));

            expect(salvaged).toEqual(['a live pool nobody is holding']);

        });

        it('should salvage a late result even when the signal was already aborted', async () => {

            const controller = new AbortController();
            controller.abort();

            const late = deferred<string>();
            const salvaged: string[] = [];

            await attempt(() =>
                raceAbort(late.promise, controller.signal, (value) => salvaged.push(value)),
            );

            late.resolve('opened after nobody was waiting');
            await new Promise((r) => setTimeout(r, 10));

            expect(salvaged).toEqual(['opened after nobody was waiting']);

        });

        it('should never call onAbandoned when the work wins', async () => {

            const controller = new AbortController();
            const salvaged: string[] = [];

            const value = await raceAbort(
                Promise.resolve('done'),
                controller.signal,
                (v) => salvaged.push(v),
            );

            controller.abort();
            await new Promise((r) => setTimeout(r, 10));

            expect(value).toBe('done');
            expect(salvaged).toEqual([]);

        });

        it('should swallow a late rejection instead of crashing the process', async () => {

            const controller = new AbortController();
            const late = deferred<string>();
            const unhandled: unknown[] = [];

            const onUnhandled = (reason: unknown) => unhandled.push(reason);
            process.on('unhandledRejection', onUnhandled);

            const raced = attempt(() => raceAbort(late.promise, controller.signal));

            controller.abort();
            await raced;

            late.reject(new Error('driver gave up long after nobody cared'));
            await new Promise((r) => setTimeout(r, 50));

            process.off('unhandledRejection', onUnhandled);

            expect(unhandled).toEqual([]);

        });

    });

});
