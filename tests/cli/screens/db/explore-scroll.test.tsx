/**
 * Explore detail vertical-scrolling tests.
 *
 * The detail screen rendered every column, index, and foreign key
 * unconditionally, so a table with more columns than the terminal had rows put
 * the overflow somewhere no key could reach: the screen's only binding was
 * Escape. The contract pinned here is that every row a detail view produces is
 * reachable — by arrow, by page, and by End — and that the viewport never
 * draws more lines than the budget it was given.
 *
 * Rows come from the real `tableDetailRows` builder rather than synthetic
 * placeholders, so the count under test is the count the screen actually
 * renders, section headers and blank separators included.
 */
import { describe, it, expect } from 'bun:test';
import { render } from 'ink-testing-library';
import { Box, Text } from 'ink';
import React from 'react';

import type { ColumnDetail, ParameterDetail, TableDetail } from '../../../../src/core/explore/types.js';

import { Panel } from '../../../../src/tui/components/index.js';
import {
    ScrollView,
    tableDetailRows,
    viewDetailRows,
    procedureDetailRows,
    functionDetailRows,
    typeDetailRows,
} from '../../../../src/tui/screens/db/explore/ExploreDetailScreen.js';
import {
    detailFooterHints,
    pageKeyLabel,
    rowWindow,
    viewportRows,
    wrapText,
} from '../../../../src/tui/screens/db/explore/layout.js';

import type { DetailRow } from '../../../../src/tui/screens/db/explore/layout.js';

/** Row budget inside the explore Panel on a 100-column terminal. */
const WIDE = 96;

/** Viewport height the scrolling cases run at. */
const HEIGHT = 12;

