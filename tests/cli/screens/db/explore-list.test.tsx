/**
 * Explore list row-identity tests.
 *
 * `schema.name` does not identify an index: SQL Server reuses `IX_UserId`
 * across tables and MySQL names every primary key `PRIMARY`. React keeps a
 * row whose key repeats, so scrolling a `SelectList` leaves the outgoing rows
 * drawn over the live window.
 *
 * Rows come from the real `exploreListItems` builder, so the keys under test
 * are the keys the screen hands to the list.
 */
import { describe, it, expect } from 'bun:test';
import { render } from 'ink-testing-library';
import React from 'react';

import type { FunctionSummary, IndexSummary } from '../../../../src/core/explore/types.js';

import { FocusProvider } from '../../../../src/tui/focus.js';
import { SelectList } from '../../../../src/tui/components/lists/index.js';
import { exploreListItems } from '../../../../src/tui/screens/db/explore/ExploreListScreen.js';

/** Rows the list may draw, pinned so the assertions do not depend on a terminal. */
const VISIBLE = 5;

const DOWN = '\x1B[B';

// eslint-disable-next-line no-control-regex -- matching the ANSI SGR escape is the point
const ANSI_PATTERN = /\u001B\[[0-9;]*m/g;

function strip(frame: string | undefined): string {

    return (frame ?? '').replace(ANSI_PATTERN, '');

}

/** Table number of the row the cursor is on, or -1 before the list draws. */
function cursorRow(frame: string | undefined): number {

    const match = /❯ .* on table_(\d+)/.exec(strip(frame));

    return match ? Number(match[1]) : -1;

}

async function waitFor(predicate: () => boolean, timeoutMs = 2000): Promise<void> {

    const deadline = Date.now() + timeoutMs;

    while (!predicate() && Date.now() < deadline) {

        await new Promise((resolve) => setTimeout(resolve, 10));

    }

}

/**
 * Press a key until the list says what we are waiting for. Counting presses
 * does not survive Ink: writes in a tight loop coalesce into one event, and
 * under load a fixed press budget runs out before the cursor arrives.
 */
async function pressUntil(
    stdin: { write: (data: string) => void },
    sequence: string,
    predicate: () => boolean,
    timeoutMs = 10000,
): Promise<void> {

    const deadline = Date.now() + timeoutMs;

    while (!predicate() && Date.now() < deadline) {

        stdin.write(sequence);

        await new Promise((resolve) => setTimeout(resolve, 10));

    }

}

/** Three index names shared across many tables, the SQL Server shape. */
function sharedNameIndexes(tableCount: number): IndexSummary[] {

    return Array.from({ length: tableCount }, (_, index) => ({
        name: `IX_${['UserId', 'ProjectId', 'EmployeeId'][index % 3]}`,
        schema: 'dbo',
        tableName: `table_${String(index).padStart(2, '0')}`,
        tableSchema: 'dbo',
        columns: ['id'],
        isUnique: false,
        isPrimary: false,
    }));

}

describe('cli: explore list row identity', () => {

    it('should give every MySQL primary key its own row', () => {

        const indexes: IndexSummary[] = ['users', 'orders', 'products'].map((tableName) => ({
            name: 'PRIMARY',
            schema: 'shop',
            tableName,
            tableSchema: 'shop',
            columns: ['id'],
            isUnique: true,
            isPrimary: true,
        }));

        const keys = exploreListItems('indexes', indexes).map((item) => item.key);

        expect(new Set(keys).size).toBe(indexes.length);

    });

    it('should give every PostgreSQL overload its own row', () => {

        // Same name, same arity, same return type: only the argument list tells
        // these apart.
        const overloads: FunctionSummary[] = ['v integer', 'v text'].map((signature) => ({
            name: 'normalize',
            schema: 'public',
            parameterCount: 1,
            returnType: 'text',
            signature,
        }));

        const keys = exploreListItems('functions', overloads).map((item) => item.key);

        expect(new Set(keys).size).toBe(overloads.length);

    });

    it('should draw only the live window after scrolling indexes whose names repeat', async () => {

        const items = exploreListItems('indexes', sharedNameIndexes(40));

        const { stdin, lastFrame, unmount } = render(
            <FocusProvider>
                <SelectList items={items} visibleCount={VISIBLE} numberNav />
            </FocusProvider>,
        );

        await waitFor(() => strip(lastFrame()).includes('table_00'));

        // At or past a row, not on it: under load a press can land before the
        // frame is read, and an exact target then costs a full wrap of the list.
        await pressUntil(stdin, DOWN, () => cursorRow(lastFrame()) >= 15);

        const lines = strip(lastFrame()).split('\n');
        const rows = lines.filter((line) => line.includes(' on table_'));
        const cursors = lines.filter((line) => line.includes('❯'));

        expect(rows).toHaveLength(VISIBLE);
        expect(cursors).toHaveLength(1);

        unmount();

    });

});
