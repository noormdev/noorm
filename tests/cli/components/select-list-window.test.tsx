/**
 * SelectList windowing and custom-row tests.
 *
 * The defect these pin is not "the list does not scroll" but something worse
 * that hid inside it. Both history screens drew a fixed `slice(0, N)` while
 * their cursor ranged over the whole array, so past row N the arrow keys still
 * moved a selection the reader could not see, and the detail box under the list
 * described a record that was not on screen. A test that only asserted "more
 * rows are reachable" would pass on that arrangement.
 *
 * So what is pinned here is the invariant that makes the two impossible to
 * disagree: whatever the cursor is on is drawn, and it is drawn as selected.
 * Every screen that hands its list to `SelectList` inherits it, which is the
 * point of moving them onto it.
 *
 * `renderItem` is tested alongside because it is the reason those screens could
 * move: without a custom row body they would have had to give up the per-status
 * colour that a reader scans a history list for, and would have kept their own
 * list to keep it.
 */
import { describe, it, expect } from 'bun:test';
import { render } from 'ink-testing-library';
import { Text } from 'ink';
import React from 'react';

import { FocusProvider } from '../../../src/tui/focus.js';
import { SelectList } from '../../../src/tui/components/lists/index.js';

/** Rows the list may draw, pinned so the assertions do not depend on a terminal. */
const VISIBLE = 5;

/** Far more items than fit, so there is always something past the fold. */
const TOTAL = 40;

const DOWN = '\x1B[B';
const UP = '\x1B[A';

