/**
 * Arm-then-confirm for a key that does something hard to undo.
 *
 * The first press arms and returns false, so the screen can warn; a second
 * press within `windowMs` returns true. A press after the window re-arms
 * instead of confirming, so a stray key minutes later never acts alone.
 *
 * @example
 * ```tsx
 * const confirmCancel = useDoublePress();
 *
 * if (key.escape && phase === 'running') {
 *
 *     if (confirmCancel()) task.cancel();
 *     else showToast({ message: 'Press Esc again to cancel', variant: 'warning' });
 *
 * }
 * ```
 */
import { useCallback, useRef } from 'react';

/** Time a second press has to arrive in to confirm the first. */
export const DOUBLE_PRESS_WINDOW_MS = 2000;

/**
 * Returns a press handler that reports whether this press confirms the last one.
 */
export function useDoublePress(windowMs = DOUBLE_PRESS_WINDOW_MS): () => boolean {

    const armedAt = useRef<number | null>(null);

    return useCallback(() => {

        const now = Date.now();
        const confirmed = armedAt.current !== null && now - armedAt.current <= windowMs;

        armedAt.current = confirmed ? null : now;

        return confirmed;

    }, [windowMs]);

}
