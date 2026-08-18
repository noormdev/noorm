/**
 * RowPeekOverlay - the first and last rows of a table, on demand.
 *
 * The detail screen describes a table's shape and never its contents, so the
 * only way to see what is actually in one was to leave for the SQL terminal and
 * write the query by hand. This is that query, bound to a key.
 *
 * Three things about it are deliberate:
 *
 * - **It reads nothing until asked.** Opening a table's detail must not fetch
 *   rows, so the query fires when this component mounts, which is when the
 *   reader pressed `p`.
 * - **It is gated on `sql:read`, not `explore`.** Every other explore screen
 *   reads catalog metadata; this one reads user data. `fetchRowPeek` refuses
 *   before it queries, and a refusal lands in the error state below rather than
 *   as an unhandled throw.
 * - **It draws with `ResultTable`.** Column widths, chopping a wide table down
 *   to what the row can hold, truncation and windowing are already solved
 *   there, and a second table renderer would have to solve them again and
 *   drift. This component hands over every column the table has and lets the
 *   grid decide which of them fit.
 *
 * Exactly one table is live at a time. Two cursors on screen would be a claim
 * that Enter lands in both places, so the unfocused set draws none, advertises
 * none of its keys, and ignores input; `Tab` moves focus between them.
 *
 * **Escape is not this component's key while a table is up.** `ResultTable`
 * already owns Escape by mode — it cancels a filter, then it leaves sort mode,
 * and only in browse mode does it call `onEscape`. Ink delivers every keystroke
 * to every registered handler, so a handler here that also closed on Escape
 * would close the peek out from under a reader who was only cancelling a
 * filter. The focused table gets `onEscape={onClose}` instead, and this
 * component claims Escape only while there is no table to hand it to, which is
 * the loading and error states.
 *
 * Focus follows the same pattern `FullTextOverlay` uses: its own
 * `useFocusScope`, its own `useInput` guarded on `isFocused`.
 *
 * @example
 * <RowPeekOverlay db={db} dialect="postgres" detail={detail} gate={gate} height={20} onClose={close} />
 */
import { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { attempt } from '@logosdx/utils';

import type { ReactElement } from 'react';
import type { Kysely } from 'kysely';

import type { Dialect } from '../../../../core/connection/types.js';
import type { RowPeek, RowPeekGate, TableDetail } from '../../../../core/explore/index.js';

import { fetchRowPeek } from '../../../../core/explore/index.js';
import { useFocusScope } from '../../../focus.js';
import { useAsyncEffect } from '../../../hooks/index.js';
import { Spinner } from '../../../components/index.js';
import { ResultTable, RowViewOverlay } from '../../../components/terminal/index.js';

/**
 * Props for the row peek overlay.
 */
export interface RowPeekOverlayProps {

    /** Connection the rows are read over. */
    db: Kysely<unknown>;

    /** Dialect, which decides how the page is limited and quoted. */
    dialect: Dialect;

    /** The table, as the detail screen already fetched it. */
    detail: TableDetail;

    /** Config name, access roles and channel the read is checked against. */
    gate: RowPeekGate;

    /** Lines the overlay may draw, its header included. */
    height: number;

    /** Called when the reader dismisses the overlay. */
    onClose: () => void;

}

/**
 * The header line, which names the table and the keys the peek answers to.
 *
 * One line, and truncated rather than wrapped, so the row budget below stays
 * arithmetic rather than a guess about how the terminal will re-flow it.
 */
const HEADER_ROWS = 1;

/** The line naming a set, above its table. */
const LABEL_ROWS = 1;

/**
 * Rows one `ResultTable` spends on everything that is not a row: its status
 * line and the blank under it, the header, the rule, and the count line with
 * the blank above it. Counted rather than measured because the page size has to
 * be decided before the first query, and `measureElement` can only answer after
 * a render.
 */
const TABLE_CHROME_ROWS = 5;

/** Rows a set costs before it holds anything. */
const SET_CHROME_ROWS = LABEL_ROWS + TABLE_CHROME_ROWS;

/** Most rows either set shows, however tall the terminal is. */
const MAX_SET_ROWS = 10;

/**
 * Rows one set may draw, given how many sets share the viewport.
 *
 * @example
 * setRows(28, 2); // 8 — two labelled tables and a header in 28 lines
 */
export function setRows(height: number, sets: number): number {

    return Math.max(1, Math.floor((height - HEADER_ROWS - sets * SET_CHROME_ROWS) / sets));

}

/**
 * How many rows to read per set.
 *
 * Derived from the terminal rather than fixed at ten, because two sets of ten
 * plus their chrome need 33 lines and most terminals are shorter than that:
 * reading rows the viewport cannot draw would leave them behind a scroll
 * indicator with no key to reach them. Budgeted for two sets, which is the
 * worst case — a single-set result has room to spare.
 *
 * @example
 * peekPageSize(48); // 10 — the cap, not the space
 * peekPageSize(30); // 4
 */
export function peekPageSize(height: number): number {

    return Math.min(MAX_SET_ROWS, setRows(height, 2));

}

/**
 * What each set is called, given what came back.
 *
 * `whole` earns "All", because the reader is looking at the table rather than
 * an end of it, and saying "first" over a complete table invites the question
 * of what was left out.
 */
function headings(peek: RowPeek): { first: string; last: string | null } {

    const by = peek.keyColumns.length > 0 ? ` by ${peek.keyColumns.join(', ')}` : '';

    if (peek.mode === 'ends') {

        return {
            first: `First ${peek.first.length}${by}`,
            last: `Last ${peek.last.length}${by}`,
        };

    }

    if (peek.mode === 'head') {

        return { first: `First ${peek.first.length}`, last: null };

    }

    return { first: `All ${peek.first.length} row${peek.first.length === 1 ? '' : 's'}${by}`, last: null };

}

/** Which of the two sets a key or a cursor belongs to. */
type PeekSetName = 'first' | 'last';

/**
 * One labelled set.
 *
 * `autoSort` is off: `ResultTable` otherwise re-sorts by whichever column looks
 * like a date or an id, which would silently replace the primary-key order the
 * query was built to guarantee and make "first" and "last" mean nothing.
 *
 * The cursor is controlled from above rather than left to the table, because
 * the row view moves it too: `←`/`→` in there have to move the same cursor the
 * arrows move here, or escaping out lands on a row the reader was not reading.
 */
function PeekSet({ label, columns, rows, maxRows, active, cursor, onCursor, onSelect, onTab, onEscape }: {
    label: string;
    columns: string[];
    rows: Record<string, unknown>[];
    maxRows: number;
    active: boolean;
    cursor: number;
    onCursor: (index: number) => void;
    onSelect: (row: Record<string, unknown>, index: number, list: Record<string, unknown>[]) => void;
    onTab?: () => void;
    onEscape: () => void;
}): ReactElement {

    return (
        <Box flexDirection="column">
            <Text bold underline={active} dimColor={!active}>{label}</Text>
            <ResultTable
                columns={columns}
                rows={rows}
                maxVisibleRows={maxRows}
                active={active}
                autoSort={false}
                highlightedRow={cursor}
                onHighlightChange={onCursor}
                onSelect={onSelect}
                {...(onTab ? { onTab } : {})}
                onEscape={onEscape}
            />
        </Box>
    );

}

/**
 * RowPeekOverlay component.
 */
export function RowPeekOverlay({
    db,
    dialect,
    detail,
    gate,
    height,
    onClose,
}: RowPeekOverlayProps): ReactElement {

    const { isFocused } = useFocusScope('ExploreRowPeek');

    const [peek, setPeek] = useState<RowPeek | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [focusedSet, setFocusedSet] = useState<PeekSetName>('first');
    const [cursors, setCursors] = useState<Record<PeekSetName, number>>({ first: 0, last: 0 });

    // The set whose row is open, and the rows as that table was displaying them
    // — filtered and sorted, which is what ←/→ have to walk so the viewer moves
    // through what the reader can see rather than through what was fetched.
    const [subject, setSubject] = useState<{ set: PeekSetName; rows: Record<string, unknown>[] } | null>(null);

    // The page size is fixed at mount rather than tracked: it decides what was
    // read, and a resize cannot retroactively change that. The row budget
    // below does track the terminal, so a shrink windows what is already here.
    const [pageSize] = useState(() => peekPageSize(height));

    useAsyncEffect(async (isCancelled) => {

        const [result, err] = await attempt(() => fetchRowPeek(db, dialect, detail, gate, pageSize));

        if (isCancelled()) return;

        if (err || !result) {

            setError(err?.message ?? 'No rows returned');

            return;

        }

        setPeek(result);

    }, []);

    // Escape only while there is no table to hand it to. Once one is up it owns
    // the key by mode — cancel filter, leave sort, then close — and a second
    // handler here would fire alongside it and close the peek on a keystroke
    // the reader meant for the filter box.
    useInput((_input, key) => {

        if (!isFocused || peek !== null) return;

        if (key.escape) onClose();

    });

    const qualified = `${detail.schema ? `${detail.schema}.` : ''}${detail.name}`;
    const header = <Text dimColor wrap="truncate">Rows · {qualified} · [Esc] Close</Text>;

    if (error) {

        return (
            <Box flexDirection="column">
                {header}
                <Text color="red">Could not read rows</Text>
                <Text dimColor>{error}</Text>
            </Box>
        );

    }

    if (!peek) {

        return (
            <Box flexDirection="column">
                {header}
                <Spinner label={`Reading ${qualified}...`} />
            </Box>
        );

    }

    const label = headings(peek);
    const sets = label.last === null ? 1 : 2;
    const maxRows = setRows(height, sets);

    const setRowsFor = (set: PeekSetName) => (set === 'first' ? peek.first : peek.last);
    const setLabelFor = (set: PeekSetName) => (set === 'first' ? label.first : label.last ?? '');

    const moveCursor = (set: PeekSetName, index: number) => setCursors(
        (current) => (current[set] === index ? current : { ...current, [set]: index }),
    );

    const swap = () => setFocusedSet((current) => (current === 'first' ? 'last' : 'first'));

    // `[↵] Open` is not named here. `ResultTable` advertises it on whichever
    // table is focused, because it is the table's key, and naming it twice on
    // one screen reads as two different things to press.
    const keys = [
        '[↑↓] Row',
        ...(sets > 1 ? ['[Tab] Set'] : []),
        '[Esc] Close',
    ].join('  ');

    const setProps = (set: PeekSetName) => ({
        label: setLabelFor(set),
        columns: peek.columns,
        rows: setRowsFor(set),
        maxRows,
        active: subject === null && focusedSet === set,
        cursor: cursors[set],
        onCursor: (index: number) => moveCursor(set, index),
        onSelect: (_row: Record<string, unknown>, index: number, list: Record<string, unknown>[]) => {

            moveCursor(set, index);
            setSubject({ set, rows: list });

        },
        ...(sets > 1 ? { onTab: swap } : {}),
        onEscape: onClose,
    });

    return (
        <Box flexDirection="column">
            {/* `display` rather than a swap: unmounting the tables to make room
                for the row view would throw away the cursor and the scroll
                offset that Escape is supposed to come back to. */}
            <Box flexDirection="column" display={subject === null ? 'flex' : 'none'}>
                <Text dimColor wrap="truncate">Rows · {qualified} · {keys}</Text>
                <PeekSet {...setProps('first')} />
                {label.last !== null && <PeekSet {...setProps('last')} />}
                {peek.mode === 'head' && (
                    <Text dimColor wrap="truncate">
                        No primary key, so there is no last set — rows are in storage order.
                    </Text>
                )}
            </Box>
            {subject !== null && (
                <RowViewOverlay
                    rows={subject.rows}
                    index={cursors[subject.set]}
                    columns={peek.columns}
                    setLabel={setLabelFor(subject.set)}
                    height={height}
                    onMove={(index) => moveCursor(subject.set, index)}
                    onClose={() => setSubject(null)}
                />
            )}
        </Box>
    );

}
