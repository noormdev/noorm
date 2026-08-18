/**
 * Where the cursor was, per list, for as long as the process lives.
 *
 * A screen unmounts when you navigate off it, so the highlighted row goes with
 * its component state and the next visit starts at the top. This is the store
 * that survives that unmount.
 *
 * Module state rather than a field on `AppContext`, for the same reason
 * `rowDocument.ts` keeps the preferred row format here: `SelectList` is the
 * only reader, it is rendered bare in tests that have no provider above it, and
 * a context field would force every one of them to grow a wrapper for a string.
 * Tests reset it with `clearListMemory()`.
 *
 * Positions are keyed by item key, never by index. Delete the row the cursor
 * was on and an index restores onto whatever slid into that slot; a key that no
 * longer matches anything simply misses, and the caller falls back to the top.
 */
import type { Route, RouteParams } from './types.js';

/**
 * Distinct lists remembered before the oldest is dropped.
 *
 * The key includes route params, so a session that walks fifty tables leaves
 * fifty entries behind. The cap keeps that bounded without anyone having to
 * think about it; a hundred list positions is far more than a session revisits
 * and costs a few kilobytes.
 */
const MAX_REMEMBERED_LISTS = 100;

/**
 * Insertion order is the eviction order, which `rememberListPosition` keeps
 * current by deleting before it sets.
 */
const positions = new Map<string, string>();

/**
 * Render route params to a stable string.
 *
 * Sorted, because two call sites can write the same params in a different
 * order and they are the same screen to a user.
 */
function serializeParams(params: RouteParams | undefined): string {

    if (!params) return '';

    return Object.entries(params)
        .filter(([, value]) => value !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([name, value]) => `${name}=${String(value)}`)
        .join('&');

}

/**
 * Build the slot a list's cursor is remembered in.
 *
 * Params are part of it because `secret?name=dev` and `secret?name=prod` are
 * different lists to a user. `listId` separates the lists on a route that
 * renders more than one - `db/transfer` and `db/dt-modify` are the two, and
 * both already label theirs.
 *
 * @example
 * const key = listMemoryKey('db/transfer', {}, 'DbTransferDestSelect');
 */
export function listMemoryKey(route: Route, params?: RouteParams, listId?: string): string {

    return `${route}|${serializeParams(params)}|${listId ?? ''}`;

}

/**
 * Remember which item the cursor is on.
 *
 * @example
 * rememberListPosition(key, item.key);
 */
export function rememberListPosition(key: string, itemKey: string): void {

    // Delete first so a rewrite moves the entry to the young end of the map
    // and a list the user keeps coming back to is never the one evicted.
    positions.delete(key);
    positions.set(key, itemKey);

    if (positions.size <= MAX_REMEMBERED_LISTS) return;

    const oldest = positions.keys().next().value;

    if (oldest !== undefined) positions.delete(oldest);

}

/**
 * The item the cursor was last on, if this list has been visited.
 *
 * @example
 * const remembered = recallListPosition(key);
 */
export function recallListPosition(key: string): string | undefined {

    return positions.get(key);

}

/**
 * Forget every remembered position.
 *
 * Called when the router resets, because the positions belong to the history
 * stack a reset discards. Tests use it to keep module state from leaking
 * between cases.
 *
 * @example
 * beforeEach(() => clearListMemory());
 */
export function clearListMemory(): void {

    positions.clear();

}
