/**
 * RowViewOverlay - one row of a result grid, every column of it, in JSON or
 * YAML.
 *
 * `ResultTable` has to fit a table across a terminal, so it truncates every
 * cell and, on a wide table, drops the columns that will not fit at a readable
 * width. That is a reasonable trade only if there is a way to the whole row,
 * and this is it: the cursor's row as a key/value document, one field per line,
 * with nothing cut and nothing hidden.
 *
 * It sits beside `ResultTable` rather than beside either of its callers: the
 * explore peek and the SQL screens both draw the same grid and both owe the
 * reader the same way out of it, and two copies of this would drift.
 *
 * Four decisions worth stating:
 *
 * - **The index is controlled.** The caller owns which row is selected, because
 *   the same number drives the cursor in the table underneath. Moving here and
 *   moving there have to be the same move, or Escape lands the reader on a
 *   different row than the one they were reading.
 * - **`←` and `→` stop at the ends of the list.** They do not wrap, and in the
 *   peek's `ends` mode they do not cross from the first set into the last. Both
 *   sets are slices with an unknown number of rows between them, so a `→` that
 *   slid across the gap would draw two non-adjacent rows as neighbours.
 *   Crossing is Escape, then Tab, which is a deliberate act.
 * - **`↑` and `↓` scroll the document**, using the same `scrollTarget` the
 *   detail viewport and the full-text overlay use, so a forty-column row is
 *   reachable by the keys the reader already learned elsewhere.
 * - **The format is remembered for the session**, not for the component. See
 *   `rowDocument.ts` for where and why.
 *
 * @example
 * <RowViewOverlay rows={peek.first} index={cursor} columns={peek.columns}
 *     setLabel="First 10 by id" height={20} onMove={setCursor} onClose={close} />
 */
import { useEffect, useMemo, useState } from 'react';
import { Box, Text, useInput, useWindowSize } from 'ink';

import type { ReactElement } from 'react';

import type { RowFormat } from './rowDocument.js';

import { useFocusScope } from '../../focus.js';
import { useWheelScroll } from '../../mouse.js';
import { preferredRowFormat, rememberRowFormat, renderRowDocument } from './rowDocument.js';
import { rowBudget, rowWindow, scrollTarget, wrapText } from './viewport.js';

/**
 * Props for the row view overlay.
 */
export interface RowViewOverlayProps {

    /** The list the cursor is in, in the order the grid drew it. */
    rows: Record<string, unknown>[];

    /** Which row of `rows` is on screen. Owned by the caller. */
    index: number;

    /** Column names in ordinal order, so the document reads like the grid did. */
    columns: string[];

    /** What the list is called, e.g. `First 10 by id` or `Results`. */
    setLabel: string;

    /** Lines the overlay may draw, its header included. */
    height: number;

    /** Told when `←`/`→` move the cursor, so the table underneath follows. */
    onMove: (index: number) => void;

    /** Called when the reader dismisses the overlay. */
    onClose: () => void;

}

/** The position line and the key line. Both truncate, so both are one row. */
const HEADER_ROWS = 2;

/**
 * RowViewOverlay component.
 */
export function RowViewOverlay({
    rows,
    index,
    columns,
    setLabel,
    height,
    onMove,
    onClose,
}: RowViewOverlayProps): ReactElement {

    const { isFocused } = useFocusScope('RowView');

    // useWindowSize rather than a prop: the wrap width is the terminal's, and
    // this is the one place that has to recompute when the terminal resizes.
    const { columns: terminalColumns } = useWindowSize();

    const [format, setFormat] = useState<RowFormat>(preferredRowFormat);
    const [offset, setOffset] = useState(0);

    const width = rowBudget(terminalColumns);
    const row = rows[index];

    const lines = useMemo(() => {

        if (!row) return ['(no row)'];

        return renderRowDocument(row, columns, format)
            .split('\n')
            .flatMap((line) => wrapText(line, width));

    }, [row, columns, format, width]);

    // A new row is a new document, so an offset carried over from the last one
    // would open it part-way down for no reason the reader can see.
    useEffect(() => setOffset(0), [index]);

    const budget = Math.max(1, height - HEADER_ROWS);
    const view = rowWindow(lines.length, offset, budget);
    const maxOffset = lines.length - view.count;

    const scrollTo = (next: number) => setOffset(Math.min(Math.max(next, 0), maxOffset));

    // Scrolls the document, not the row cursor: ←/→ change rows, and a wheel
    // that jumped between rows would lose the reader's place in a long one.
    // Inert without a MouseProvider above it or with the setting off.
    useWheelScroll({ isActive: isFocused, onWheel: (delta) => scrollTo(view.start + delta) });

    const move = (next: number) => {

        if (next < 0 || next > rows.length - 1 || next === index) return;

        onMove(next);

    };

    useInput((input, key) => {

        if (!isFocused) return;

        if (key.escape) {

            onClose();

            return;

        }

        if (key.leftArrow) {

            move(index - 1);

            return;

        }

        if (key.rightArrow) {

            move(index + 1);

            return;

        }

        // Ink reports Ctrl+F as `input === 'f'` with `key.ctrl` set, so the
        // modifier has to be excluded or a forward-page attempt toggles format.
        if (input === 'f' && !key.ctrl && !key.meta) {

            const next: RowFormat = format === 'yaml' ? 'json' : 'yaml';

            rememberRowFormat(next);
            setFormat(next);

            return;

        }

        const target = scrollTarget(input, key, view, maxOffset);

        if (target !== null) scrollTo(target);

    });

    const other = format === 'yaml' ? 'JSON' : 'YAML';

    return (
        <Box flexDirection="column">
            <Text dimColor wrap="truncate">
                Row · {setLabel} · row {index + 1} of {rows.length}
            </Text>
            <Text dimColor wrap="truncate">
                [←/→] Row  [↑/↓] Scroll  [f] {other}  [Esc] Back
            </Text>
            {view.above > 0 && <Text dimColor> ↑ {view.above} more</Text>}
            {lines.slice(view.start, view.start + view.count).map((line, position) => (
                <Text key={`row:${view.start + position}`} wrap="truncate">{line}</Text>
            ))}
            {view.below > 0 && <Text dimColor> ↓ {view.below} more</Text>}
        </Box>
    );

}
