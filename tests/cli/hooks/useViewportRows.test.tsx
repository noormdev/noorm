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

        // The `↑ N more` / `↓ N more` lines are rows too. Left out of the
        // budget, a scrolled list drew two rows past it and pushed the screen's
        // hotkey footer off the bottom of the terminal.
        it('should fit its scroll indicators inside the budget while scrolled', async () => {

            pinTerminal(30);

            const { stdin, lastFrame, unmount } = render(
                <FocusProvider><SelectList items={items(60)} /></FocusProvider>,
            );

            // Press until the window has scrolled off both ends, polling rather
            // than betting on a fixed sleep for focus and each repaint.
            const scrolled = () => /↑ \d+ more/.test(lastFrame() ?? '') && /↓ \d+ more/.test(lastFrame() ?? '');
            const deadline = Date.now() + 2000;

            while (!scrolled() && Date.now() < deadline) {

                stdin.write('\u001B[B');
                await new Promise((resolve) => setTimeout(resolve, 10));

            }

            const frame = lastFrame() ?? '';
            unmount();

            expect(frame).toMatch(/↑ \d+ more/);
            expect(frame).toMatch(/↓ \d+ more/);
            expect(frame.split('\n').length).toBeLessThanOrEqual(viewportRows(30));

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

        it('should draw no more lines than the budget, search row and scroll indicators included', () => {

            pinTerminal(30);

            const { lastFrame, unmount } = render(
                <FocusProvider><SearchableList items={items(60)} /></FocusProvider>,
            );
            const frame = lastFrame() ?? '';
            unmount();

            expect(frame).toMatch(/↓ \d+ more/);
            expect(frame.split('\n').length).toBeLessThanOrEqual(viewportRows(30));

        });

    });

    describe('FilePicker', () => {

        it('should draw more rows on a tall terminal than a short one', () => {

            const files = Array.from({ length: 60 }, (_, index) => `row-${index}.sql`);
            const picker = <FilePicker files={files} onSelect={() => {}} onCancel={() => {}} />;

            expect(rowsAt(60, picker)).toBeGreaterThan(rowsAt(24, picker));

        });

        // The picker brings its own Panel and help line, so the whole frame has
        // to fit what the shell leaves: the terminal less the breadcrumb, the
        // status bar and their two rules.
        it('should fit the terminal, scroll indicator included', () => {

            pinTerminal(30);

            const files = Array.from({ length: 60 }, (_, index) => `row-${index}.sql`);
            const { lastFrame, unmount } = render(
                <FocusProvider><FilePicker files={files} onSelect={() => {}} onCancel={() => {}} /></FocusProvider>,
            );
            const frame = lastFrame() ?? '';
            unmount();

            expect(frame).toMatch(/↓ \d+ more/);
            expect(frame.split('\n').length).toBeLessThanOrEqual(30 - 4);

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
