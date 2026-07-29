import { describe, it, expect } from 'bun:test';
import { PendingSet } from '../../../src/core/worker-bridge/pending-set.js';

/**
 * Resolve after `ms`, used to order assertions against real settlement
 * rather than a counter.
 */
function delay(ms: number): Promise<void> {

    return new Promise((resolve) => setTimeout(resolve, ms));

}

describe('worker-bridge: PendingSet', () => {

    it('should report the number of unsettled tasks', async () => {

        const set = new PendingSet();

        set.track(delay(5));
        set.track(delay(5));

        expect(set.size).toBe(2);

        await set.settleAll();

        expect(set.size).toBe(0);

    });

    // The bug this class replaces: a task that failed before reaching the
    // downstream callback leaked its count and the drain loop spun forever.
    it('should settle a rejected task instead of leaking it', async () => {

        const set = new PendingSet();

        set.track(Promise.reject(new Error('worker died')));

        await set.settleAll();

        expect(set.size).toBe(0);

    });

    it('should settle a mix of resolved and rejected tasks', async () => {

        const set = new PendingSet();

        set.track(delay(1));
        set.track(Promise.reject(new Error('boom')));
        set.track(delay(3));

        await set.settleAll();

        expect(set.size).toBe(0);

    });

    it('should return from settleAny once one task settles', async () => {

        const set = new PendingSet();

        set.track(delay(1));
        set.track(delay(200));

        await set.settleAny();

        // The slow task is still outstanding — settleAny is a backpressure
        // release, not a drain.
        expect(set.size).toBe(1);

    });

    it('should return immediately from settleAny when nothing is tracked', async () => {

        const set = new PendingSet();

        await set.settleAny();

        expect(set.size).toBe(0);

    });

    it('should drain tasks added while an earlier batch is settling', async () => {

        const set = new PendingSet();

        set.track(delay(1).then(() => {

            set.track(delay(5));

        }));

        await set.settleAll();

        expect(set.size).toBe(0);

    });

});
