/**
 * Viewport sizing tests.
 *
 * Every list in the TUI used to carry a hardcoded `visibleCount`, so a 60-row
 * terminal drew the same handful of rows as a 24-row one and the rest of the
 * list was unreachable. These tests pin the replacement: the row budget comes
 * from the terminal, grows when the terminal is taller, and still leaves a
 * usable list when the terminal is tiny.
 *
 * `useWindowSize` reads the render stream first and falls back to the
 * `terminal-size` probe, which reads `process.stdout`. ink-testing-library's
 * stream reports `columns` but no `rows`, so the probe is what decides height
 * here — and left alone it would report whatever terminal the suite happens to
 * run in. Pinning both `process.stdout` dimensions is what makes these
 * assertions the same number on a laptop and in CI.
 */
import { describe, it, expect, afterEach } from 'bun:test';
import { render } from 'ink-testing-library';
import React from 'react';

import { FocusProvider } from '../../../src/tui/focus.js';
import { SelectList, SearchableList } from '../../../src/tui/components/lists/index.js';
import { FilePicker } from '../../../src/tui/components/dialogs/index.js';
import {
    viewportRows,
    SCREEN_CHROME_ROWS,
    MIN_VIEWPORT_ROWS,
} from '../../../src/tui/hooks/useViewportRows.js';

/** Property descriptors to put back, so a pinned size cannot leak to the next file. */
const originalStdout = {
    columns: Object.getOwnPropertyDescriptor(process.stdout, 'columns'),
    rows: Object.getOwnPropertyDescriptor(process.stdout, 'rows'),
};

/**
 * Pin the terminal the next render will see.
 *
 * Both dimensions have to be set: `terminal-size` only trusts `process.stdout`
 * when `columns` and `rows` are both truthy, and falls through to a `tput`
 * probe otherwise.
 */
function pinTerminal(rows: number, columns = 100) {

    Object.defineProperty(process.stdout, 'columns', { value: columns, configurable: true });
    Object.defineProperty(process.stdout, 'rows', { value: rows, configurable: true });

}

/** Items labelled so a rendered row is countable without matching on chrome. */
function items(count: number) {

    return Array.from({ length: count }, (_, index) => ({
        key: `k${index}`,
        label: `row-${index}`,
        value: index,
    }));

}

/** Rendered rows that carry an item label, ignoring borders and scroll hints. */
function renderedRows(frame: string | undefined): number {

    return (frame ?? '').split('\n').filter((line) => line.includes('row-')).length;

}

/** Render a tree at a pinned terminal height and report the rows it drew. */
function rowsAt(height: number, tree: React.ReactElement): number {

    pinTerminal(height);

    const { lastFrame, unmount } = render(<FocusProvider>{tree}</FocusProvider>);
    const count = renderedRows(lastFrame());

    unmount();

    return count;

}

describe('cli: useViewportRows', () => {

    afterEach(() => {

        for (const [key, descriptor] of Object.entries(originalStdout)) {

            if (descriptor) {

                Object.defineProperty(process.stdout, key, descriptor);

            }
            else {

                Reflect.deleteProperty(process.stdout, key);

            }

        }

    });

    describe('viewportRows', () => {

        it('should hand the terminal over once the screen chrome is paid for', () => {

            expect(viewportRows(40)).toBe(40 - SCREEN_CHROME_ROWS);

        });

        it('should charge the caller for rows the screen spends elsewhere', () => {

            expect(viewportRows(40, 6)).toBe(40 - SCREEN_CHROME_ROWS - 6);

        });

        it('should never go below the floor, or negative', () => {

            expect(viewportRows(10)).toBe(MIN_VIEWPORT_ROWS);
            expect(viewportRows(1)).toBe(MIN_VIEWPORT_ROWS);
            expect(viewportRows(24, 100)).toBe(MIN_VIEWPORT_ROWS);

        });

    });

    describe('SelectList', () => {

        it('should draw more rows on a tall terminal than a short one', () => {

            const list = <SelectList items={items(60)} />;

            expect(rowsAt(60, list)).toBeGreaterThan(rowsAt(24, list));

        });

        it('should keep a usable list on a terminal with no room left', () => {

            expect(rowsAt(6, <SelectList items={items(60)} />)).toBeGreaterThanOrEqual(5);

        });

        it('should stop at the number of items it was given', () => {

            expect(rowsAt(60, <SelectList items={items(4)} />)).toBe(4);

        });

    });

    describe('SearchableList', () => {

        it('should draw more rows on a tall terminal than a short one', () => {

            const list = <SearchableList items={items(60)} />;

            expect(rowsAt(60, list)).toBeGreaterThan(rowsAt(24, list));

        });

        it('should leave room for its own search and hint rows', () => {

            const plain = rowsAt(40, <SelectList items={items(60)} />);
            const searchable = rowsAt(40, <SearchableList items={items(60)} />);

            expect(searchable).toBeLessThan(plain);

        });

    });

    describe('FilePicker', () => {

        it('should draw more rows on a tall terminal than a short one', () => {

            const files = Array.from({ length: 60 }, (_, index) => `row-${index}.sql`);
            const picker = <FilePicker files={files} onSelect={() => {}} onCancel={() => {}} />;

            expect(rowsAt(60, picker)).toBeGreaterThan(rowsAt(24, picker));

        });

    });

    describe('resize', () => {

        it('should regrow the list when the terminal is resized taller', async () => {

            pinTerminal(24);

            const { stdout, lastFrame, unmount } = render(
                <FocusProvider><SelectList items={items(60)} /></FocusProvider>,
            );

            const before = renderedRows(lastFrame());

            pinTerminal(60);
            stdout.emit('resize');

            await new Promise((resolve) => setTimeout(resolve, 30));

            const after = renderedRows(lastFrame());

            unmount();

            expect(after).toBeGreaterThan(before);

        });

    });

});
