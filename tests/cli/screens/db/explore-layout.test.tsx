/**
 * Explore viewer column-alignment tests.
 *
 * Ink's `width` is a flex basis and flex items shrink by default, so the
 * explore lists re-flowed per row: a column carrying a long DEFAULT expression
 * squeezed the name and type cells, a column carrying none left them full
 * width, and the type column landed on a different offset on nearly every row
 * of `cron.job`. The contract pinned here is that a row's cell offsets are a
 * property of the section, not of what that row happens to hold.
 *
 * Every case renders inside a container of exactly the budgeted width. That is
 * what the terminal does, and it is the only way a cell that still shrinks or
 * a row that still overflows shows up in the frame.
 *
 * Fixtures are the real `cron.job` shape, because that is where the report
 * came from: a long `nextval(...)` default, a 30-character identifier, and a
 * nullable column with no default at all.
 */
import { describe, it, expect } from 'bun:test';
import { render } from 'ink-testing-library';
import { Box } from 'ink';
import React from 'react';

import type { ReactElement } from 'react';
import type { ColumnDetail, ParameterDetail, IndexSummary, ExploreOverview } from '../../../../src/core/explore/types.js';

import { columnRows, parameterRows, indexRows } from '../../../../src/tui/screens/db/explore/ExploreDetailScreen.js';

import type { DetailRow } from '../../../../src/tui/screens/db/explore/layout.js';
import { CategoryList, countBrowsableObjects } from '../../../../src/tui/screens/db/explore/ExploreOverviewScreen.js';

/** Labels of every category the overview screen renders a row for. */
const CATEGORY_LABELS = ['Tables', 'Views', 'Procedures', 'Functions', 'Types', 'Indexes', 'Foreign Keys'];

/** Row budget inside the explore Panel on a 120-column terminal. */
const ROOMY = 116;

/** Row budget inside the explore Panel on a 100-column terminal. */
const WIDE = 96;

/** Row budget inside the explore Panel on a 50-column terminal. */
const NARROW = 46;

