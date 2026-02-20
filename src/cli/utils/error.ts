/**
 * Error message extraction utility.
 *
 * Replaces the 60+ inline occurrences of
 * `err instanceof Error ? err.message : String(err)`.
 *
 * @example
 * ```typescript
 * const [, err] = await attempt(() => doSomething());
 * if (err) setError(getErrorMessage(err));
 * ```
 */


/**
 * Extracts a human-readable message from an unknown error value.
 *
 * Handles Error instances, objects with a message property, and
 * arbitrary values via String coercion.
 */
export function getErrorMessage(err: unknown): string {

    if (err instanceof Error) return err.message;

    if (err && typeof err === 'object' && 'message' in err) {

        return String((err as { message: unknown }).message);

    }

    return String(err);

}