// eslint-disable-next-line no-control-regex -- matching the ANSI SGR escape is the point
const ANSI_PATTERN = /\u001B\[[0-9;]*m/g;

function strip(frame: string | undefined): string {

    return (frame ?? '').replace(ANSI_PATTERN, '');

}

/**
 * Poll rather than sleep a guessed duration: a fixed wait is the suite's known
 * flake class under load.
 */
async function waitFor(predicate: () => boolean, timeoutMs = 2000): Promise<void> {

    const deadline = Date.now() + timeoutMs;

    while (!predicate() && Date.now() < deadline) {

        await new Promise((resolve) => setTimeout(resolve, 10));

    }

}

const KEY = {
    up: '\u001B[A',
    down: '\u001B[B',
    pageUp: '\u001B[5~',
    pageDown: '\u001B[6~',
    home: '\u001B[H',
    end: '\u001B[F',
    ctrlU: '\u0015',
    ctrlD: '\u0004',

    // Kitty's `CSI 1 ; <mods> : <event> <letter>` form, with the super
    // modifier bit (8) encoded as 9. The legacy `CSI 1 ; 9 A` a non-kitty
    // terminal sends for the same chord parses as Alt and never sets
    // `key.super`, which is why this binding stays out of the footer.
    superUp: '\u001B[1;9:1A',
    superDown: '\u001B[1;9:1B',
} as const;

/**
 * Fixed-width names so `col_07` is never a prefix of another row's name and a
 * presence assertion means exactly one row.
 */
function wideTable(columnCount: number): TableDetail {

    const columns: ColumnDetail[] = Array.from({ length: columnCount }, (_, index) => ({
        name: `col_${String(index).padStart(2, '0')}`,
        dataType: 'text',
        isNullable: index % 2 === 0,
        isPrimaryKey: index === 0,
        ordinalPosition: index + 1,
    }));

    return {
        name: 'wide_table',
        schema: 'public',
        columns,
        indexes: [],
        foreignKeys: [],
        rowCountEstimate: 1234,
    };

}

/**
 * Render a scroller and hand back a reader plus a key writer that waits for the
 * frame to actually change before returning.
 */
async function scroller(rows: DetailRow[], height: number) {

    const { stdin, lastFrame, unmount } = render(
        <ScrollView rows={rows} height={height} isFocused />,
    );

    await waitFor(() => strip(lastFrame()).length > 0);

    const press = async (sequence: string, settled: (frame: string) => boolean) => {

        stdin.write(sequence);

        await waitFor(() => settled(strip(lastFrame())));

    };

    return { frame: () => strip(lastFrame()), press, unmount };

}

describe('cli: screens/db/explore scrolling', () => {

    describe('rowWindow', () => {

        it('should show everything and reserve no gutter when the content fits', () => {

            expect(rowWindow(8, 0, 12)).toEqual({ start: 0, count: 8, above: 0, below: 0 });

        });

        it('should hold back both indicator lines once the content overflows', () => {

            expect(rowWindow(40, 0, 12)).toEqual({ start: 0, count: 10, above: 0, below: 30 });

        });

        it('should report what sits above and below the viewport', () => {

            expect(rowWindow(40, 5, 12)).toEqual({ start: 5, count: 10, above: 5, below: 25 });

        });

        it('should clamp an offset that would strand the viewport past the end', () => {

            expect(rowWindow(40, 999, 12)).toEqual({ start: 30, count: 10, above: 30, below: 0 });

        });

        it('should clamp a negative offset to the top', () => {

            expect(rowWindow(40, -5, 12)).toEqual({ start: 0, count: 10, above: 0, below: 30 });

        });

        it('should collapse to no scrolling when the content shrinks under the budget', () => {

            // A resize or a smaller object must not leave the old offset in play.
            expect(rowWindow(3, 30, 12)).toEqual({ start: 0, count: 3, above: 0, below: 0 });

        });

    });

    describe('viewportRows', () => {

        it('should reserve the screen\'s real chrome, not the form screen\'s', () => {

            // Shell header and rule (2), status bar and rule (2), panel border
            // (2), title and its blank line (2), vertical padding (2), the gap
            // above the footer (1), the footer (1).
            expect(viewportRows(40)).toBe(28);

        });

        it('should keep a usable floor on a terminal too short to pay the chrome', () => {

            expect(viewportRows(10)).toBeGreaterThanOrEqual(5);
            expect(viewportRows(1)).toBeGreaterThanOrEqual(5);

        });

    });

    describe('wrapText', () => {

        it('should break on word boundaries and never exceed the width', () => {

            const lines = wrapText('select a, b, c from some_table where id = 1', 12);

            for (const line of lines) {

                expect(line.length).toBeLessThanOrEqual(12);

            }

            expect(lines.join(' ')).toContain('some_table');

        });

        it('should hard-split a token with no break in it', () => {

            const lines = wrapText('a'.repeat(25), 10);

            expect(lines).toHaveLength(3);

        });

        it('should keep blank lines so a definition\'s shape survives', () => {

            expect(wrapText('one\n\ntwo', 40)).toEqual(['one', '', 'two']);

        });

    });

    describe('ScrollView', () => {

        it('should render every row and no indicator when the content fits', async () => {

            const rows = tableDetailRows(wideTable(3), WIDE);
            const view = await scroller(rows, 40);
            const frame = view.frame();

            expect(frame).toContain('col_00');
            expect(frame).toContain('col_02');
            expect(frame).not.toContain('more');
            expect(frame.split('\n').length).toBeLessThanOrEqual(40);

            view.unmount();

        });

        it('should draw no more lines than the height it was budgeted', async () => {

            const rows = tableDetailRows(wideTable(40), WIDE);
            const view = await scroller(rows, HEIGHT);

            expect(rows.length).toBeGreaterThan(HEIGHT);
            expect(view.frame().split('\n').length).toBeLessThanOrEqual(HEIGHT);

            // Mid-scroll is the tallest case: both indicators plus the viewport.
            await view.press(KEY.down, (frame) => frame.includes('col_07'));

            expect(view.frame().split('\n')).toHaveLength(HEIGHT);

            view.unmount();

        });

        it('should mark what is still below the fold', async () => {

            const rows = tableDetailRows(wideTable(40), WIDE);
            const view = await scroller(rows, HEIGHT);
            const frame = view.frame();

            expect(frame).toContain('↓');
            expect(frame).toContain('more');
            expect(frame).not.toContain('↑');

            view.unmount();

        });

        // The regression. Before the fix the detail screen bound Escape and
        // nothing else, so a row below the fold could not be reached at all.
        it('should reach a row past the fold with the down arrow', async () => {

            const rows = tableDetailRows(wideTable(40), WIDE);
            const view = await scroller(rows, HEIGHT);

            expect(view.frame()).not.toContain('col_07');

            await view.press(KEY.down, (frame) => frame.includes('col_07'));

            expect(view.frame()).toContain('col_07');
            expect(view.frame()).toContain('↑');

            view.unmount();

        });

        // The other half of the regression: the far end has to be reachable in
        // one keystroke, not by holding an arrow down forty times.
        it('should reach the last row with End', async () => {

            const rows = tableDetailRows(wideTable(40), WIDE);
            const view = await scroller(rows, HEIGHT);

            expect(view.frame()).not.toContain('col_39');

            await view.press(KEY.end, (frame) => frame.includes('col_39'));

            const frame = view.frame();

            expect(frame).toContain('col_39');
            expect(frame).toContain('↑');
            expect(frame).not.toContain('↓');
            expect(frame.split('\n')).toHaveLength(HEIGHT - 1);

            view.unmount();

        });

        it('should move by a viewport on PageDown and back on PageUp', async () => {

            const rows = tableDetailRows(wideTable(40), WIDE);
            const view = await scroller(rows, HEIGHT);

            await view.press(KEY.pageDown, (frame) => frame.includes('col_16'));

            expect(view.frame()).toContain('col_16');
            expect(view.frame()).not.toContain('col_00');

            await view.press(KEY.pageUp, (frame) => frame.includes('col_00'));

            expect(view.frame()).toContain('col_00');
            expect(view.frame()).not.toContain('↑');

            view.unmount();

        });

        it('should return to the top with Home', async () => {

            const rows = tableDetailRows(wideTable(40), WIDE);
            const view = await scroller(rows, HEIGHT);

            await view.press(KEY.end, (frame) => frame.includes('col_39'));

            // Without this the case passes on a viewport that never moved.
            expect(view.frame()).not.toContain('public.wide_table');

            await view.press(KEY.home, (frame) => frame.includes('wide_table'));

            const frame = view.frame();

            expect(frame).toContain('public.wide_table');
            expect(frame).not.toContain('↑');
            expect(frame).toContain('↓');

            view.unmount();

        });

        it('should step back one row on the up arrow', async () => {

            const rows = tableDetailRows(wideTable(40), WIDE);
            const view = await scroller(rows, HEIGHT);

            await view.press(KEY.end, (frame) => frame.includes('col_39'));
            await view.press(KEY.up, (frame) => !frame.includes('col_39'));

            expect(view.frame()).not.toContain('col_39');
            expect(view.frame()).toContain('col_38');
            expect(view.frame()).toContain('↓');

            view.unmount();

        });

        it('should ignore scroll keys while unfocused', async () => {

            const rows = tableDetailRows(wideTable(40), WIDE);
            const { stdin, lastFrame, unmount } = render(
                <ScrollView rows={rows} height={HEIGHT} isFocused={false} />,
            );

            await waitFor(() => strip(lastFrame()).length > 0);

            stdin.write(KEY.end);
            await new Promise((resolve) => setTimeout(resolve, 50));

            expect(strip(lastFrame())).not.toContain('col_39');

            unmount();

        });

        it('should not strand the viewport past the end when the content shrinks', async () => {

            const rows = tableDetailRows(wideTable(40), WIDE);
            const { stdin, lastFrame, rerender, unmount } = render(
                <ScrollView rows={rows} height={HEIGHT} isFocused />,
            );

            await waitFor(() => strip(lastFrame()).length > 0);

            stdin.write(KEY.end);
            await waitFor(() => strip(lastFrame()).includes('col_39'));

            rerender(<ScrollView rows={tableDetailRows(wideTable(3), WIDE)} height={HEIGHT} isFocused />);
            await waitFor(() => strip(lastFrame()).includes('col_00'));

            const frame = strip(lastFrame());

            expect(frame).toContain('public.wide_table');
            expect(frame).toContain('col_00');
            expect(frame).not.toContain('more');

            unmount();

        });

    });

    /**
     * PageUp/PageDown work on a Mac — fn+↑ and fn+↓ send CSI 5~ and
     * CSI 6~ — but nothing on the keyboard is labelled that way, and ⌘ is
     * swallowed by Terminal.app and iTerm2 before the process ever sees it. So
     * Ctrl+U/Ctrl+D are the paging keys that reach every terminal on every
     * platform, and the platform-native page keys stay bound behind them.
     */
    describe('paging keys', () => {

        it('should move half a viewport on Ctrl+D and back on Ctrl+U', async () => {

            const rows = tableDetailRows(wideTable(40), WIDE);
            const view = await scroller(rows, HEIGHT);

            // Ten drawn rows, so half is five: title, blank, heading, col_00
            // and col_01 scroll off and col_11 arrives.
            await view.press(KEY.ctrlD, (frame) => frame.includes('col_11'));

            expect(view.frame()).toContain('col_11');
            expect(view.frame()).not.toContain('col_01');

            await view.press(KEY.ctrlU, (frame) => frame.includes('col_00'));

            expect(view.frame()).toContain('col_00');
            expect(view.frame()).not.toContain('↑');

            view.unmount();

        });

        it('should page on ⌘+↓ and back on ⌘+↑ under the kitty protocol', async () => {

            const rows = tableDetailRows(wideTable(40), WIDE);
            const view = await scroller(rows, HEIGHT);

            await view.press(KEY.superDown, (frame) => frame.includes('col_16'));

            expect(view.frame()).toContain('col_16');
            expect(view.frame()).not.toContain('col_00');

            await view.press(KEY.superUp, (frame) => frame.includes('col_00'));

            expect(view.frame()).toContain('col_00');

            view.unmount();

        });

        // ⌘+↓ must page, not step one row, and the arrow branch is what it
        // would fall through to if `key.super` were tested after `key.upArrow`.
        it('should not treat ⌘+↓ as a plain down arrow', async () => {

            const rows = tableDetailRows(wideTable(40), WIDE);
            const view = await scroller(rows, HEIGHT);

            await view.press(KEY.superDown, (frame) => frame.includes('↑'));

            // The distance is the tell, not which rows are on screen: a page is
            // ten rows and a step is one, and both leave col_07 visible.
            expect(view.frame()).toContain('↑ 10 more');

            view.unmount();

        });

    });

    /**
     * The footer is the only place these bindings are documented, and it is a
     * single wrapping line, so what it names and how wide it runs are both part
     * of the contract. `fn ↑↓` on a Mac because no Mac keyboard has a key
     * labelled PgUp; ⌘+↑↓ is deliberately absent because it only reaches the
     * process under the kitty protocol.
     */
    describe('footer hints', () => {

        it('should name the Mac page keys on darwin and the PC ones elsewhere', () => {

            expect(pageKeyLabel('darwin')).toBe('fn ↑↓');
            expect(pageKeyLabel('linux')).toBe('PgUp/PgDn');
            expect(pageKeyLabel('win32')).toBe('PgUp/PgDn');

        });

        it('should build a footer that names the platform\'s own page keys', () => {

            const mac = detailFooterHints({ scrolls: true, overlay: 'none', platform: 'darwin' });
            const pc = detailFooterHints({ scrolls: true, overlay: 'none', platform: 'linux' });

            expect(mac).toContain('[fn ↑↓] Page');
            expect(mac.join(' ')).not.toContain('PgUp');

            expect(pc).toContain('[PgUp/PgDn] Page');
            expect(pc.join(' ')).not.toContain('fn ');

        });

        it('should advertise Ctrl+U/Ctrl+D and never ⌘, which most terminals eat', () => {

            for (const platform of ['darwin', 'linux'] as const) {

                const hints = detailFooterHints({ scrolls: true, overlay: 'none', platform });

                expect(hints).toContain('[^U/^D] Half');
                expect(hints.join(' ')).not.toContain('⌘');

            }

        });

        it('should offer the full-text view whether or not the detail scrolls', () => {

            const scrolling = detailFooterHints({ scrolls: true, overlay: 'none', platform: 'darwin' });
            const fitting = detailFooterHints({ scrolls: false, overlay: 'none', platform: 'darwin' });

            expect(scrolling).toContain('[v] Full text');
            expect(fitting).toContain('[v] Full text');

            // A detail that fits has nothing to scroll, so it says so.
            expect(fitting.join(' ')).not.toContain('Scroll');

        });

        it('should swap to the overlay\'s own keys while the full-text view is open', () => {

            const hints = detailFooterHints({ scrolls: true, overlay: 'fullText', platform: 'darwin' });

            expect(hints).toContain('[Esc] Close');
            expect(hints.join(' ')).not.toContain('[v]');
            expect(hints.join(' ')).not.toContain('Back');

        });

        // Adding hints without removing any would push the wrap point up from
        // the 58 columns it already sits at. The Home/End hint went to pay for
        // the two that arrived.
        it('should stay inside one line of an 80-column terminal', () => {

            for (const platform of ['darwin', 'linux'] as const) {

                const width = detailFooterHints({ scrolls: true, overlay: 'none', platform })
                    .join('  ').length;

                expect(width).toBeLessThanOrEqual(80);

            }

        });

    });

    describe('chrome accounting', () => {

        /**
         * A stand-in for the shell the screen renders inside, with the same Box
         * props `AppShell` gives its header and status bar. Mirrored rather than
         * imported because `AppShell` drags in every provider; if that structure
         * changes, `DETAIL_CHROME_ROWS` changes with it and this case is where
         * the two are compared.
         */
        function shell(terminalRows: number, rows: DetailRow[]) {

            return (
                <Box flexDirection="column" height={terminalRows}>
                    <Box
                        borderStyle="single"
                        borderBottom
                        borderTop={false}
                        borderLeft={false}
                        borderRight={false}
                        paddingX={1}
                    >
                        <Text>DB › Explore › Table</Text>
                    </Box>
                    <Box flexDirection="column" flexGrow={1}>
                        <Box flexDirection="column" gap={1}>
                            <Panel title="Table" paddingX={1} paddingY={1}>
                                <ScrollView rows={rows} height={viewportRows(terminalRows)} isFocused />
                            </Panel>
                            <Box flexWrap="wrap" columnGap={2}>
                                <Text dimColor>[↑↓] Scroll</Text>
                                <Text dimColor>[PgUp/PgDn] Page</Text>
                                <Text dimColor>[Home/End] Jump</Text>
                                <Text dimColor>[Esc] Back</Text>
                            </Box>
                        </Box>
                    </Box>
                    <Box
                        borderStyle="single"
                        borderTop
                        borderBottom={false}
                        borderLeft={false}
                        borderRight={false}
                    >
                        <Text>STATUS</Text>
                    </Box>
                </Box>
            );

        }

        it('should leave the footer and the status bar on screen at every scroll position', async () => {

            const rows = tableDetailRows(wideTable(60), WIDE);
            const { stdin, lastFrame, unmount } = render(shell(30, rows));

            await waitFor(() => strip(lastFrame()).includes('STATUS'));

            expect(strip(lastFrame()).split('\n')).toHaveLength(30);
            expect(strip(lastFrame())).toContain('[Esc] Back');

            // Mid-scroll draws both indicators, which is the tallest the panel
            // ever gets. If the reserve were a row short, this is where the
            // status bar would be pushed off.
            stdin.write(KEY.pageDown);
            await waitFor(() => strip(lastFrame()).includes('↑'));

            const frame = strip(lastFrame());

            expect(frame.split('\n')).toHaveLength(30);
            expect(frame).toContain('STATUS');
            expect(frame).toContain('[Esc] Back');

            unmount();

        });

    });

    describe('tableDetailRows', () => {

        it('should emit one element per visual line', async () => {

            const detail = wideTable(4);
            const rows = tableDetailRows(detail, WIDE);
            const view = await scroller(rows, 40);

            expect(view.frame().split('\n')).toHaveLength(rows.length);

            view.unmount();

        });

        it('should carry the header, the section title, and every column', () => {

            const rows = tableDetailRows(wideTable(4), WIDE);

            // header + blank + section title + 4 columns
            expect(rows).toHaveLength(7);

        });

        it('should separate indexes and foreign keys into their own sections', () => {

            const detail = wideTable(2);

            detail.indexes = [
                { name: 'wide_table_pkey', tableName: 'wide_table', columns: ['col_00'], isUnique: true, isPrimary: true },
            ];
            detail.foreignKeys = [
                {
                    name: 'wide_table_col_01_fkey',
                    tableName: 'wide_table',
                    columns: ['col_01'],
                    referencedTable: 'other',
                    referencedColumns: ['id'],
                },
            ];

            const rows = tableDetailRows(detail, WIDE);

            // header, blank, Columns, 2 columns, blank, Indexes, 1 index,
            // blank, Foreign Keys, 2 lines for the one key.
            expect(rows).toHaveLength(12);

        });

    });

    /**
     * Only the table view was exercised above, and it is the one with no
     * definition dump. These cover the other four: the row count each builder
     * claims has to be the number of lines Ink actually draws, or the viewport
     * windows to the wrong place.
     */
    describe('the other four detail views', () => {

        const parameters: ParameterDetail[] = [
            { name: 'p_tenant', dataType: 'uuid', mode: 'IN', ordinalPosition: 1 },
            { name: 'p_from', dataType: 'timestamp with time zone', mode: 'IN', ordinalPosition: 2 },
        ];

        const definition = `select ${'col_a, '.repeat(80)}col_z from some_table`;

        async function linesDrawn(rows: DetailRow[]): Promise<number> {

            const view = await scroller(rows, rows.length + 10);
            const drawn = view.frame().split('\n').length;

            view.unmount();

            return drawn;

        }

        it('should count a view\'s rows, wrapped definition included', async () => {

            const rows = viewDetailRows({
                name: 'active_users',
                schema: 'public',
                columns: [{ name: 'id', dataType: 'bigint', isNullable: false, isPrimaryKey: true, ordinalPosition: 1 }],
                definition,
                isUpdatable: false,
            }, WIDE);

            expect(await linesDrawn(rows)).toBe(rows.length);
            expect(rows.length).toBeGreaterThan(6);

        });

        it('should count a procedure\'s rows', async () => {

            const rows = procedureDetailRows({
                name: 'rebuild_index',
                schema: 'public',
                parameters,
                definition,
            }, WIDE);

            expect(await linesDrawn(rows)).toBe(rows.length);

        });

        it('should count a function\'s rows', async () => {

            const rows = functionDetailRows({
                name: 'tenant_rows',
                schema: 'public',
                parameters,
                returnType: 'integer',
                definition,
            }, WIDE);

            expect(await linesDrawn(rows)).toBe(rows.length);

        });

        it('should count an enum type\'s rows and scroll a long one', async () => {

            const values = Array.from({ length: 40 }, (_, index) => `value_${String(index).padStart(2, '0')}`);
            const rows = typeDetailRows({ name: 'status', schema: 'public', kind: 'enum', values }, WIDE);

            // header, blank, Values (40), 40 values
            expect(rows).toHaveLength(43);
            expect(await linesDrawn(rows)).toBe(rows.length);

            const view = await scroller(rows, HEIGHT);

            expect(view.frame()).not.toContain('value_39');

            await view.press(KEY.end, (frame) => frame.includes('value_39'));

            expect(view.frame()).toContain('value_39');

            view.unmount();

        });

        it('should count a composite and a domain type\'s rows', async () => {

            const composite = typeDetailRows({
                name: 'address',
                schema: 'public',
                kind: 'composite',
                attributes: [
                    { name: 'street', dataType: 'text', isNullable: true, isPrimaryKey: false, ordinalPosition: 1 },
                    { name: 'zip', dataType: 'text', isNullable: true, isPrimaryKey: false, ordinalPosition: 2 },
                ],
            }, WIDE);

            const domain = typeDetailRows({
                name: 'email',
                schema: 'public',
                kind: 'domain',
                baseType: 'text',
            }, WIDE);

            expect(composite).toHaveLength(5);
            expect(await linesDrawn(composite)).toBe(composite.length);

            expect(domain).toHaveLength(4);
            expect(await linesDrawn(domain)).toBe(domain.length);

        });

    });

});
