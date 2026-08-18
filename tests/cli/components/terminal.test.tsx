/**
 * Terminal component tests.
 *
 * `ResultTable` is the one grid in the app: the SQL terminal, the SQL history
 * screen and the explore row peek all draw through it. What is pinned here:
 *
 * - **A wide result is chopped, not crammed.** Ink shrinks flex items, so a row
 *   wider than the terminal squeezes every cell at once rather than overflowing
 *   — `select * from ai_usage` produced headers reading `ai_u`/`sage` and ids
 *   reading `1283`/`2`. The fit keeps whole columns and reports the rest.
 * - **Chopping does not cost density.** The width a column asks for comes from
 *   its own values, so a dozen narrow columns still all fit. A fit that gave
 *   every column the same width would show five of them.
 * - **Cells are formatted through `documentValue`.** `JSON.stringify` renders a
 *   `Buffer` as its wrapper and a `Date` as a quoted string, and the width
 *   allocator then spends real columns on both.
 * - **Enter opens a row**, which is the only thing that makes dropping columns
 *   acceptable, and the cursor survives the round trip.
 *
 * The suite runs at `FORCE_COLOR=0`, so nothing here may assert on an SGR
 * escape: where the cursor is has to be read from something the row viewer
 * prints, not from the inverse attribute.
 */
import { describe, it, expect } from 'bun:test';
import { render } from 'ink-testing-library';
import React from 'react';

import { FocusProvider } from '../../../src/tui/focus.js';
import { ResultBrowser, ResultTable } from '../../../src/tui/components/terminal/index.js';

/** Columns the ink-testing-library terminal reports. */
const TERMINAL_COLUMNS = 100;

/**
 * A line only the grid prints.
 *
 * `col_00` shows up in the grid and in the document both, so waiting on it
 * after Escape returns while the document is still up — a wait that cannot fail
 * is worse than no wait at all.
 */
const GRID_MARKER = '[/] Filter';

/**
 * Give Ink a tick to register its useInput handler, and another to flush the
 * frame that the keystroke produced.
 */
const tick = () => new Promise((resolve) => setTimeout(resolve, 50));

async function waitFor(predicate: () => boolean, timeoutMs = 2000): Promise<void> {

    const deadline = Date.now() + timeoutMs;

    while (!predicate() && Date.now() < deadline) {

        await new Promise((resolve) => setTimeout(resolve, 10));

    }

}

const KEY = {
    down: '[B',
    right: '[C',
    enter: '\r',
    escape: '',
    filter: '/',
    format: 'f',
} as const;

/**
 * Wait until the grid's own input handler is listening.
 *
 * Ink registers `useInput` in an effect, which runs after the frame it belongs
 * to is painted, so polling the frame is not enough on its own: a keystroke
 * written the moment the grid appears lands before anything is subscribed and
 * is lost. This presses a key until its effect shows up, which is the same
 * poll-for-the-condition discipline a fixed sleep would skip.
 *
 * `/` is the probe because filter mode announces itself in the status bar, and
 * because Escape out of it clears whatever the probe typed.
 */
async function settleGrid(
    stdin: { write: (data: string) => void },
    frame: () => string,
): Promise<void> {

    const deadline = Date.now() + 2000;

    while (!frame().includes('[Tab] Column') && Date.now() < deadline) {

        stdin.write(KEY.filter);

        await new Promise((resolve) => setTimeout(resolve, 20));

    }

    stdin.write(KEY.escape);

    await waitFor(() => !frame().includes('[Tab] Column'));

}

/**
 * Wait until the row document viewer's own focus scope is live.
 *
 * Same reason as `settleGrid`, one level deeper: `useFocusScope` pushes onto
 * the stack in an effect too. `f` is the probe because what it changes is in
 * the header rather than in the document, and because pressing it twice puts
 * the remembered format back where it started.
 */
async function settleRowView(
    stdin: { write: (data: string) => void },
    frame: () => string,
): Promise<void> {

    const start = frame().includes('[f] JSON') ? '[f] JSON' : '[f] YAML';
    const flipped = start === '[f] JSON' ? '[f] YAML' : '[f] JSON';

    const deadline = Date.now() + 2000;

    while (!frame().includes(flipped) && Date.now() < deadline) {

        stdin.write(KEY.format);

        await new Promise((resolve) => setTimeout(resolve, 20));

    }

    stdin.write(KEY.format);

    await waitFor(() => frame().includes(start));

}

/** `count` column names, `col_00` upward, so ordinal position reads off the name. */
function many(count: number): string[] {

    return Array.from({ length: count }, (_, index) => `col_${String(index).padStart(2, '0')}`);

}

/** One row whose every cell is `width` characters of its own column's name. */
function wideRow(columns: string[], width: number): Record<string, unknown> {

    const row: Record<string, unknown> = {};

    for (const column of columns) row[column] = column.padEnd(width, '-');

    return row;

}

