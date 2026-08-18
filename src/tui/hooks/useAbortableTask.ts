/**
 * One cancellable database operation per screen.
 *
 * The screen owns its busy state as it always did; this owns the question of
 * whether a result that just came back still belongs on screen. A hung connect
 * or query can resolve long after the user pressed Escape and moved on, and
 * writing that result is how a cancelled screen silently un-cancels itself.
 *
 * @example
 * ```tsx
 * const task = useAbortableTask();
 *
 * const submit = async () => {
 *
 *     const controller = task.start();
 *     setBusy(true);
 *
 *     const result = await testConnection(config, { signal: controller.signal });
 *
 *     if (!task.isCurrent(controller)) return;
 *
 *     setBusy(false);
 *
 * };
 *
 * // Escape while busy
 * if (task.cancel()) {
 *
 *     setBusy(false);
 *     setError('Stopped waiting for the database.');
 *
 * }
 * ```
 */
import { useCallback, useEffect, useRef } from 'react';

/**
 * Handle for the screen's single in-flight operation.
 */
export interface AbortableTask {

    /**
     * Begin an operation, aborting whatever was in flight before it.
     * The returned controller is the operation's identity as well as its
     * cancel handle.
     */
    start: () => AbortController;

    /**
     * Abort the live operation. Returns false when there was nothing to abort,
     * which is what lets a screen fall through to its normal Escape behaviour.
     */
    cancel: () => boolean;

    /**
     * Whether `controller` is still the operation the screen is showing.
     *
     * False once it has been cancelled or replaced. Every `await` in an
     * operation needs this check afterwards: a driver is free to ignore an
     * abort and answer anyway, and that answer must not reach the screen.
     */
    isCurrent: (controller: AbortController) => boolean;

}

/**
 * Track one cancellable operation, and reject results that outlived it.
 */
export function useAbortableTask(): AbortableTask {

    const activeRef = useRef<AbortController | null>(null);

    const start = useCallback(() => {

        activeRef.current?.abort();

        const controller = new AbortController();
        activeRef.current = controller;

        return controller;

    }, []);

    const cancel = useCallback(() => {

        const controller = activeRef.current;

        if (!controller || controller.signal.aborted) return false;

        controller.abort();

        return true;

    }, []);

    const isCurrent = useCallback(
        (controller: AbortController) => activeRef.current === controller && !controller.signal.aborted,
        [],
    );

    // Unmounting is a cancellation too: without this the operation keeps its
    // connection open and its continuation would set state on a dead component.
    useEffect(() => () => {

        activeRef.current?.abort();
        activeRef.current = null;

    }, []);

    return { start, cancel, isCurrent };

}
