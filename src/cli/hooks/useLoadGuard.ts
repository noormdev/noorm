/**
 * Prevents duplicate async loads during React strict mode remounts.
 *
 * Returns a ref-based guard: `tryAcquire()` returns true if lock acquired
 * (caller should proceed), false if already loading (caller should bail).
 * Call `release()` to allow future loads (optional for one-shot patterns).
 *
 * @example
 * const { tryAcquire, release } = useLoadGuard();
 *
 * useEffect(() => {
 *     if (!tryAcquire()) return;
 *     loadData().finally(release);
 * }, [deps]);
 */
import { useRef, useCallback } from 'react';

/**
 * Load guard result.
 */
export interface LoadGuard {
    tryAcquire: () => boolean;
    release: () => void;
}

/**
 * Ref-based guard to prevent duplicate async loads.
 */
export function useLoadGuard(): LoadGuard {

    const ref = useRef(false);

    const tryAcquire = useCallback(() => {

        if (ref.current) return false;

        ref.current = true;

        return true;

    }, []);

    const release = useCallback(() => {

        ref.current = false;

    }, []);

    return { tryAcquire, release };

}