// eslint-disable-next-line no-control-regex -- matching the ANSI SGR escape is the point
const ANSI_PATTERN = /\u001B\[[0-9;]*m/g;

/** Column assertions have to run against the text, not the styling. */
function strip(frame: string | undefined): string {

    return (frame ?? '').replace(ANSI_PATTERN, '');

}

/**
 * Render a list in a container of exactly the width it was budgeted, so the
 * frame reflects what a terminal that size would actually draw.
 */
function frameAt(width: number, element: ReactElement): string {

    return strip(render(<Box width={width}>{element}</Box>).lastFrame());

}

/**
 * The detail sections are flat row arrays now, so the scroll viewport can slice
 * them. Stacking their elements in a column Box is what the viewport does, and
 * what the section Box used to do, so the frame under test is unchanged.
 *
 * Only `element` is drawn here. The `text` beside it is the same line with
 * nothing truncated, which is the full-text overlay's business, not this file's.
 */
function rowsFrameAt(width: number, rows: DetailRow[]): string {

    return frameAt(width, <Box flexDirection="column">{rows.map((row) => row.element)}</Box>);

}

function lineWith(frame: string, needle: string): string {

    return frame.split('\n').find((line) => line.includes(needle)) ?? '';

}

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
 * `cron.job` as the report saw it, plus the 30-character identifier and the
 * nullable no-default column the layout has to survive.
 */
const CRON_JOB: ColumnDetail[] = [
    column('jobid', 'bigint', { isPrimaryKey: true, defaultValue: 'nextval(\'cron.jobid_seq\'::regclass)' }),
    column('schedule', 'text'),
    column('command', 'text'),
    column('nodename', 'text', { defaultValue: '\'localhost\'::text' }),
    column('nodeport', 'integer', { defaultValue: 'inet_server_port()' }),
    column('database', 'text', { defaultValue: 'current_database()' }),
    column('username', 'text', { defaultValue: 'CURRENT_USER' }),
    column('active', 'boolean', { defaultValue: 'true' }),
    column('jobname', 'text', { isNullable: true }),
    column('last_successful_run_started_at', 'timestamp with time zone', { isNullable: true }),
];

/**
 * Locate a row by a prefix of its name, and its cells by a prefix of their
 * text, so the same offset assertions hold on a terminal narrow enough to
 * truncate both. A prefix pins the cell's starting offset exactly, which is
 * the property under test.
 */
function rowLine(frame: string, name: string): string {

    return lineWith(frame, name.slice(0, 8));

}

/** Where each row's data-type cell starts. */
function typeOffsets(frame: string, columns: ColumnDetail[]): number[] {

    return columns.map((col) => rowLine(frame, col.name).indexOf(col.dataType.slice(0, 4)));

}

/** Where each row's nullability cell starts. */
function constraintOffsets(frame: string, columns: ColumnDetail[]): number[] {

    return columns.map((col) => rowLine(frame, col.name).indexOf(col.isNullable ? 'NULL' : 'NOT N'));

}

describe('cli: screens/db/explore layout', () => {

    describe('ColumnList', () => {

        it('should start every row\'s type and constraint cell on the same offset', () => {

            const frame = rowsFrameAt(WIDE, columnRows(CRON_JOB, WIDE));

            const types = typeOffsets(frame, CRON_JOB);
            const constraints = constraintOffsets(frame, CRON_JOB);

            expect(types).not.toContain(-1);
            expect(types[0]).toBeGreaterThan(0);
            expect(new Set(types).size).toBe(1);

            expect(constraints).not.toContain(-1);
            expect(constraints[0]).toBeGreaterThan(types[0] ?? 0);
            expect(new Set(constraints).size).toBe(1);

        });

        it('should render one line per column, never wrapping a long default', () => {

            const frame = rowsFrameAt(WIDE, columnRows(CRON_JOB, WIDE));

            expect(frame.split('\n')).toHaveLength(CRON_JOB.length);

        });

        it('should show a long default in full when the terminal has room', () => {

            const frame = rowsFrameAt(ROOMY, columnRows(CRON_JOB, ROOMY));

            expect(frame).toContain('NOT NULL DEFAULT nextval(\'cron.jobid_seq\'::regclass)');
            expect(frame.split('\n')).toHaveLength(CRON_JOB.length);

        });

        it('should truncate a default that does not fit rather than wrap it under the type column', () => {

            const frame = rowsFrameAt(WIDE, columnRows(CRON_JOB, WIDE));

            expect(lineWith(frame, 'jobid')).toContain('NOT NULL DEFAULT nextval(');
            expect(lineWith(frame, 'jobid')).toEndWith('…');
            expect(frame.split('\n')).toHaveLength(CRON_JOB.length);

        });

        it('should size the name cell from the longest name rather than a fixed width', () => {

            const short = [column('id', 'bigint'), column('name', 'text')];

            const narrowNames = rowsFrameAt(WIDE, columnRows(short, WIDE));
            const wideNames = rowsFrameAt(WIDE, columnRows(CRON_JOB, WIDE));

            expect(lineWith(narrowNames, 'id').indexOf('bigint'))
                .toBeLessThan(lineWith(wideNames, 'jobid').indexOf('bigint'));

        });

        it('should truncate an over-long identifier instead of moving the type column', () => {

            const pathological = 'a_generated_constraint_name_that_nobody_would_ever_type_by_hand';
            const columns = [column('id', 'bigint'), column(pathological, 'text')];

            const frame = rowsFrameAt(WIDE, columnRows(columns, WIDE));

            expect(frame).not.toContain(pathological);
            expect(frame).toContain('…');
            expect(lineWith(frame, 'a_generated').indexOf('text'))
                .toBe(lineWith(frame, 'id').indexOf('bigint'));

        });

        it('should still fit one line per row on a narrow terminal', () => {

            const frame = rowsFrameAt(NARROW, columnRows(CRON_JOB, NARROW));
            const lines = frame.split('\n');

            expect(lines).toHaveLength(CRON_JOB.length);

            for (const line of lines) {

                expect(line.length).toBeLessThanOrEqual(NARROW);

            }

            expect(new Set(typeOffsets(frame, CRON_JOB)).size).toBe(1);

        });

        it('should mark the primary key without shifting the other rows', () => {

            const frame = rowsFrameAt(WIDE, columnRows(CRON_JOB, WIDE));

            expect(lineWith(frame, 'jobid')).toContain('* jobid');
            expect(lineWith(frame, 'schedule')).toContain('  schedule');

        });

    });

    describe('ParameterList', () => {

        const parameters: ParameterDetail[] = [
            { name: 'p_tenant_identifier', dataType: 'uuid', mode: 'IN', ordinalPosition: 1 },
            { name: 'p_from', dataType: 'timestamp with time zone', mode: 'IN', ordinalPosition: 2 },
            { name: 'p_rows', dataType: 'integer', mode: 'OUT', ordinalPosition: 3 },
        ];

        it('should start every row\'s type and mode cell on the same offset', () => {

            const frame = rowsFrameAt(WIDE, parameterRows(parameters, WIDE));

            const types = parameters.map((param) => lineWith(frame, param.name).indexOf(param.dataType));
            const modes = parameters.map((param) => lineWith(frame, param.name).lastIndexOf(param.mode));

            expect(types).not.toContain(-1);
            expect(types[0]).toBeGreaterThan(0);
            expect(new Set(types).size).toBe(1);
            expect(new Set(modes).size).toBe(1);

        });

    });

    describe('IndexList', () => {

        const indexes: IndexSummary[] = [
            { name: 'job_pkey', tableName: 'job', columns: ['jobid'], isUnique: true, isPrimary: true },
            {
                name: 'job_username_nodename_database_idx',
                tableName: 'job',
                columns: ['username', 'nodename', 'database'],
                isUnique: false,
                isPrimary: false,
            },
            { name: 'job_active_idx', tableName: 'job', columns: ['active'], isUnique: false, isPrimary: false },
        ];

        it('should start every row\'s column list on the same offset', () => {

            const frame = rowsFrameAt(WIDE, indexRows(indexes, WIDE));

            const offsets = indexes.map((idx) => lineWith(frame, idx.name.slice(0, 12)).indexOf('('));

            expect(offsets).not.toContain(-1);
            expect(offsets[0]).toBeGreaterThan(0);
            expect(new Set(offsets).size).toBe(1);

        });

        it('should render one line per index on a narrow terminal', () => {

            const frame = rowsFrameAt(NARROW, indexRows(indexes, NARROW));

            expect(frame.split('\n')).toHaveLength(indexes.length);

        });

    });

    describe('CategoryList', () => {

        const overview: ExploreOverview = {
            tables: 42,
            views: 7,
            procedures: 0,
            functions: 130,
            types: 3,
            indexes: 88,
            foreignKeys: 21,
            triggers: 0,
            locks: 0,
            connections: 0,
        };

        it('should start every count on the same offset', () => {

            const frame = frameAt(WIDE, <CategoryList overview={overview} width={WIDE} />);

            const offsets = [
                lineWith(frame, 'Tables').indexOf('42'),
                lineWith(frame, 'Views').indexOf('7'),
                lineWith(frame, 'Functions').indexOf('130'),
                lineWith(frame, 'Foreign Keys').indexOf('21'),
            ];

            expect(offsets).not.toContain(-1);
            expect(offsets[0]).toBeGreaterThan(0);
            expect(new Set(offsets).size).toBe(1);

        });

        it('should not pad a cell wider than its content needs', () => {

            const frame = frameAt(WIDE, <CategoryList overview={overview} width={WIDE} />);

            // `[1]` is three columns, so the label starts one gap later, not at
            // whatever minimum the allocator happens to carry.
            expect(lineWith(frame, 'Tables').indexOf('Tables')).toBe(5);

        });

    });

    describe('countBrowsableObjects', () => {

        // triggers, locks and connections have no row on this screen, and locks
        // and connections are runtime state rather than schema objects.
        // Counting them made the total exceed the rows a reader could see.
        const withRuntimeState: ExploreOverview = {
            tables: 42,
            views: 7,
            procedures: 0,
            functions: 130,
            types: 3,
            indexes: 88,
            foreignKeys: 21,
            triggers: 5,
            locks: 9,
            connections: 12,
        };

        it('should count only the categories the screen lists', () => {

            expect(countBrowsableObjects(withRuntimeState)).toBe(291);

        });

        it('should equal the sum of the counts it renders', () => {

            const frame = frameAt(WIDE, <CategoryList overview={withRuntimeState} width={WIDE} />);

            const rendered = CATEGORY_LABELS
                .map((label) => Number(lineWith(frame, label).match(/(\d+)\s*$/)?.[1] ?? 0))
                .reduce((sum, count) => sum + count, 0);

            expect(countBrowsableObjects(withRuntimeState)).toBe(rendered);

        });

    });

});
