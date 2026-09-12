/**
 * Convert completed work into the 0–100 value expected by Ink's ProgressBar.
 *
 * Returns zero until a positive total is known and clamps over-counted event
 * streams so rendering remains within the component contract.
 *
 * @example
 * const value = progressPercentage(3, 4); // 75
 */
export function progressPercentage(completed: number, total: number): number {

    if (total <= 0) return 0;

    return Math.min(100, Math.max(0, (completed / total) * 100));

}
