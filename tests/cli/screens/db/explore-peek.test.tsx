/**
 * Explore detail row-peek tests.
 *
 * The detail screen describes a table and never shows a row of it, so the only
 * way to see what is in one was to leave for the SQL terminal and write the
 * query by hand. `p` is that query.
 *
 * What is pinned here:
 *
 * - `p` opens the peek and Escape puts the reader back on the same line of the
 *   detail they left, which is the contract the full-text overlay already
 *   honours and the reason both overlays swap inside `ScrollView` rather than
 *   above it.
 * - The three shapes a peek can come back in each read as what they are: two
 *   ends, one whole table, or a head with no tail and a reason why.
 * - The rows stay in the order the query put them in. `ResultTable` re-sorts by
 *   whatever column looks like an id unless told not to, which would silently
 *   replace "first ten by primary key" with "ten rows, sorted by something".
 * - Nothing reaches the database until `p` is pressed.
 */
import { describe, it, expect } from 'bun:test';
import { render } from 'ink-testing-library';
import { Text } from 'ink';
import React from 'react';

import type { ColumnDetail, TableDetail } from '../../../../src/core/explore/types.js';
import type { ConfigAccess } from '../../../../src/core/policy/index.js';
import type { DetailRow } from '../../../../src/tui/screens/db/explore/layout.js';

import { FocusProvider } from '../../../../src/tui/focus.js';
import {
    ScrollView,
    tableDetailRows,
} from '../../../../src/tui/screens/db/explore/ExploreDetailScreen.js';
import {
    RowPeekOverlay,
    peekPageSize,
    setRows,
} from '../../../../src/tui/screens/db/explore/RowPeekOverlay.js';
import { fitPeekColumns } from '../../../../src/tui/components/terminal/index.js';
import { detailFooterHints } from '../../../../src/tui/screens/db/explore/layout.js';
import { createRecordingDb } from '../../../core/explore/recording-db.js';

/** Row budget inside the explore Panel on the 100-column test terminal. */
const WIDE = 96;

/** Viewport height the overlay cases run at: tall enough for two sets. */
const HEIGHT = 30;

/**
 * A viewport whose page size works out to exactly `PAGE` rows.
 *
 * The page is derived from the height, so a case that needs the tail query to
 * run at all has to supply a head of exactly that many rows — a shorter page is
 * the whole table and the second query never fires. Pinning the height is what
 * keeps those fixtures three rows long instead of eight.
 */
const PAGE_HEIGHT = 19;

/** Rows per set at `PAGE_HEIGHT`. */
const PAGE = 3;

/** The overlay's own header, so no case can pass on an overlay that never opened. */
const PEEK_HEADER = 'Rows ·';

const OPEN: ConfigAccess = { user: 'admin', agent: 'admin' };

const GATE = { configName: 'test', access: OPEN, channel: 'user' } as const;

