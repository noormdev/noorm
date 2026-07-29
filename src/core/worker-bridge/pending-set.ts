/**
 * Tracks in-flight worker requests so a pipeline can apply backpressure and
 * drain on real promise settlement rather than on a counter.
 *
 * The pipelines used to spin on `while (inFlight > 0) await sleep(1)`, with
 * `inFlight` decremented from a downstream callback. Any dispatch that failed
 * before reaching that callback — a worker error, a rejected request, a dead
 * thread — leaked a count and the loop never terminated. Settled promises
 * cannot leak: a task that rejects still settles.
 *
 * @example
 * ```typescript
 * const inFlight = new PendingSet();
 *
 * inFlight.track(pool.request('serialize', payload).then(onOk, onErr));
 *
 * while (inFlight.size >= limit) await inFlight.settleAny();
 *
 * await inFlight.settleAll();
 * ```
 */
export class PendingSet {

    #pending = new Set<Promise<void>>();

    /** Number of tracked tasks that have not settled yet. */
    get size(): number {

        return this.#pending.size;

    }

    /**
     * Track a dispatched task.
     *
     * Rejection is absorbed here, not ignored: callers attach their own
     * handler before tracking, and swallowing a second time keeps `settleAny`
     * and `settleAll` from turning a task failure into an unhandled rejection.
     */
    track(task: Promise<unknown>): void {

        const tracked: Promise<void> = task
            .then(() => undefined, () => undefined)
            .finally(() => {

                this.#pending.delete(tracked);

            });

        this.#pending.add(tracked);

    }

    /**
     * Resolve once at least one tracked task has settled.
     *
     * Returns immediately when nothing is tracked, so a backpressure loop
     * cannot block on an empty set.
     */
    async settleAny(): Promise<void> {

        if (this.#pending.size === 0) return;

        await Promise.race(this.#pending);

    }

    /**
     * Resolve once every tracked task has settled.
     *
     * Loops because a task may be tracked while an earlier batch is draining.
     */
    async settleAll(): Promise<void> {

        while (this.#pending.size > 0) {

            await Promise.allSettled([...this.#pending]);

        }

    }

}
