/**
 * Cancellation primitives for work that can outlive the caller's interest in it.
 *
 * A database driver sitting on a dead socket has nothing to react to, so
 * nothing here makes it stop. What it does is let the caller stop waiting
 * without losing the handle: the abandoned promise still settles, and its
 * value is routed to a salvage callback so whoever owns the resource can close
 * it rather than leak it.
 */

/**
 * Raised when a caller stopped waiting for an operation.
 *
 * Deliberately not a failure of the operation: the work may well still be
 * running. Callers test for it so they can word the outcome honestly instead
 * of reporting a database error that never happened.
 *
 * @example
 * const [conn, err] = await attempt(() => createConnection(config, name, {}, signal));
 *
 * if (err instanceof OperationAbortedError) return { ok: false, aborted: true };
 */
export class OperationAbortedError extends Error {

    override readonly name = 'OperationAbortedError' as const;

    constructor(message = 'Stopped waiting for the database') {

        super(message);

    }

}

/**
 * Throw immediately when `signal` has already been aborted.
 *
 * Guards the entry of an operation, so an abort that landed before the call
 * still prevents the work instead of starting something nobody wants.
 *
 * @example
 * throwIfAborted(signal);
 * const conn = await openConnection(config);
 */
export function throwIfAborted(signal?: AbortSignal, message?: string): void {

    if (signal?.aborted) {

        throw new OperationAbortedError(message);

    }

}

/**
 * Settle with `work`, or reject as soon as `signal` aborts — whichever is first.
 *
 * The abandoned `work` keeps running, because a promise cannot be un-started.
 * `onAbandoned` is the only place its eventual value can be reclaimed: for a
 * connection that means closing a pool nothing else holds a reference to. A
 * late rejection is swallowed, since the one listener has already gone and an
 * unhandled rejection would take the process with it.
 *
 * @example
 * // The caller gets control back on abort; a connection that opens later is
 * // still closed rather than left half-open.
 * return raceAbort(openConnection(config), signal, discardConnection);
 */
export function raceAbort<T>(
    work: Promise<T>,
    signal?: AbortSignal,
    onAbandoned?: (value: T) => void,
): Promise<T> {

    if (!signal) return work;

    // Seeded from `aborted`, and attached before the guard below throws: the
    // argument promise already exists by the time this function runs, so it
    // needs a handler on every path out of here.
    let abandoned = signal.aborted;

    void work.then(
        (value) => {

            if (abandoned) onAbandoned?.(value);

        },
        () => undefined,
    );

    throwIfAborted(signal);

    return new Promise<T>((resolve, reject) => {

        const onAbort = () => {

            abandoned = true;
            reject(new OperationAbortedError());

        };

        signal.addEventListener('abort', onAbort, { once: true });

        void work.then(
            (value) => {

                signal.removeEventListener('abort', onAbort);
                resolve(value);

            },
            (error) => {

                signal.removeEventListener('abort', onAbort);
                reject(error);

            },
        );

    });

}