// eslint-disable-next-line no-control-regex -- matching the ANSI SGR escape is the point
const ANSI_PATTERN = /\u001B\[[0-9;]*m/g;

function strip(frame: string | undefined): string {

    return (frame ?? '').replace(ANSI_PATTERN, '');

}

async function waitFor(predicate: () => boolean, timeoutMs = 2000): Promise<void> {

    const deadline = Date.now() + timeoutMs;

    while (!predicate() && Date.now() < deadline) {

        await new Promise((resolve) => setTimeout(resolve, 10));

    }

}

const KEY = {
    end: '\u001B[F',
    escape: '\u001B',
    peek: 'r',
    value: 'v',
} as const;

function column(name: string, overrides: Partial<ColumnDetail> = {}): ColumnDetail {

    return {
        name,
        dataType: 'text',
        isNullable: true,
        isPrimaryKey: false,
        ordinalPosition: 1,
        ...overrides,
    };

}

/**
 * A table whose primary key is `id` and whose other column is `created_at`.
 *
 * `created_at` is the load-bearing part: it is exactly the column name
 * `ResultTable` auto-sorts on, descending, so a peek that forgot to switch that
 * off would show the newest row first under a heading that says "first".
 */
function usersTable(overrides: Partial<TableDetail> = {}): TableDetail {

    return {
        name: 'users',
        schema: 'public',
        columns: [
            column('id', { isPrimaryKey: true, ordinalPosition: 1, isNullable: false }),
            column('created_at', { ordinalPosition: 2 }),
        ],
        indexes: [],
        foreignKeys: [],
        ...overrides,
    };

}

/** Rows keyed by id, oldest first, so an auto-sort would visibly reverse them. */
function rows(ids: number[]): Record<string, unknown>[] {

    return ids.map((id) => ({ id, created_at: `2024-01-${String(id).padStart(2, '0')}` }));

}

interface PeekOptions {
    detail?: TableDetail;
    head?: Record<string, unknown>[];
    tail?: Record<string, unknown>[];
    error?: Error;
    gate?: typeof GATE | { configName: string; access: ConfigAccess; channel: 'user' | 'agent' };
    height?: number;
    until?: (frame: string) => boolean;
}

/**
 * A recording connection answering the peek's queries.
 *
 * Rules match on the compiled SQL. A table with a key produces two statements
 * distinguishable by their `order by` direction; one without produces a single
 * statement carrying no order at all, which is why the no-tail case matches on
 * the select instead.
 */
function peekDb(options: PeekOptions) {

    if (options.error) return createRecordingDb('postgres', [{ match: /select/, error: options.error }]);

    if (!options.tail) return createRecordingDb('postgres', [{ match: /select/, rows: options.head ?? [] }]);

    return createRecordingDb('postgres', [
        { match: / asc/, rows: options.head ?? [] },
        { match: / desc/, rows: options.tail },
    ]);

}

/**
 * The overlay, mounted with a recording connection standing in for a database.
 */
async function overlay(options: PeekOptions) {

    const detail = options.detail ?? usersTable();
    const db = peekDb(options);

    const { stdin, lastFrame, unmount } = render(
        <FocusProvider>
            <RowPeekOverlay
                db={db.kysely}
                dialect="postgres"
                detail={detail}
                gate={options.gate ?? GATE}
                height={options.height ?? HEIGHT}
                onClose={() => {}}
            />
        </FocusProvider>,
    );

    if (options.until) await waitFor(() => options.until!(strip(lastFrame())));

    return { db, stdin, frame: () => strip(lastFrame()), unmount };

}

/**
 * A viewport with a stand-in peek, so the key wiring can be tested without a
 * connection. The marker is what proves the swap happened.
 */
const PEEK_MARKER = 'PEEK-OPENED';

async function scroller(detailRows: DetailRow[], withPeek: boolean) {

    return mountScroller(detailRows, withPeek ? () => <Text>{PEEK_MARKER}</Text> : undefined);

}

/**
 * The same viewport with the *real* overlay behind `p`, so the round trip
 * through it — including its Escape — is the one the reader takes.
 */
async function scrollerWithRealPeek(detailRows: DetailRow[], detail: TableDetail) {

    const db = peekDb({ head: rows([1, 2]) });

    return mountScroller(detailRows, (close) => (
        <RowPeekOverlay
            db={db.kysely}
            dialect="postgres"
            detail={detail}
            gate={GATE}
            height={HEIGHT}
            onClose={close}
        />
    ));

}

async function mountScroller(
    detailRows: DetailRow[],
    renderPeek?: (close: () => void) => React.ReactElement,
) {

    const { stdin, lastFrame, unmount } = render(
        <FocusProvider>
            <ScrollView
                rows={detailRows}
                height={12}
                isFocused
                renderPeek={renderPeek}
            />
        </FocusProvider>,
    );

    await waitFor(() => strip(lastFrame()).length > 0);

    const press = async (sequence: string, settled: (frame: string) => boolean) => {

        stdin.write(sequence);

        await waitFor(() => settled(strip(lastFrame())));

    };

    return { frame: () => strip(lastFrame()), press, unmount };

}

/** A detail long enough to scroll, so an offset exists to preserve. */
function longTable(): TableDetail {

    return usersTable({
        columns: Array.from({ length: 40 }, (_, index) => column(
            `col_${String(index).padStart(2, '0')}`,
            { ordinalPosition: index + 1, isPrimaryKey: index === 0 },
        )),
    });

}

describe('cli: screens/db/explore row peek', () => {

    describe('reaching it', () => {

        it('should open the peek on p', async () => {

            const view = await scroller(tableDetailRows(usersTable(), WIDE), true);

            expect(view.frame()).not.toContain(PEEK_MARKER);

            await view.press(KEY.peek, (frame) => frame.includes(PEEK_MARKER));

            expect(view.frame()).toContain(PEEK_MARKER);

            view.unmount();

        });

        it('should ignore p when the object has no rows to peek at', async () => {

            const view = await scroller(tableDetailRows(usersTable(), WIDE), false);

            const before = view.frame();

            view.press(KEY.peek, () => false);
            await waitFor(() => false, 100);

            expect(view.frame()).toBe(before);

            view.unmount();

        });

        it('should restore the exact scroll offset on Escape', async () => {

            const detail = longTable();
            const view = await scrollerWithRealPeek(tableDetailRows(detail, WIDE), detail);

            await view.press(KEY.end, (frame) => frame.includes('col_39'));

            const before = view.frame();

            await view.press(KEY.peek, (frame) => frame.includes(PEEK_HEADER));

            expect(view.frame()).not.toBe(before);

            await view.press(KEY.escape, (frame) => !frame.includes(PEEK_HEADER));

            expect(view.frame()).toBe(before);

            view.unmount();

        });

        it('should still open the full-text view, which shares the same swap', async () => {

            const view = await scroller(tableDetailRows(usersTable(), WIDE), true);

            await view.press(KEY.value, (frame) => frame.includes('Full text'));

            expect(view.frame()).toContain('Full text');
            expect(view.frame()).not.toContain(PEEK_MARKER);

            view.unmount();

        });

    });

    describe('what it shows', () => {

        it('should label both ends when they are different rows', async () => {

            const view = await overlay({
                height: PAGE_HEIGHT,
                head: rows([1, 2, 3]),
                tail: rows([9, 8, 7]),
                until: (frame) => frame.includes('Last'),
            });

            expect(view.frame()).toContain(`First ${PAGE} by id`);
            expect(view.frame()).toContain(`Last ${PAGE} by id`);

            view.unmount();

        });

        it('should keep the tail in ascending order under its heading', async () => {

            const view = await overlay({
                height: PAGE_HEIGHT,
                head: rows([1, 2, 3]),
                tail: rows([9, 8, 7]),
                until: (frame) => frame.includes('Last'),
            });

            const frame = view.frame();
            const tail = frame.slice(frame.indexOf('Last'));

            expect(tail.indexOf('2024-01-07')).toBeLessThan(tail.indexOf('2024-01-09'));

            view.unmount();

        });

        it('should not sort the rows by whatever column looks like a date', async () => {

            const view = await overlay({
                height: PAGE_HEIGHT,
                head: rows([1, 2, 3]),
                tail: rows([9, 8, 7]),
                until: (frame) => frame.includes('First'),
            });

            const frame = view.frame();
            const head = frame.slice(frame.indexOf('First'), frame.indexOf('Last'));

            // Descending would put 03 first. `autoSort` off is the only reason
            // it does not.
            expect(head.indexOf('2024-01-01')).toBeLessThan(head.indexOf('2024-01-03'));

            view.unmount();

        });

        it('should show one set, not two, when the ends overlap', async () => {

            const view = await overlay({
                height: PAGE_HEIGHT,
                head: rows([1, 2, 3]),
                tail: rows([4, 3, 2]),
                until: (frame) => frame.includes('All'),
            });

            const frame = view.frame();

            expect(frame).toContain('All 4 rows by id');
            expect(frame).not.toContain('First');
            expect(frame).not.toContain('Last');

            // One row per id, once each.
            expect(frame.split('2024-01-03')).toHaveLength(2);

            view.unmount();

        });

        it('should say why there is no last set when the table has no primary key', async () => {

            const detail = usersTable({ columns: [column('note', { ordinalPosition: 1 })] });

            const view = await overlay({
                detail,
                height: PAGE_HEIGHT,
                head: [{ note: 'a' }, { note: 'b' }, { note: 'c' }],
                until: (frame) => frame.includes('First'),
            });

            expect(view.frame()).toContain('No primary key');
            expect(view.frame()).not.toContain('Last');

            view.unmount();

        });

        it('should render an empty table without failing', async () => {

            const view = await overlay({
                head: [],
                until: (frame) => frame.includes('All'),
            });

            expect(view.frame()).toContain('All 0 rows');
            expect(view.frame()).toContain('No results');

            view.unmount();

        });

        it('should render a column that is NULL in every row', async () => {

            const view = await overlay({
                head: [{ id: 1, created_at: null }, { id: 2, created_at: null }],
                until: (frame) => frame.includes('All'),
            });

            expect(view.frame()).toContain('NULL');

            view.unmount();

        });

        it('should name the table it is showing', async () => {

            const view = await overlay({
                head: rows([1]),
                until: (frame) => frame.includes(PEEK_HEADER),
            });

            expect(view.frame()).toContain('public.users');

            view.unmount();

        });

    });

    describe('when it cannot read', () => {

        it('should show a spinner before the rows arrive', async () => {

            const view = await overlay({ head: rows([1]) });

            expect(view.frame()).toContain('Reading public.users');

            view.unmount();

        });

        it('should show the database error as a message, not a stack', async () => {

            const view = await overlay({
                error: new Error('relation "public.users" does not exist'),
                until: (frame) => frame.includes('Could not read rows'),
            });

            const frame = view.frame();

            expect(frame).toContain('relation "public.users" does not exist');
            expect(frame).not.toContain('at ');

            view.unmount();

        });

        it('should show the policy reason when the channel is denied, having read nothing', async () => {

            const view = await overlay({
                head: rows([1]),
                gate: { configName: 'prod', access: { user: 'admin', agent: false }, channel: 'agent' },
                until: (frame) => frame.includes('Could not read rows'),
            });

            expect(view.frame()).toContain('agent');
            expect(view.db.queries).toHaveLength(0);

            view.unmount();

        });

    });

    describe('sizing', () => {

        it('should split the viewport between two sets and their chrome', () => {

            // 30 rows, minus the header, minus each set's label and table chrome.
            expect(setRows(30, 2)).toBe(8);
            expect(setRows(30, 1)).toBe(23);

        });

        it('should never ask for a page it cannot draw', () => {

            // Budgeted for two sets, which is the worst case.
            expect(peekPageSize(30)).toBe(8);
            expect(peekPageSize(PAGE_HEIGHT)).toBe(PAGE);

        });

        it('should still ask for one row on a terminal with no room at all', () => {

            expect(peekPageSize(12)).toBe(1);
            expect(setRows(1, 2)).toBe(1);

        });

        it('should cap a column that has room to spare', () => {

            // Two columns on a 100-column terminal have room to spare, so the
            // cap decides. Forty do not, and are chopped rather than squeezed —
            // `explore-row-view.test.tsx` pins that half.
            const fit = fitPeekColumns(['id', 'name'], 100);

            expect(fit.width).toBe(24);
            expect(fit.hidden).toBe(0);

            expect(fitPeekColumns([], 100).width).toBe(24);

        });

        it('should cap the page at ten however tall the terminal is', () => {

            expect(peekPageSize(200)).toBe(10);

        });

    });

    describe('footer', () => {

        it('should advertise the peek key only on an object that has rows', () => {

            const table = detailFooterHints({ scrolls: false, overlay: 'none', canPeek: true });
            const view = detailFooterHints({ scrolls: false, overlay: 'none', canPeek: false });

            expect(table).toContain('[r] Rows');
            expect(view).not.toContain('[r] Rows');

        });

        it('should offer only Escape while the peek is open, since it does not scroll', () => {

            const hints = detailFooterHints({ scrolls: true, overlay: 'peek', canPeek: true });

            expect(hints).toEqual(['[Esc] Close']);

        });

        it('should stay inside one line of an 80-column terminal with the peek hint', () => {

            for (const platform of ['darwin', 'linux'] as const) {

                const width = detailFooterHints({ scrolls: true, overlay: 'none', canPeek: true, platform })
                    .join('  ').length;

                expect(width).toBeLessThanOrEqual(80);

            }

        });

    });

});
