/**
 * Hook for async effects with cancellation support.
 *
 * Eliminates the repeated `let cancelled = false` boilerplate
 * found in 30+ screen files.
 *
 * @example
 * ```typescript
 * useAsyncEffect(async (isCancelled) => {
 *     const data = await loadData();
 *     if (isCancelled()) return;
 *     setData(data);
 * }, [dependency]);
 * ```
 */
import { useEffect, type DependencyList } from 'react';

/**
 * Run an async effect with automatic cancellation.
 *
 * The `isCancelled` callback returns true after the effect is cleaned up,
 * preventing state updates on unmounted components.
 */
export function useAsyncEffect(
    effect: (isCancelled: () => boolean) => Promise<void>,
    deps: DependencyList,
): void {

    useEffect(() => {

        let cancelled = false;

        effect(() => cancelled);

        return () => {

            cancelled = true;

        };

    }, deps);

}