describe('cli: components/terminal', () => {

    describe('ResultTable filtering', () => {

        const columns = ['name'];
        const rows = [{ name: 'alice' }, { name: 'bob' }];

        it('should erase a filter character when Backspace is pressed', async () => {

            // Terminals send 0x7F for the physical Backspace key. Ink 6.8.0
            // reported that as key.delete, so ResultTable's key.backspace guard
            // never fired and the filter term could not be corrected. Ink 7
            // reports it as key.backspace. This pins that mapping: if it ever
            // inverts again, filter-mode editing silently dies.
            const { stdin, lastFrame, unmount } = render(
                <ResultTable columns={columns} rows={rows} active={true} />,
            );

            await tick();
            stdin.write('/');
            await tick();
            stdin.write('ali');
            await tick();

            expect(lastFrame()).toContain('"ali"');

            stdin.write('\x7F');
            await tick();

            expect(lastFrame()).toContain('"al"');

            unmount();

        });

        it('should match a value in a column too far right to be drawn', async () => {

            // The fit decides what is drawn, not what exists. A reader filtering
            // for a value they know is in the result should find its row whether
            // or not that column made the cut, because the row view will show it.
            const names = many(20);
            const first = wideRow(names, 18);
            const second = wideRow(names, 18);

            second['col_19'] = 'needle';

            const { stdin, lastFrame, unmount } = render(
                <ResultTable columns={names} rows={[first, second]} autoSort={false} active={true} />,
            );

            await tick();

            expect(lastFrame()).not.toContain('col_19');

            stdin.write('/');
            await tick();
            stdin.write('needle');
            await waitFor(() => Boolean(lastFrame()?.includes('filtered from 2')));

            expect(lastFrame()).toContain('1 row (filtered from 2)');

            unmount();

        });

    });

    describe('ResultTable column fit', () => {

        it('should drop the columns that do not fit rather than squeeze them all', async () => {

            const names = many(15);

            const { lastFrame, unmount } = render(
                <ResultTable columns={names} rows={[wideRow(names, 20)]} autoSort={false} active={true} />,
            );

            await waitFor(() => Boolean(lastFrame()?.includes('col_00')));

            const frame = lastFrame() ?? '';
            const lines = frame.split('\n');
            const rule = lines.findIndex((line) => line.startsWith('─'));

            // Five whole columns at sixteen, not fifteen at four. Asserting on
            // the header line rather than on the frame is the point: squeezing
            // fifteen columns into the row also removes the string `col_05`,
            // because it truncates it to `col`, so a frame-wide `not.toContain`
            // passes on exactly the bug it was written for.
            expect(lines[rule - 1]).toContain('col_00');
            expect(lines[rule - 1]).toContain('col_04');
            expect(lines[rule - 1]).not.toContain('col_05');
            expect(frame).toContain('… 10 more columns');

            // One line per row. Squeezing wrapped every cell, which is what
            // doubled the height of the grid and broke values mid-value.
            const blank = lines.indexOf('', rule + 1);

            expect(lines.slice(rule + 1, blank)).toHaveLength(1);

            for (const line of lines) {

                expect(line.length).toBeLessThanOrEqual(TERMINAL_COLUMNS);

            }

            unmount();

        });

        it('should keep every column when the values are narrow enough', async () => {

            // Eleven six-character headers fit at their natural width. A fit
            // that gave every column the same readable width would show five of
            // them and hide six, which is the regression this guards.
            const names = many(11);

            const { lastFrame, unmount } = render(
                <ResultTable columns={names} rows={[wideRow(names, 3)]} autoSort={false} active={true} />,
            );

            await waitFor(() => Boolean(lastFrame()?.includes('col_00')));

            const frame = lastFrame() ?? '';

            expect(frame).toContain('col_10');
            expect(frame).not.toContain('more column');

            unmount();

        });

        it('should draw one column even when it alone overflows the row', async () => {

            const { lastFrame, unmount } = render(
                <ResultTable
                    columns={['a_single_extremely_wide_column']}
                    rows={[{ a_single_extremely_wide_column: 'x'.repeat(400) }]}
                    autoSort={false}
                    active={true}
                />,
            );

            await waitFor(() => Boolean(lastFrame()?.includes('1 row')));

            const frame = lastFrame() ?? '';

            expect(frame).toContain('xxxx');
            expect(frame).not.toContain('more column');

            for (const line of frame.split('\n')) {

                expect(line.length).toBeLessThanOrEqual(TERMINAL_COLUMNS);

            }

            unmount();

        });

        it('should offer the row view in the marker only when a row can be opened', async () => {

            const names = many(15);

            const plain = render(
                <ResultTable columns={names} rows={[wideRow(names, 20)]} autoSort={false} active={true} />,
            );

            await waitFor(() => Boolean(plain.lastFrame()?.includes('more columns')));

            expect(plain.lastFrame()).not.toContain('[↵]');

            plain.unmount();

            const openable = render(
                <ResultTable
                    columns={names}
                    rows={[wideRow(names, 20)]}
                    autoSort={false}
                    active={true}
                    onSelect={() => {}}
                />,
            );

            await waitFor(() => Boolean(openable.lastFrame()?.includes('more columns')));

            expect(openable.lastFrame()).toContain('[↵] on a row shows them all');
            expect(openable.lastFrame()).toContain('[↵] Open row');

            openable.unmount();

        });

    });

    describe('ResultTable cell formatting', () => {

        async function cell(value: unknown, column = 'v') {

            const { lastFrame, unmount } = render(
                <ResultTable columns={[column]} rows={[{ [column]: value }]} autoSort={false} active={true} />,
            );

            await waitFor(() => Boolean(lastFrame()?.includes('1 row')));

            const frame = lastFrame() ?? '';

            unmount();

            return frame;

        }

        it('should summarise a Buffer instead of dumping its JSON wrapper', async () => {

            const frame = await cell(Buffer.from([0x00, 0xff]));

            expect(frame).toContain('<binary 2 bytes 0x00ff>');
            expect(frame).not.toContain('"type"');
            expect(frame).not.toContain('Buffer"');

        });

        it('should summarise the Uint8Array bun:sqlite returns for the same column', async () => {

            // Three of the four drivers return a Buffer here and bun:sqlite
            // returns a plain Uint8Array, so a Buffer.isBuffer check would miss
            // exactly the dialect the CLI ships with by default.
            const frame = await cell(new Uint8Array([0x00, 0xff]));

            expect(frame).toContain('<binary 2 bytes 0x00ff>');

        });

        it('should render a Date as a bare timestamp, not a quoted string', async () => {

            const frame = await cell(new Date('2024-03-01T12:34:56.789Z'));

            expect(frame).toContain('2024-03-01T12:34:56.789Z');
            expect(frame).not.toContain('"2024-03-01');

        });

        it('should survive the invalid Date mysql returns for a zero date', async () => {

            // `toISOString()` throws on this one, which would take the whole
            // screen down rather than one cell.
            const frame = await cell(new Date('0000-00-00'));

            expect(frame).toContain('<invalid date>');

        });

        it('should render a bigint rather than throwing on it', async () => {

            const frame = await cell(9007199254740993n);

            expect(frame).toContain('9007199254740993');

        });

        it('should normalise values nested inside a json column', async () => {

            const frame = await cell([Buffer.from([0x01])]);

            expect(frame).toContain('<binary 1 byte 0x01>');
            expect(frame).not.toContain('"type"');

        });

        it('should keep NULL and the empty string apart', async () => {

            expect(await cell(null)).toContain('NULL');
            expect(await cell('')).not.toContain('NULL');

        });

    });

    describe('ResultBrowser', () => {

        const names = many(20);

        function browser(rows: Record<string, unknown>[], props: Partial<React.ComponentProps<typeof ResultBrowser>> = {}) {

            const view = render(
                <FocusProvider>
                    <ResultBrowser
                        columns={names}
                        rows={rows}
                        height={30}
                        autoSort={false}
                        active={true}
                        {...props}
                    />
                </FocusProvider>,
            );

            return { ...view, frame: () => view.lastFrame() ?? '' };

        }

        /** Three rows whose hidden last column identifies which row it is. */
        function rowsOf(count: number): Record<string, unknown>[] {

            return Array.from({ length: count }, (_, index) => {

                const row = wideRow(names, 18);

                row['col_00'] = `row-${index}`;
                row['col_19'] = `tail-${index}`;

                return row;

            });

        }

        it('should open the cursor row as a document showing a dropped column', async () => {

            const view = browser(rowsOf(3));

            await waitFor(() => view.frame().includes(GRID_MARKER));
            await settleGrid(view.stdin, view.frame);

            expect(view.frame()).not.toContain('tail-0');

            view.stdin.write(KEY.enter);
            await waitFor(() => view.frame().includes('row 1 of 3'));

            expect(view.frame()).toContain('col_19: tail-0');

            view.unmount();

        });

        it('should open the row the arrows moved to, not the first one', async () => {

            // One visible row, so the scroll indicator is what says the cursor
            // moved. Nothing else does: at FORCE_COLOR=0 the inverse attribute
            // the cursor is drawn with is not in the frame, so a fixed sleep
            // here would be a guess with no condition behind it.
            const view = browser(rowsOf(3), { maxVisibleRows: 1 });

            await waitFor(() => view.frame().includes(GRID_MARKER));
            await settleGrid(view.stdin, view.frame);

            view.stdin.write(KEY.down);
            await waitFor(() => view.frame().includes('1 more above'));

            view.stdin.write(KEY.enter);
            await waitFor(() => view.frame().includes('row 2 of 3'));

            expect(view.frame()).toContain('col_19: tail-1');

            view.unmount();

        });

        it('should leave the grid cursor where the row viewer left it', async () => {

            // Escape has to land on the row the reader was reading, not on the
            // one they opened, so the cursor the viewer moved is the same
            // cursor the grid draws. Re-opening is how that is read back.
            const view = browser(rowsOf(3));

            await waitFor(() => view.frame().includes(GRID_MARKER));
            await settleGrid(view.stdin, view.frame);

            view.stdin.write(KEY.enter);
            await waitFor(() => view.frame().includes('row 1 of 3'));
            await settleRowView(view.stdin, view.frame);

            view.stdin.write(KEY.right);
            await waitFor(() => view.frame().includes('row 2 of 3'));

            view.stdin.write(KEY.escape);
            await waitFor(() => view.frame().includes(GRID_MARKER));

            view.stdin.write(KEY.enter);
            await waitFor(() => view.frame().includes('row 2 of 3'));

            expect(view.frame()).toContain('col_19: tail-1');

            view.unmount();

        });

        it('should stop the row viewer at the end of the list', async () => {

            const view = browser(rowsOf(2));

            await waitFor(() => view.frame().includes(GRID_MARKER));
            await settleGrid(view.stdin, view.frame);

            view.stdin.write(KEY.enter);
            await waitFor(() => view.frame().includes('row 1 of 2'));
            await settleRowView(view.stdin, view.frame);

            view.stdin.write(KEY.right);
            await waitFor(() => view.frame().includes('row 2 of 2'));

            view.stdin.write(KEY.right);
            await waitFor(() => false, 150);

            expect(view.frame()).toContain('row 2 of 2');

            view.unmount();

        });

        it('should keep the grid mounted while a row is open, filter and all', async () => {

            const view = browser(rowsOf(3));

            await waitFor(() => view.frame().includes(GRID_MARKER));
            await settleGrid(view.stdin, view.frame);

            view.stdin.write(KEY.filter);
            await waitFor(() => view.frame().includes('[Tab] Column'));

            view.stdin.write('row-1');
            await waitFor(() => view.frame().includes('filtered from 3'));

            view.stdin.write(KEY.enter);
            await waitFor(() => !view.frame().includes('[Tab] Column'));

            // Enter applied the filter rather than opening a row: the filter box
            // owns its own Enter.
            expect(view.frame()).not.toContain('row 1 of');

            view.stdin.write(KEY.enter);
            await waitFor(() => view.frame().includes('row 1 of 1'));

            // The viewer walks the list as displayed, so the one filtered row is
            // the whole list.
            expect(view.frame()).toContain('col_19: tail-1');

            view.stdin.write(KEY.escape);
            await waitFor(() => view.frame().includes(GRID_MARKER));

            expect(view.frame()).toContain('filtered from 3');

            view.unmount();

        });

        it('should close an open row and reset the cursor when a new result arrives', async () => {

            const view = browser(rowsOf(3), { maxVisibleRows: 1 });

            await waitFor(() => view.frame().includes(GRID_MARKER));
            await settleGrid(view.stdin, view.frame);

            view.stdin.write(KEY.down);
            await waitFor(() => view.frame().includes('1 more above'));

            view.stdin.write(KEY.enter);
            await waitFor(() => view.frame().includes('row 2 of 3'));

            view.rerender(
                <FocusProvider>
                    <ResultBrowser
                        columns={names}
                        rows={rowsOf(4)}
                        maxVisibleRows={1}
                        height={30}
                        autoSort={false}
                        active={true}
                    />
                </FocusProvider>,
            );

            await waitFor(() => view.frame().includes('4 rows'));

            expect(view.frame()).not.toContain('row 2 of');

            view.stdin.write(KEY.enter);
            await waitFor(() => view.frame().includes('row 1 of 4'));

            view.unmount();

        });

        it('should tell the caller when a row opens and when it closes', async () => {

            const states: boolean[] = [];
            const view = browser(rowsOf(2), { onRowOpenChange: (open) => states.push(open) });

            await waitFor(() => view.frame().includes(GRID_MARKER));
            await settleGrid(view.stdin, view.frame);

            view.stdin.write(KEY.enter);
            await waitFor(() => view.frame().includes('row 1 of 2'));
            await settleRowView(view.stdin, view.frame);

            view.stdin.write(KEY.escape);
            await waitFor(() => view.frame().includes(GRID_MARKER));

            expect(states.filter((state) => state)).toHaveLength(1);
            expect(states[states.length - 1]).toBe(false);

            view.unmount();

        });

    });

});
