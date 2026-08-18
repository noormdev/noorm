/**
 * List cursor memory tests.
 *
 * Pins the reported bug: entering an item from a list screen and coming back
 * used to land the cursor on row 0, because the screen unmounts on navigate
 * and the cursor lived in component state. Also pins the failure modes that
 * a naive fix introduces - restoring by index onto a deleted row, and two
 * lists on one route sharing a single memory slot.
 */
import { describe, it, expect, beforeEach, afterAll } from 'bun:test';
import { render } from 'ink-testing-library';
import React, { useEffect, useRef } from 'react';
import { Text } from 'ink';

import { FocusProvider } from '../../../src/tui/focus.js';
import { RouterProvider, useRouter } from '../../../src/tui/router.js';
import { SelectList } from '../../../src/tui/components/lists/index.js';
import {
    clearListMemory,
    listMemoryKey,
    recallListPosition,
    rememberListPosition,
} from '../../../src/tui/list-memory.js';

import type { SelectListItem } from '../../../src/tui/components/lists/index.js';
import type { Route, RouteParams } from '../../../src/tui/types.js';

/**
 * Poll until the predicate holds, and fail loudly when it never does.
 *
 * A waiter that returns quietly on timeout turns every assertion after it into
 * a coin flip, so this throws instead.
 */
async function waitFor(predicate: () => boolean, label: string, timeoutMs = 3000): Promise<void> {

    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {

        if (predicate()) return;

        await new Promise((r) => setTimeout(r, 5));

    }

    throw new Error(`waitFor timed out: ${label}`);

}

/**
 * Let any queued effect and the render it schedules run to completion.
 *
 * Needed only before asserting that something did *not* happen. There is no
 * condition to poll for in that case, and a restore that fires one commit late
 * would otherwise slip past an assertion made on the very first frame - which
 * is how three of these tests originally passed against a broken build.
 */
async function settle(turns = 10): Promise<void> {

    for (let i = 0; i < turns; i++) {

        await new Promise((r) => setTimeout(r, 10));

    }

}

const DOWN = '\x1B[B';
const UP = '\x1B[A';

function makeItems(labels: string[]): SelectListItem<string>[] {

    return labels.map((label) => ({ key: label, label, value: label }));

}

/**
 * Drives navigation from a prop so a test can step the router without
 * reaching into React internals.
 *
 * One navigation per change of `step`, tracked on a ref. `navigate` and `back`
 * are rebuilt whenever history changes, so an effect that lists them re-fires
 * on its own result and walks the stack all the way to the bottom.
 */
function Navigator({ step }: { step: Route | 'back' | null }) {

    const { navigate, back } = useRouter();

    const lastStepRef = useRef<Route | 'back' | null>(null);
    const navigateRef = useRef(navigate);
    const backRef = useRef(back);
    navigateRef.current = navigate;
    backRef.current = back;

    useEffect(() => {

        if (step === null || lastStepRef.current === step) return;

        lastStepRef.current = step;

        if (step === 'back') {

            backRef.current();

            return;

        }

        navigateRef.current(step);

    }, [step]);

    return null;

}

/**
 * A list that only exists on `db/explore/tables`, so navigating away really
 * unmounts it - the condition that loses the cursor in the reported bug.
 */
function OneListApp({
    step,
    items,
    focusLabel,
    defaultValue,
}: {
    step: Route | 'back' | null;
    items: SelectListItem<string>[];
    focusLabel?: string;
    defaultValue?: string;
}) {

    return (
        <FocusProvider>
            <RouterProvider initialRoute="db/explore/tables">
                <Navigator step={step} />
                <OnlyOn route="db/explore/tables">
                    <SelectList
                        items={items}
                        isFocused
                        focusLabel={focusLabel}
                        defaultValue={defaultValue}
                    />
                </OnlyOn>
            </RouterProvider>
        </FocusProvider>
    );

}

function OnlyOn({ route, children }: { route: Route; children: React.ReactNode }) {

    const { route: current } = useRouter();

    if (current !== route) return <Text>elsewhere:{current}</Text>;

    return <>{children}</>;

}

