/**
 * Explore row-view tests: navigating peeked rows and reading one in full.
 *
 * The peek draws two grids of truncated cells. This is the way out of them —
 * a cursor that moves, Enter that opens the row under it, and a key/value
 * document that shows every column including the ones the grid had to drop.
 *
 * What is pinned here, in rough order of how expensive it would be to get wrong:
 *
 * - **Value rendering.** Drivers return real JavaScript, not strings, and they
 *   disagree per dialect. `JSON.stringify` throws outright on a `bigint`, and a
 *   `Buffer` serializes to `{"type":"Buffer","data":[…]}`, which is the shape of
 *   the wrapper rather than the value. Both are pinned, along with the three
 *   things that must stay distinguishable: `null`, the string `"null"`, and the
 *   empty string.
 * - **Column chopping.** A fifteen-column table on a narrow terminal used to
 *   shrink every column to six, which turns a UUID into `ee3d` and a header
 *   into two wrapped lines. Now it shows as many whole columns as fit and says
 *   how many it dropped.
 * - **Where Escape lands.** Three levels deep — row view, peek, detail — and
 *   each level has to give up its own key without taking the level below with
 *   it. The filter box inside `ResultTable` is a fourth owner of Escape and is
 *   pinned here so it cannot be quietly disabled.
 * - **What the shared `ResultTable` does without the new props**, which is what
 *   keeps the SQL terminal exactly as it was.
 */
import { describe, it, expect, beforeEach } from 'bun:test';
import { render } from 'ink-testing-library';
import chalk from 'chalk';
import React from 'react';

import type { ColumnDetail, TableDetail } from '../../../../src/core/explore/types.js';
import type { ConfigAccess } from '../../../../src/core/policy/index.js';

import { FocusProvider } from '../../../../src/tui/focus.js';
import {
    PEEK_COLUMN_CAP,
    ResultTable,
    RowViewOverlay,
    fitPeekColumns,
} from '../../../../src/tui/components/terminal/index.js';
import { RowPeekOverlay } from '../../../../src/tui/screens/db/explore/RowPeekOverlay.js';
import {
    DEFAULT_ROW_FORMAT,
    documentRow,
    documentValue,
    preferredRowFormat,
    rememberRowFormat,
    renderRowDocument,
} from '../../../../src/tui/components/terminal/rowDocument.js';
import { createRecordingDb } from '../../../core/explore/recording-db.js';

const OPEN: ConfigAccess = { user: 'admin', agent: 'admin' };

const GATE = { configName: 'test', access: OPEN, channel: 'user' } as const;

/** Viewport height the overlay cases run at: tall enough for two sets. */
const HEIGHT = 30;

/** The peek's own header, so no case can pass on an overlay that never opened. */
const PEEK_HEADER = 'Rows ·';

/** The row view's header, likewise. */
const VIEW_HEADER = 'Row ·';

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
    down: '\u001B[B',
    up: '\u001B[A',
    left: '\u001B[D',
    right: '\u001B[C',
    enter: '\r',
    escape: '\u001B',
    tab: '\t',
    format: 'f',
    filter: '/',
} as const;

