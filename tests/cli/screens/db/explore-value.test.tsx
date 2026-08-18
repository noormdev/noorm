/**
 * Explore detail full-text overlay tests.
 *
 * Aligning the explore columns bought row-to-row consistency by truncating
 * whatever overflowed, and left no way to read what was cut: the detail screen
 * had no scroll-right, no expand, and no copy, so a Postgres default like
 * `nextval('cron.jobid_seq'::regclass)` was only reachable by leaving for the
 * SQL terminal and querying `information_schema` by hand.
 *
 * The contract pinned here is that `v` opens a view in which nothing is
 * truncated, that it wraps rather than clipping a second time, that it covers
 * every kind of row a detail view emits, and that Escape puts the reader back
 * exactly where they were — same scroll offset, same keys live again.
 */
import { describe, it, expect } from 'bun:test';
import { render } from 'ink-testing-library';
import React from 'react';

import type {
    ColumnDetail,
    ForeignKeySummary,
    IndexSummary,
    ParameterDetail,
    TableDetail,
} from '../../../../src/core/explore/types.js';

import { FocusProvider } from '../../../../src/tui/focus.js';
import {
    ScrollView,
    procedureDetailRows,
    tableDetailRows,
} from '../../../../src/tui/screens/db/explore/ExploreDetailScreen.js';

import type { DetailRow } from '../../../../src/tui/screens/db/explore/layout.js';

/** Row budget inside the explore Panel on the 100-column test terminal. */
const WIDE = 96;

/**
 * The overlay's own header. Asserted on rather than inferred from the content,
 * because every one of these cases would otherwise pass on a viewport that
 * never opened anything.
 */
const OVERLAY_HEADER = 'Full text';

/** Viewport height the scrolling cases run at. */
const HEIGHT = 12;

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
    end: '\u001B[F',
    escape: '\u001B',
    value: 'v',
} as const;

/**
 * The default that started this: 35 characters of `nextval(...)` behind a name,
 * a type, and a nullability clause, which is more than a 100-column terminal
 * has left by the time it gets there.
 */
const LONG_DEFAULT = 'nextval(\'cron.jobid_seq\'::regclass)';

function column(name: string, dataType: string, overrides: Partial<ColumnDetail> = {}): ColumnDetail {

    return {
        name,
        dataType,
        isNullable: false,
        isPrimaryKey: false,
        ordinalPosition: 0,
        ...overrides,
    };

}

/**
 * `cron.job` as the report saw it. The 30-character identifier and the
 * `timestamp with time zone` are load-bearing: they are what widen the name and
 * type cells far enough that the trailing constraint cell has to truncate the
 * `nextval(...)` default on a 100-column terminal.
 */
function cronJob(): TableDetail {

    return {
        name: 'job',
        schema: 'cron',
        columns: [
            column('jobid', 'bigint', { isPrimaryKey: true, defaultValue: LONG_DEFAULT }),
            column('schedule', 'text'),
            column('command', 'text'),
            column('nodename', 'text', { defaultValue: '\'localhost\'::text' }),
            column('active', 'boolean', { defaultValue: 'true' }),
            column('jobname', 'text', { isNullable: true }),
            column('last_successful_run_started_at', 'timestamp with time zone', { isNullable: true }),
        ],
        indexes: [],
        foreignKeys: [],
    };

}

/**
 * Fixed-width names so `col_07` is never a prefix of another row's name.
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
 * A scroller inside a focus provider, because the overlay opens a focus scope
 * of its own and has to be able to hand focus back when it closes.
 */
async function scroller(rows: DetailRow[], height: number) {

    const { stdin, lastFrame, unmount } = render(
        <FocusProvider>
            <ScrollView rows={rows} height={height} isFocused />
        </FocusProvider>,
    );

    await waitFor(() => strip(lastFrame()).length > 0);

    const press = async (sequence: string, settled: (frame: string) => boolean) => {

        stdin.write(sequence);

        await waitFor(() => settled(strip(lastFrame())));

    };

    return { frame: () => strip(lastFrame()), press, unmount };

}