const ANSI_PATTERN = /\[[0-9;]*m/g;

function strip(frame: string | undefined): string {

    return (frame ?? '').replace(ANSI_PATTERN, '');

}

/** The line the cursor is on, marker included. */
function selectedLine(frame: string | undefined): string {

    return strip(frame).split('\n').find((line) => line.includes('❯')) ?? '';

}

/**
 * Press a key until the list says what we are waiting for, or give up.
 *
 * Counting presses does not survive contact with Ink. The focus stack
 * initialises in an effect, so a keypress written on the first tick is dropped
 * before any handler exists, and writes in a tight loop coalesce into one input
 * string and one event. Both make "press N times, expect index N" wrong in a
 * way that looks like a component bug. Driving to a condition sidesteps both,
 * and the condition is the thing worth asserting anyway.
 */
async function pressUntil(
    stdin: { write: (data: string) => void },
    sequence: string,
    predicate: () => boolean,
    limit = 80,
): Promise<void> {

    for (let count = 0; count < limit && !predicate(); count += 1) {

        stdin.write(sequence);

        await new Promise((resolve) => setTimeout(resolve, 10));

    }

}

/** Wait for the first frame to settle, without pressing anything. */
async function waitFor(predicate: () => boolean, timeoutMs = 2000): Promise<void> {

    const deadline = Date.now() + timeoutMs;

    while (!predicate() && Date.now() < deadline) {

        await new Promise((resolve) => setTimeout(resolve, 10));

    }

}

function items(count = TOTAL) {

    return Array.from({ length: count }, (_, index) => ({
        key: `k${index}`,
        label: `item-${index}`,
        value: index,
    }));

}

describe('cli: SelectList windowing', () => {

    it('should keep the cursor on a row it is actually drawing', async () => {

        const { stdin, lastFrame, unmount } = render(
            <FocusProvider>
                <SelectList items={items()} visibleCount={VISIBLE} />
            </FocusProvider>,
        );

        // Well past the old fixed window of fifteen.
        // Driven on the *selected* line, not the frame: a row enters the
        // window several presses before the cursor reaches it, so watching the
        // frame stops the loop early and asserts nothing.
        await pressUntil(stdin, DOWN, () => selectedLine(lastFrame()).includes('item-25'));

        // The invariant: the row the cursor is on is a row that got drawn. The
        // hand-rolled lists failed this — the marker sat on an index outside
        // the slice, so no drawn line carried it and the reader was steering
        // something invisible.
        expect(selectedLine(lastFrame())).toContain('item-25');

        unmount();

    });

    it('should draw no more rows than it was given room for', async () => {

        const { stdin, lastFrame, unmount } = render(
            <FocusProvider>
                <SelectList items={items()} visibleCount={VISIBLE} />
            </FocusProvider>,
        );

        await pressUntil(stdin, DOWN, () => strip(lastFrame()).includes('item-10'));

        // The items, plus at most one indicator line at each end. A list that
        // draws more than this is not clipping, it is pushing the screen's own
        // footer off the bottom.
        expect(strip(lastFrame()).split('\n').length).toBeLessThanOrEqual(VISIBLE + 2);

        unmount();

    });

    it('should leave the first rows reachable after scrolling away from them', async () => {

        const { stdin, lastFrame, unmount } = render(
            <FocusProvider>
                <SelectList items={items()} visibleCount={VISIBLE} />
            </FocusProvider>,
        );

        await pressUntil(stdin, DOWN, () => selectedLine(lastFrame()).includes('item-30'));

        expect(strip(lastFrame())).not.toContain('item-0\n');

        await pressUntil(stdin, UP, () => selectedLine(lastFrame()).includes('item-0'));

        expect(selectedLine(lastFrame())).toContain('item-0');

        unmount();

    });

});

describe('cli: SelectList renderItem', () => {

    it('should draw the custom body in place of the label', async () => {

        const { lastFrame, unmount } = render(
            <FocusProvider>
                <SelectList
                    items={items(3)}
                    visibleCount={VISIBLE}
                    renderItem={(item) => <Text>[OK] custom-{item.value}</Text>}
                />
            </FocusProvider>,
        );

        await waitFor(() => strip(lastFrame()).includes('custom-0'));

        const frame = strip(lastFrame());

        expect(frame).toContain('[OK] custom-0');
        expect(frame).not.toContain('item-0');

        unmount();

    });

    it('should keep the cursor marker even though the caller draws the row', async () => {

        // The list owns the marker so every list in the app marks its selection
        // the same way, and so a caller supplying a body cannot forget one.
        const { stdin, lastFrame, unmount } = render(
            <FocusProvider>
                <SelectList
                    items={items()}
                    visibleCount={VISIBLE}
                    renderItem={(item) => <Text>custom-{item.value}</Text>}
                />
            </FocusProvider>,
        );

        await pressUntil(stdin, DOWN, () => selectedLine(lastFrame()).includes('custom-2'));

        expect(selectedLine(lastFrame())).toContain('custom-2');

        unmount();

    });

    it('should report the highlight that matches the drawn cursor', async () => {

        // The detail box under both history screens is built from this
        // callback. When it disagreed with the window, the box described a
        // record that was not on screen — the same defect seen from the other
        // side, so it is asserted against the drawn row rather than a count.
        const seen: number[] = [];

        const { stdin, lastFrame, unmount } = render(
            <FocusProvider>
                <SelectList
                    items={items()}
                    visibleCount={VISIBLE}
                    onHighlight={(item) => seen.push(item.value)}
                    renderItem={(item) => <Text>custom-{item.value}</Text>}
                />
            </FocusProvider>,
        );

        await pressUntil(stdin, DOWN, () => selectedLine(lastFrame()).includes('custom-7'));

        expect(seen.at(-1)).toBe(7);
        expect(selectedLine(lastFrame())).toContain(`custom-${seen.at(-1)}`);

        unmount();

    });

    it('should still window a custom-bodied list', async () => {

        const { lastFrame, unmount } = render(
            <FocusProvider>
                <SelectList
                    items={items()}
                    visibleCount={VISIBLE}
                    renderItem={(item) => <Text>custom-{item.value}</Text>}
                />
            </FocusProvider>,
        );

        await waitFor(() => strip(lastFrame()).includes('custom-0'));

        const frame = strip(lastFrame());

        expect(frame).not.toContain('custom-39');
        expect(frame).toContain('more');

        unmount();

    });

});