/**
 * Wait until the row view's own focus scope is live.
 *
 * `useFocusScope` pushes onto the stack in an effect, so a keystroke written on
 * the same tick as the mount lands before any handler is listening and is lost.
 * Polling the frame is not enough on its own — the first frame is drawn before
 * the effect runs — so this presses a key until its effect shows up, which is
 * the same "poll for the condition" discipline a fixed sleep here would skip.
 *
 * `f` is the probe because what it changes is in the header rather than in the
 * document, and because pressing it twice puts the remembered format back where
 * it started, whichever one it started at.
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

function rows(ids: number[]): Record<string, unknown>[] {

    return ids.map((id) => ({ id, created_at: `2024-01-${String(id).padStart(2, '0')}` }));

}

// -----------------------------------------------------------------------------
// Value rendering
// -----------------------------------------------------------------------------

describe('cli: screens/db/explore row document', () => {

    beforeEach(() => rememberRowFormat(DEFAULT_ROW_FORMAT));

    describe('values a driver actually returns', () => {

        it('should keep null, the string "null" and the empty string apart', () => {

            const row = { a: null, b: 'null', c: '' };

            const yaml = renderRowDocument(row, ['a', 'b', 'c'], 'yaml');
            const json = renderRowDocument(row, ['a', 'b', 'c'], 'json');

            expect(yaml).toContain('a: null');
            expect(yaml).toContain('b: "null"');
            expect(yaml).toContain('c: ""');

            expect(json).toContain('"a": null');
            expect(json).toContain('"b": "null"');
            expect(json).toContain('"c": ""');

        });

        it('should render a Date as an ISO instant rather than a locale string', () => {

            const value = documentValue(new Date('2024-03-01T12:34:56.789Z'));

            expect(value).toBe('2024-03-01T12:34:56.789Z');

        });

        it('should survive the Invalid Date mysql hands back for a zero timestamp', () => {

            const value = documentValue(new Date('0000-00-00'));

            expect(value).toBe('<invalid date>');

        });

        it('should summarize a Buffer instead of dumping its byte array', () => {

            const value = documentValue(Buffer.from([0x00, 0xff, 0x10]));

            expect(value).toBe('<binary 3 bytes 0x00ff10>');
            expect(String(value)).not.toContain('"type"');
            expect(String(value)).not.toContain('data');

        });

        it('should summarize the Uint8Array bun:sqlite hands back for a blob', () => {

            // bun:sqlite returns a plain Uint8Array, so `Buffer.isBuffer` is
            // false for exactly the value that most needs summarizing.
            const value = documentValue(new Uint8Array([0x00, 0xff, 0x10]));

            expect(Buffer.isBuffer(new Uint8Array([1]))).toBe(false);
            expect(value).toBe('<binary 3 bytes 0x00ff10>');

        });

        it('should name an empty binary as empty rather than as nothing', () => {

            expect(documentValue(Buffer.alloc(0))).toBe('<binary 0 bytes>');

        });

        it('should cut a long binary preview instead of printing a kilobyte of hex', () => {

            const value = documentValue(Buffer.alloc(1024, 0xab));

            expect(value).toContain('1024 bytes');
            expect(value).toContain('…');
            expect(String(value).length).toBeLessThan(60);

        });

        it('should render a bigint without letting JSON.stringify throw', () => {

            const row = { big: 9223372036854775807n };

            // The bug this guards: JSON.stringify throws a TypeError on a
            // bigint, so an unguarded document crashes the overlay outright.
            expect(() => JSON.stringify(row)).toThrow();

            expect(renderRowDocument(row, ['big'], 'json')).toContain('"9223372036854775807"');
            expect(renderRowDocument(row, ['big'], 'yaml')).toContain('"9223372036854775807"');

        });

        it('should render a parsed jsonb column as structure, not [object Object]', () => {

            const row = { doc: { a: 1, b: [2, 3] } };

            const yaml = renderRowDocument(row, ['doc'], 'yaml');
            const json = renderRowDocument(row, ['doc'], 'json');

            expect(yaml).not.toContain('[object Object]');
            expect(yaml).toContain('a: 1');
            expect(yaml).toContain('- 2');
            expect(json).toContain('"a": 1');

        });

        it('should render a postgres array column as a list', () => {

            const yaml = renderRowDocument({ tags: [1, 2, 3] }, ['tags'], 'yaml');

            expect(yaml).toContain('- 1');
            expect(yaml).toContain('- 3');

        });

        it('should mark a circular value rather than throwing on it', () => {

            const loop: Record<string, unknown> = { name: 'a' };
            loop['self'] = loop;

            const yaml = renderRowDocument({ loop }, ['loop'], 'yaml');

            expect(yaml).toContain('<circular>');

        });

        it('should leave a number, a boolean and a string as themselves', () => {

            expect(documentValue(1)).toBe(1);
            expect(documentValue(true)).toBe(true);
            expect(documentValue('x')).toBe('x');

        });

        it('should not fold a long value across lines', () => {

            // yaml's stringify folds at 80 columns by default, which would put
            // one column's value on several lines and make the row's line count
            // depend on the value rather than on the column count.
            // Words, not one long run of `x`: yaml folds at a space, so a
            // string without one cannot fold and would pass either way.
            const long = Array.from({ length: 40 }, (_, index) => `word${index}`).join(' ');

            const yaml = renderRowDocument({ note: long }, ['note'], 'yaml');

            expect(yaml.split('\n')).toHaveLength(1);
            expect(yaml).toContain(long);

        });

    });

    describe('the document as a whole', () => {

        it('should order fields by the column list, not by the object keys', () => {

            // The two orders have to disagree or this proves nothing: a driver
            // usually hands back keys in the order the query selected them,
            // which is the order the column list already has.
            const row = { z: 1, a: 2 };

            expect(Object.keys(documentRow(row, ['a', 'z']))).toEqual(['a', 'z']);

        });

        it('should still show a key the column list left out', () => {

            const row = { known: 1, surprise: 2 };

            expect(Object.keys(documentRow(row, ['known']))).toEqual(['known', 'surprise']);

        });

    });

    describe('the remembered format', () => {

        it('should default to yaml', () => {

            expect(DEFAULT_ROW_FORMAT).toBe('yaml');
            expect(preferredRowFormat()).toBe('yaml');

        });

        it('should survive the overlay it was chosen in', () => {

            rememberRowFormat('json');

            expect(preferredRowFormat()).toBe('json');

        });

    });

});

// -----------------------------------------------------------------------------
// Column chopping
// -----------------------------------------------------------------------------

describe('cli: screens/db/explore peek columns', () => {

    const many = (count: number) => Array.from(
        { length: count },
        (_, index) => `col_${String(index).padStart(2, '0')}`,
    );

    it('should show every column when they all fit', () => {

        const fit = fitPeekColumns(['id', 'name'], 100);

        expect(fit.columns).toEqual(['id', 'name']);
        expect(fit.hidden).toBe(0);
        expect(fit.width).toBeLessThanOrEqual(PEEK_COLUMN_CAP);

    });

    it('should drop columns rather than shrink them below readable', () => {

        // The bug: fifteen columns on a 76-column terminal used to be squeezed
        // to six each, which renders a uuid as `ee3d` and wraps every header.
        const fit = fitPeekColumns(many(15), 76);

        // Sixteen and three are written out rather than read from the module:
        // asserting against the constant would let a change to the constant
        // move the bar it is being measured against.
        expect(fit.width).toBeGreaterThanOrEqual(16);
        expect(fit.columns).toHaveLength(3);
        expect(fit.hidden).toBe(12);

    });

    it('should keep the columns it shows in their original order', () => {

        const fit = fitPeekColumns(many(15), 76);

        expect(fit.columns).toEqual(many(15).slice(0, fit.columns.length));

    });

    it('should never fit more columns than the row has room for', () => {

        const fit = fitPeekColumns(many(40), 80);
        const used = fit.columns.length * fit.width + (fit.columns.length - 1) * 3;

        expect(used).toBeLessThanOrEqual(80);

    });

    it('should show one column even on a terminal too narrow for it', () => {

        const fit = fitPeekColumns(many(40), 10);

        expect(fit.columns).toHaveLength(1);
        expect(fit.hidden).toBe(39);

    });

    it('should spend leftover room on width before it spends it on a column', () => {

        // Three columns on a wide terminal have room for the cap; a fourth
        // column at minimum width would be worse than three wide ones only if
        // it did not fit, so what this pins is that nothing is left on the
        // table: the shown columns grow to the cap.
        const fit = fitPeekColumns(['a', 'b', 'c'], 120);

        expect(fit.hidden).toBe(0);
        expect(fit.width).toBe(PEEK_COLUMN_CAP);

    });

});

// -----------------------------------------------------------------------------
// ResultTable: what the new props change, and what they leave alone
// -----------------------------------------------------------------------------

describe('cli: components/terminal ResultTable selection', () => {

    async function table(props: Partial<React.ComponentProps<typeof ResultTable>> = {}) {

        const { stdin, lastFrame, unmount } = render(
            <FocusProvider>
                <ResultTable
                    columns={['id', 'name']}
                    rows={[{ id: 1, name: 'a' }, { id: 2, name: 'b' }]}
                    autoSort={false}
                    {...props}
                />
            </FocusProvider>,
        );

        await waitFor(() => strip(lastFrame()).includes('name'));

        return { stdin, frame: () => strip(lastFrame()), unmount };

    }

    it('should ignore Enter and Tab when no callback was given', async () => {

        // The SQL terminal passes neither, so this is that screen's behavior.
        const view = await table();
        const before = view.frame();

        view.stdin.write(KEY.enter);
        view.stdin.write(KEY.tab);
        await waitFor(() => false, 100);

        expect(view.frame()).toBe(before);

        view.unmount();

    });

    it('should report the highlighted row on Enter', async () => {

        const picked: { index: number; row: Record<string, unknown> }[] = [];

        const view = await table({
            onSelect: (row, index) => picked.push({ row, index }),
        });

        view.stdin.write(KEY.down);
        await waitFor(() => false, 50);
        view.stdin.write(KEY.enter);
        await waitFor(() => picked.length > 0);

        expect(picked[0]?.index).toBe(1);
        expect(picked[0]?.row['name']).toBe('b');

        view.unmount();

    });

    it('should hand Enter to the filter box while one is open', async () => {

        const picked: number[] = [];

        const view = await table({ onSelect: (_row, index) => picked.push(index) });

        view.stdin.write(KEY.filter);
        await waitFor(() => view.frame().includes('[Enter] Apply'));

        view.stdin.write(KEY.enter);
        await waitFor(() => !view.frame().includes('[Enter] Apply'));

        expect(picked).toEqual([]);

        view.unmount();

    });

    it('should hand Tab to the filter box while one is open', async () => {

        const switched: string[] = [];

        const view = await table({ onTab: () => switched.push('tab') });

        view.stdin.write(KEY.filter);
        await waitFor(() => view.frame().includes('[Enter] Apply'));

        view.stdin.write(KEY.tab);
        await waitFor(() => view.frame().includes('[id]'));

        expect(switched).toEqual([]);

        view.unmount();

    });

    it('should report Tab in browse mode', async () => {

        const switched: string[] = [];

        const view = await table({ onTab: () => switched.push('tab') });

        view.stdin.write(KEY.tab);
        await waitFor(() => switched > 0);

        expect(switched).toHaveLength(1);

        view.unmount();

    });

    it('should take its cursor from the parent when one is supplied', async () => {

        const moves: number[] = [];

        const view = await table({
            highlightedRow: 0,
            onHighlightChange: (index) => moves.push(index),
        });

        view.stdin.write(KEY.down);
        await waitFor(() => moves.length > 0);

        expect(moves.at(-1)).toBe(1);

        view.unmount();

    });

    it('should draw no cursor while it is inactive', async () => {

        // Two tables on screen, both drawing a highlight, is a claim that both
        // answer to Enter. Only the active one does.
        const view = await table({ active: false });

        expect(view.frame()).not.toContain('[/] Filter');

        // The cursor is drawn with an inverse SGR and nothing else, so with
        // colour off - which is how CI runs this suite, and how the mutation
        // harness runs it - the frame carries no trace of it either way and
        // there is nothing left to assert against. Ink and this file share one
        // chalk instance, so turning it on here is enough.
        const level = chalk.level;

        chalk.level = 1;

        try {

            const raw = render(
                <FocusProvider>
                    <ResultTable
                        columns={['id']}
                        rows={[{ id: 1 }]}
                        autoSort={false}
                        active={false}
                    />
                </FocusProvider>,
            );

            await waitFor(() => strip(raw.lastFrame()).includes('id'));

            // Bold on the header proves colour is on, so the absence of the
            // inverse below is a real absence rather than a disabled renderer.
            expect(raw.lastFrame()).toContain('\u001B[1m');
            expect(raw.lastFrame()).not.toContain('\u001B[7m');

            raw.unmount();

        }
        finally {

            chalk.level = level;

        }

        view.unmount();

    });

    it('should truncate a header too wide for its column instead of wrapping it', async () => {

        const view = await table({
            columns: ['a_very_long_column_name_indeed'],
            rows: [{ a_very_long_column_name_indeed: 'x' }],
            maxColumnWidth: 8,
        });

        const header = view.frame().split('\n').find((line) => line.includes('a_very'));

        expect(header).toContain('…');
        expect(view.frame()).not.toContain('name_indeed');

        view.unmount();

    });

});

// -----------------------------------------------------------------------------
// The row view itself
// -----------------------------------------------------------------------------

describe('cli: screens/db/explore RowViewOverlay', () => {

    beforeEach(() => rememberRowFormat(DEFAULT_ROW_FORMAT));

    const three = [
        { id: 1, note: 'first', extra: null },
        { id: 2, note: 'second', extra: 'x' },
        { id: 3, note: 'third', extra: '' },
    ];

    async function viewer(overrides: Partial<React.ComponentProps<typeof RowViewOverlay>> = {}) {

        const moves: number[] = [];
        const closes: string[] = [];

        const { stdin, lastFrame, unmount, rerender } = render(
            <FocusProvider>
                <RowViewOverlay
                    rows={three}
                    index={0}
                    columns={['id', 'note', 'extra']}
                    setLabel="First 3 by id"
                    height={20}
                    onMove={(index) => moves.push(index)}
                    onClose={() => closes.push('close')}
                    {...overrides}
                />
            </FocusProvider>,
        );

        const frame = () => strip(lastFrame());

        await waitFor(() => frame().includes(VIEW_HEADER));
        await settleRowView(stdin, frame);

        return { stdin, moves, closed: () => closes.length, frame, rerender, unmount };

    }

    it('should draw one field per line in the remembered format', async () => {

        const view = await viewer();

        expect(view.frame()).toContain('id: 1');
        expect(view.frame()).toContain('note: first');
        expect(view.frame()).toContain('extra: null');

        view.unmount();

    });

    it('should say which row of which set is on screen', async () => {

        const view = await viewer({ index: 1 });

        expect(view.frame()).toContain('First 3 by id');
        expect(view.frame()).toContain('row 2 of 3');

        view.unmount();

    });

    it('should toggle to JSON and back on f', async () => {

        const view = await viewer();

        view.stdin.write(KEY.format);
        await waitFor(() => view.frame().includes('"id": 1'));

        expect(view.frame()).toContain('"note": "first"');

        view.stdin.write(KEY.format);
        await waitFor(() => view.frame().includes('id: 1'));

        view.unmount();

    });

    it('should remember the format for the next row it opens', async () => {

        const first = await viewer();

        first.stdin.write(KEY.format);
        await waitFor(() => first.frame().includes('"id": 1'));

        first.unmount();

        const second = await viewer();

        expect(second.frame()).toContain('"id": 1');

        second.unmount();

    });

    it('should move to the next and previous row on the arrow keys', async () => {

        const view = await viewer({ index: 1 });

        view.stdin.write(KEY.right);
        await waitFor(() => view.moves.length > 0);

        expect(view.moves.at(-1)).toBe(2);

        view.stdin.write(KEY.left);
        await waitFor(() => view.moves.length > 1);

        expect(view.moves.at(-1)).toBe(0);

        view.unmount();

    });

    it('should stop at the ends rather than wrap around them', async () => {

        // Wrapping from the last row to the first says they are adjacent, and
        // in `ends` mode the set boundary is exactly where they are not.
        const first = await viewer({ index: 0 });

        first.stdin.write(KEY.left);
        await waitFor(() => false, 100);

        expect(first.moves).toEqual([]);

        first.unmount();

        const last = await viewer({ index: 2 });

        last.stdin.write(KEY.right);
        await waitFor(() => false, 100);

        expect(last.moves).toEqual([]);

        last.unmount();

    });

    it('should scroll a document taller than the viewport', async () => {

        const wide: Record<string, unknown> = {};
        const columns: string[] = [];

        for (let index = 0; index < 40; index += 1) {

            const name = `col_${String(index).padStart(2, '0')}`;
            wide[name] = index;
            columns.push(name);

        }

        const view = await viewer({ rows: [wide], index: 0, columns, height: 12 });

        expect(view.frame()).toContain('col_00: 0');
        expect(view.frame()).not.toContain('col_39: 39');

        view.stdin.write(KEY.down);
        await waitFor(() => !view.frame().includes('col_00: 0'));

        expect(view.frame()).toContain('more');

        view.unmount();

    });

    it('should reset the scroll when it moves to another row', async () => {

        const tall = (id: number) => {

            const row: Record<string, unknown> = { id };

            for (let index = 0; index < 40; index += 1) row[`col_${index}`] = index;

            return row;

        };

        const columns = ['id', ...Array.from({ length: 40 }, (_, index) => `col_${index}`)];

        const view = await viewer({ rows: [tall(1), tall(2)], index: 0, columns, height: 12 });

        view.stdin.write(KEY.down);
        view.stdin.write(KEY.down);
        await waitFor(() => !view.frame().includes('id: 1'));

        view.rerender(
            <FocusProvider>
                <RowViewOverlay
                    rows={[tall(1), tall(2)]}
                    index={1}
                    columns={columns}
                    setLabel="First 2 by id"
                    height={12}
                    onMove={() => {}}
                    onClose={() => {}}
                />
            </FocusProvider>,
        );

        await waitFor(() => view.frame().includes('id: 2'));

        // Without the reset the second row opens at the offset the first was
        // left at, and `id` - its first line - is above the fold.
        expect(view.frame()).toContain('id: 2');

        view.unmount();

    });

    it('should close on Escape', async () => {

        const view = await viewer();

        view.stdin.write(KEY.escape);
        await waitFor(() => view.closed() > 0);

        expect(view.closed()).toBe(1);

        view.unmount();

    });

});

// -----------------------------------------------------------------------------
// The peek, driving all of it
// -----------------------------------------------------------------------------

describe('cli: screens/db/explore peek navigation', () => {

    beforeEach(() => rememberRowFormat(DEFAULT_ROW_FORMAT));

    /** A peek whose head and tail are distinct, so `ends` mode is what renders. */
    function endsDb(head: Record<string, unknown>[], tail: Record<string, unknown>[]) {

        return createRecordingDb('postgres', [
            { match: / asc/, rows: head },
            { match: / desc/, rows: tail },
        ]);

    }

    async function peek(options: {
        head?: Record<string, unknown>[];
        tail?: Record<string, unknown>[];
        detail?: TableDetail;
        height?: number;
    } = {}) {

        const head = options.head ?? rows([1, 2, 3]);
        const db = options.tail
            ? endsDb(head, options.tail)
            : createRecordingDb('postgres', [{ match: /select/, rows: head }]);

        const closes: string[] = [];

        const { stdin, lastFrame, unmount } = render(
            <FocusProvider>
                <RowPeekOverlay
                    db={db.kysely}
                    dialect="postgres"
                    detail={options.detail ?? usersTable()}
                    gate={GATE}
                    height={options.height ?? HEIGHT}
                    onClose={() => closes.push('close')}
                />
            </FocusProvider>,
        );

        const frame = () => strip(lastFrame());

        // The header is drawn while the query is still running, so waiting for
        // it alone hands back a spinner with no table mounted and every
        // keystroke after it lands nowhere.
        await waitFor(() => frame().includes(PEEK_HEADER) && !frame().includes('Reading'));

        const press = async (sequence: string, settled: (current: string) => boolean) => {

            stdin.write(sequence);

            await waitFor(() => settled(frame()));

        };

        /** Enter, plus the wait the row view's own focus scope needs. */
        const open = async () => {

            await press(KEY.enter, (current) => current.includes(VIEW_HEADER));
            await settleRowView(stdin, frame);

        };

        /**
         * A key whose only visible effect is the cursor, which the stripped
         * frame cannot show — the cursor is an inverse SGR and `strip` removes
         * exactly that. Waiting on the raw frame changing is what keeps the
         * next keystroke from being read against a stale render.
         */
        const nudge = async (sequence: string) => {

            const before = lastFrame();

            stdin.write(sequence);

            await waitFor(() => lastFrame() !== before);

        };

        return { stdin, press, open, nudge, closed: () => closes.length, frame, unmount };

    }

    /** Height that makes the page exactly 3 rows, so a 3-row head has a tail. */
    const PAGE_HEIGHT = 19;

    it('should open the highlighted row on Enter', async () => {

        const view = await peek();

        await waitFor(() => view.frame().includes('row-'), 100);

        await view.press(KEY.enter, (current) => current.includes(VIEW_HEADER));

        expect(view.frame()).toContain('id: 1');

        view.unmount();

    });

    it('should open the row the cursor moved to, not the first one', async () => {

        const view = await peek();

        await view.nudge(KEY.down);
        await view.press(KEY.enter, (current) => current.includes(VIEW_HEADER));

        expect(view.frame()).toContain('id: 2');

        view.unmount();

    });

    it('should return to the peek on Escape with the cursor where it was', async () => {

        const view = await peek();

        await view.nudge(KEY.down);
        await view.open();
        await view.press(KEY.escape, (current) => !current.includes(VIEW_HEADER));

        expect(view.frame()).toContain(PEEK_HEADER);
        expect(view.closed()).toBe(0);

        // The cursor is still on row two, which Enter proves by opening it.
        await view.press(KEY.enter, (current) => current.includes(VIEW_HEADER));

        expect(view.frame()).toContain('id: 2');

        view.unmount();

    });

    it('should carry the cursor moved inside the row view back to the table', async () => {

        const view = await peek();

        await view.open();
        await view.press(KEY.right, (current) => current.includes('row 2 of 3'));
        await view.press(KEY.escape, (current) => !current.includes(VIEW_HEADER));
        await view.press(KEY.enter, (current) => current.includes(VIEW_HEADER));

        expect(view.frame()).toContain('id: 2');

        view.unmount();

    });

    it('should close the peek on Escape from browse mode', async () => {

        const view = await peek();

        await view.press(KEY.escape, () => true);
        await waitFor(() => view.closed() > 0);

        expect(view.closed()).toBe(1);

        view.unmount();

    });

    it('should give Escape to the filter box before the peek claims it', async () => {

        const view = await peek();

        await view.press(KEY.filter, (current) => current.includes('[Enter] Apply'));
        await view.press(KEY.escape, (current) => !current.includes('[Enter] Apply'));

        expect(view.closed()).toBe(0);
        expect(view.frame()).toContain(PEEK_HEADER);

        view.unmount();

    });

    it('should move focus between the two sets on Tab', async () => {

        const view = await peek({
            head: rows([1, 2, 3]),
            // As a `desc` read returns them; the peek reverses for display.
            tail: rows([9, 8, 7]),
            height: PAGE_HEIGHT,
        });

        await waitFor(() => view.frame().includes('Last 3'));

        // Only the focused set advertises the keys it owns.
        expect(view.frame().match(/\[\/\] Filter/g)).toHaveLength(1);

        await view.nudge(KEY.tab);
        await view.press(KEY.enter, (current) => current.includes(VIEW_HEADER));

        expect(view.frame()).toContain('Last 3');
        expect(view.frame()).toContain('id: 7');

        view.unmount();

    });

    it('should not offer a second set to Tab into when there is only one', async () => {

        const view = await peek();

        expect(view.frame()).not.toContain('[Tab]');

        view.unmount();

    });

    it('should reach a column the grid had to drop', async () => {

        const many = Array.from({ length: 20 }, (_, index) => `col_${String(index).padStart(2, '0')}`);
        const row: Record<string, unknown> = {};

        for (const name of many) row[name] = name;

        const detail = usersTable({
            columns: many.map((name, index) => column(name, {
                ordinalPosition: index + 1,
                isPrimaryKey: index === 0,
            })),
        });

        const view = await peek({ head: [row], detail });

        // The grid cannot draw twenty columns, so the last one is behind the
        // marker; the row view is what makes dropping it acceptable.
        expect(view.frame()).toContain('more column');
        expect(view.frame()).not.toContain('col_19');

        await view.open();
        await view.press('\u001B[F', (current) => current.includes('col_19'));

        expect(view.frame()).toContain('col_19: col_19');

        view.unmount();

    });

});