describe('cli: screens/db/explore full-text overlay', () => {

    describe('reaching a truncated value', () => {

        it('should clip the long default before the overlay is opened', async () => {

            // The premise. Without this the next case could pass on a viewport
            // that never truncated anything.
            const view = await scroller(tableDetailRows(cronJob(), WIDE), HEIGHT);

            expect(view.frame()).toContain('…');
            expect(view.frame()).not.toContain(LONG_DEFAULT);

            view.unmount();

        });

        it('should show the whole default once v is pressed', async () => {

            const view = await scroller(tableDetailRows(cronJob(), WIDE), HEIGHT);

            await view.press(KEY.value, (frame) => frame.includes(LONG_DEFAULT));

            expect(view.frame()).toContain(LONG_DEFAULT);

            view.unmount();

        });

        it('should wrap a value too long for one line instead of clipping it again', async () => {

            const sprawling = 'a_very_long_default_expression_' + 'x'.repeat(200);
            const detail = cronJob();

            detail.columns[0].defaultValue = sprawling;

            const view = await scroller(tableDetailRows(detail, WIDE), HEIGHT);

            await view.press(KEY.value, (frame) => frame.includes('a_very_long_default_expression_'));

            const frame = view.frame();

            expect(frame).not.toContain('…');

            // Wrapped, not clipped: every piece of the value is on screen, and
            // no line runs past the terminal.
            expect(frame.replace(/\n/g, '')).toContain(sprawling);

            for (const line of frame.split('\n')) {

                expect(line.length).toBeLessThanOrEqual(100);

            }

            view.unmount();

        });

    });

    describe('every row type the screen renders', () => {

        it('should carry a column, an index, and a foreign key in full', async () => {

            const indexes: IndexSummary[] = [{
                name: 'job_username_nodename_database_schedule_idx',
                tableName: 'job',
                columns: ['username', 'nodename', 'database', 'schedule', 'command'],
                isUnique: true,
                isPrimary: false,
            }];

            const foreignKeys: ForeignKeySummary[] = [{
                name: 'job_run_details_jobid_fkey',
                tableName: 'job_run_details',
                columns: ['jobid'],
                referencedTable: 'cron.job_definitions_and_history',
                referencedColumns: ['jobid'],
            }];

            const detail = cronJob();

            detail.indexes = indexes;
            detail.foreignKeys = foreignKeys;

            const rows = tableDetailRows(detail, WIDE);
            const view = await scroller(rows, rows.length + 20);

            await view.press(KEY.value, (frame) => frame.includes(LONG_DEFAULT));

            const flat = view.frame().replace(/\n/g, '');

            expect(flat).toContain(LONG_DEFAULT);
            expect(flat).toContain('job_username_nodename_database_schedule_idx');
            expect(flat).toContain('username, nodename, database, schedule, command');
            expect(flat).toContain('cron.job_definitions_and_history');

            view.unmount();

        });

        it('should carry a parameter and a definition line in full', async () => {

            const parameters: ParameterDetail[] = [
                { name: 'p_tenant_identifier_with_a_long_name', dataType: 'timestamp with time zone', mode: 'INOUT', ordinalPosition: 1 },
            ];

            const rows = procedureDetailRows({
                name: 'rebuild_index',
                schema: 'public',
                parameters,
                definition: 'begin refresh materialized view concurrently public.tenant_rollup; end;',
            }, WIDE);

            const view = await scroller(rows, rows.length + 20);

            await view.press(KEY.value, (frame) => frame.includes('INOUT'));

            const flat = view.frame().replace(/\n/g, '');

            expect(flat).toContain('p_tenant_identifier_with_a_long_name');
            expect(flat).toContain('timestamp with time zone');
            expect(flat).toContain('refresh materialized view concurrently');

            view.unmount();

        });

    });

    describe('giving the screen back', () => {

        it('should restore the exact scroll offset on Escape', async () => {

            const view = await scroller(tableDetailRows(wideTable(40), WIDE), HEIGHT);

            await view.press(KEY.end, (frame) => frame.includes('col_39'));

            const before = view.frame();

            await view.press(KEY.value, (frame) => frame.includes(OVERLAY_HEADER));

            expect(view.frame()).toContain(OVERLAY_HEADER);
            expect(view.frame()).not.toBe(before);

            await view.press(KEY.escape, (frame) => !frame.includes(OVERLAY_HEADER));

            expect(view.frame()).toBe(before);

            view.unmount();

        });

        it('should let the viewport keep scrolling once the overlay is gone', async () => {

            const view = await scroller(tableDetailRows(wideTable(40), WIDE), HEIGHT);

            await view.press(KEY.value, (frame) => frame.includes(OVERLAY_HEADER));

            expect(view.frame()).toContain(OVERLAY_HEADER);

            await view.press(KEY.escape, (frame) => !frame.includes(OVERLAY_HEADER));

            // Focus has to come back, or the screen is stuck on a viewport that
            // no longer answers to anything.
            await view.press(KEY.down, (frame) => frame.includes('col_07'));

            expect(view.frame()).toContain('col_07');

            view.unmount();

        });

        it('should leave the viewport keys inert while the overlay is up', async () => {

            const rows = tableDetailRows(wideTable(40), WIDE);
            const view = await scroller(rows, HEIGHT);

            await view.press(KEY.value, (frame) => frame.includes(OVERLAY_HEADER));

            // End belongs to the overlay now. It moves the overlay to its last
            // line; the viewport underneath must still be where it was.
            await view.press(KEY.end, (frame) => frame.includes('col_39'));

            expect(view.frame()).toContain(OVERLAY_HEADER);

            await view.press(KEY.escape, (frame) => !frame.includes(OVERLAY_HEADER));

            expect(view.frame()).toContain('public.wide_table');
            expect(view.frame()).not.toContain('col_39');

            view.unmount();

        });

    });

    describe('staying inside its budget', () => {

        it('should never draw more lines than the height it was given', async () => {

            const rows = tableDetailRows(wideTable(60), WIDE);
            const view = await scroller(rows, HEIGHT);

            await view.press(KEY.value, (frame) => frame.includes(OVERLAY_HEADER));

            expect(view.frame()).toContain(OVERLAY_HEADER);
            expect(view.frame().split('\n').length).toBeLessThanOrEqual(HEIGHT);

            view.unmount();

        });

        it('should open where the reader was, not back at the top', async () => {

            const rows = tableDetailRows(wideTable(60), WIDE);
            const view = await scroller(rows, HEIGHT);

            await view.press(KEY.end, (frame) => frame.includes('col_59'));
            await view.press(KEY.value, (frame) => frame.includes(OVERLAY_HEADER));

            const frame = view.frame();

            // `col_50` is the row the viewport had at its top after End. The
            // overlay draws one line fewer than the viewport, so the window is
            // not identical - what has to match is where it starts.
            expect(frame).toContain(OVERLAY_HEADER);
            expect(frame).toContain('col_50');
            expect(frame).not.toContain('public.wide_table');
            expect(frame).not.toContain('col_49');

            view.unmount();

        });

        it('should scroll the overlay itself when the full text overflows', async () => {

            const rows = tableDetailRows(wideTable(60), WIDE);
            const view = await scroller(rows, HEIGHT);

            await view.press(KEY.value, (frame) => frame.includes(OVERLAY_HEADER));

            expect(view.frame()).not.toContain('col_59');

            await view.press(KEY.end, (frame) => frame.includes('col_59'));

            expect(view.frame()).toContain('col_59');
            expect(view.frame()).toContain(OVERLAY_HEADER);

            view.unmount();

        });

    });

});