describe('cli: list-position', () => {

    beforeEach(() => {

        clearListMemory();

    });

    // The store is module state and the CI group runs every cli file in one
    // process, so this file leaves nothing behind for the next one.
    afterAll(() => {

        clearListMemory();

    });

    describe('key', () => {

        it('should key the same params the same way whatever order they were written in', () => {

            const forwards: RouteParams = { name: 'dev', schema: 'public' };
            const backwards: RouteParams = { schema: 'public', name: 'dev' };

            expect(listMemoryKey('config', forwards)).toBe(listMemoryKey('config', backwards));

        });

        it('should treat different params on one route as different lists', () => {

            expect(listMemoryKey('secret', { name: 'dev' }))
                .not.toBe(listMemoryKey('secret', { name: 'prod' }));

        });

        it('should ignore params that were left undefined', () => {

            expect(listMemoryKey('config', { name: 'dev', schema: undefined }))
                .toBe(listMemoryKey('config', { name: 'dev' }));

        });

        it('should treat two lists on one route as different when they carry a list id', () => {

            expect(listMemoryKey('db/transfer', {}, 'DbTransferDestSelect'))
                .not.toBe(listMemoryKey('db/transfer', {}, 'DbTransferTableSelect'));

        });

    });

    describe('store', () => {

        it('should hand back what it was given', () => {

            const key = listMemoryKey('config', {});

            rememberListPosition(key, 'staging');

            expect(recallListPosition(key)).toBe('staging');

        });

        it('should evict the least recently written entry once the cap is passed', () => {

            const first = listMemoryKey('config', { name: 'entry-0' });

            rememberListPosition(first, 'row');

            for (let i = 1; i <= 200; i++) {

                rememberListPosition(listMemoryKey('config', { name: `entry-${i}` }), 'row');

            }

            expect(recallListPosition(first)).toBeUndefined();
            expect(recallListPosition(listMemoryKey('config', { name: 'entry-200' }))).toBe('row');

        });

        it('should survive later pressure once it has been rewritten', () => {

            const kept = listMemoryKey('config', { name: 'kept' });

            rememberListPosition(kept, 'row');

            for (let i = 0; i < 60; i++) {

                rememberListPosition(listMemoryKey('config', { name: `filler-${i}` }), 'row');

            }

            // The visit that has to count: rewriting an entry has to move it to
            // the young end, or the list a user keeps coming back to is the one
            // the cap throws away. Asserting straight after the rewrite proves
            // nothing - a plain `set` leaves it there too.
            rememberListPosition(kept, 'row');

            for (let i = 60; i < 120; i++) {

                rememberListPosition(listMemoryKey('config', { name: `filler-${i}` }), 'row');

            }

            expect(recallListPosition(kept)).toBe('row');

        });

    });

    describe('SelectList', () => {

        /**
         * Leaves the cursor on `charlie` and then walks off the screen, which
         * unmounts the list. Every restore case starts from here.
         */
        async function leaveCursorOnCharlie(items: SelectListItem<string>[], focusLabel?: string) {

            const handle = render(
                <OneListApp step={null} items={items} focusLabel={focusLabel} />,
            );

            await waitFor(
                () => Boolean(handle.lastFrame()?.includes('❯ alpha')),
                'cursor on first row',
            );

            handle.stdin.write(DOWN);
            handle.stdin.write(DOWN);

            // Poll on the cursor, never on a row label: every label is on screen
            // from the first frame, so a label predicate returns before anything
            // has moved and every assertion after it becomes a coin flip.
            await waitFor(
                () => Boolean(handle.lastFrame()?.includes('❯ charlie')),
                'cursor moved to charlie',
            );

            handle.rerender(
                <OneListApp step="db/explore/tables/detail" items={items} focusLabel={focusLabel} />,
            );

            await waitFor(
                () => Boolean(handle.lastFrame()?.includes('elsewhere:')),
                'list unmounted',
            );

            return handle;

        }

        it('should put the cursor back on the row it was left on after a pop', async () => {

            const items = makeItems(['alpha', 'bravo', 'charlie', 'delta']);
            const { lastFrame, rerender, unmount } = await leaveCursorOnCharlie(items);

            rerender(<OneListApp step="back" items={items} />);

            await waitFor(
                () => Boolean(lastFrame()?.includes('❯ charlie')),
                'cursor restored to charlie',
            );

            expect(lastFrame()).toContain('❯ charlie');
            expect(lastFrame()).not.toContain('❯ alpha');

            unmount();

        });

        it('should open at the top when the route is walked into rather than returned to', async () => {

            const items = makeItems(['alpha', 'bravo', 'charlie', 'delta']);
            const { lastFrame, rerender, stdin, unmount } = await leaveCursorOnCharlie(items);

            // Forward navigation, not a pop. A wizard swaps one list for another
            // under a single route this way, and each step is meant to open on
            // its own first row - `DbTransferScreen` counts on it.
            rerender(<OneListApp step="db/explore/tables" items={items} />);

            await settle();

            expect(lastFrame()).toContain('❯ alpha');
            expect(lastFrame()).not.toContain('❯ charlie');

            // Then prove it by moving: from the top, Up wraps to delta. A cursor
            // wrongly restored to charlie would go to bravo and never show delta,
            // so this cannot pass on a frame that merely has not caught up yet.
            stdin.write(UP);

            await waitFor(() => Boolean(lastFrame()?.includes('❯ delta')), 'Up wrapped from the top');

            unmount();

        });

        it('should fall back to the first row when the remembered item is gone', async () => {

            const items = makeItems(['alpha', 'bravo', 'charlie', 'delta']);
            const { lastFrame, rerender, stdin, unmount } = await leaveCursorOnCharlie(items);

            // charlie deleted while the detail screen was up. An index-keyed
            // restore would land on delta, which slid into charlie's slot.
            const remaining = makeItems(['alpha', 'bravo', 'delta']);

            rerender(<OneListApp step="back" items={remaining} />);

            await settle();

            expect(lastFrame()).toContain('❯ alpha');
            expect(lastFrame()).not.toContain('❯ delta');
            expect(lastFrame()).not.toContain('charlie');

            // From the top, Down lands on bravo. A cursor restored by index onto
            // delta - the row that slid into charlie's slot - is at the end, so
            // Down wraps it to alpha and bravo never gets the marker.
            stdin.write(DOWN);

            await waitFor(() => Boolean(lastFrame()?.includes('❯ bravo')), 'Down moved off the top');

            unmount();

        });

        it('should restore a row that only arrives after the screen is back', async () => {

            const items = makeItems(['alpha', 'bravo', 'charlie', 'delta']);
            const { lastFrame, rerender, unmount } = await leaveCursorOnCharlie(items);

            // The screen comes back before its fetch resolves, so the list
            // remounts empty and the remembered row cannot be matched until the
            // rows land - a render after the one that read the initial state.
            rerender(<OneListApp step="back" items={[]} />);

            await waitFor(() => Boolean(lastFrame()?.includes('No items')), 'empty remount');

            rerender(<OneListApp step="back" items={items} />);

            await waitFor(
                () => Boolean(lastFrame()?.includes('❯ charlie')),
                'cursor restored to charlie',
            );

            expect(lastFrame()).toContain('❯ charlie');

            unmount();

        });

        it('should let an explicit defaultValue outrank the remembered row', async () => {

            const items = makeItems(['alpha', 'bravo', 'charlie', 'delta']);
            const { lastFrame, rerender, stdin, unmount } = await leaveCursorOnCharlie(items);

            rerender(<OneListApp step="back" items={items} defaultValue="bravo" />);

            await settle();

            expect(lastFrame()).toContain('❯ bravo');
            expect(lastFrame()).not.toContain('❯ charlie');

            // From bravo, Up lands on alpha. A cursor that let the memory win
            // sits on charlie, where Up lands on bravo, so alpha never gets the
            // marker either before or after the key.
            stdin.write(UP);

            await waitFor(() => Boolean(lastFrame()?.includes('❯ alpha')), 'Up moved off bravo');

            unmount();

        });

        it('should record the cursor under the list id when one is given', async () => {

            const items = makeItems(['alpha', 'bravo', 'charlie', 'delta']);
            const { unmount } = await leaveCursorOnCharlie(items, 'TablesList');

            // The discriminated slot holds it; the bare-route slot a sibling list
            // on this route would use is untouched.
            expect(recallListPosition(listMemoryKey('db/explore/tables', {}, 'TablesList')))
                .toBe('charlie');
            expect(recallListPosition(listMemoryKey('db/explore/tables', {})))
                .toBeUndefined();

            unmount();

        });

        it('should not remember anything when there is no router above it', async () => {

            const items = makeItems(['alpha', 'bravo', 'charlie']);

            const { lastFrame, stdin, unmount } = render(
                <FocusProvider>
                    <SelectList items={items} isFocused />
                </FocusProvider>,
            );

            await waitFor(() => Boolean(lastFrame()?.includes('❯ alpha')), 'cursor on first row');

            stdin.write(DOWN);

            await waitFor(() => Boolean(lastFrame()?.includes('❯ bravo')), 'cursor moved');

            expect(recallListPosition(listMemoryKey('db/explore/tables', {}))).toBeUndefined();

            unmount();

        });

    });

    describe('router reset', () => {

        it('should drop every remembered position when the history stack is discarded', async () => {

            const key = listMemoryKey('config', {});

            rememberListPosition(key, 'staging');

            const { lastFrame, unmount } = render(
                <FocusProvider>
                    <RouterProvider initialRoute="config">
                        <ResetOnMount />
                    </RouterProvider>
                </FocusProvider>,
            );

            await waitFor(() => Boolean(lastFrame()?.includes('route:home')), 'reset ran');

            expect(recallListPosition(key)).toBeUndefined();

            unmount();

        });

    });

});

function ResetOnMount() {

    const { reset, route } = useRouter();

    useEffect(() => {

        reset();

    }, [reset]);

    return <Text>route:{route}</Text>;

}
