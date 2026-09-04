/**
 * FullTextOverlay - the detail viewport with nothing truncated.
 *
 * The explore rows align because every cell is sized once per section and
 * truncated at its edge, which is what makes a column of types readable and
 * also what puts a long Postgres default out of reach. This is the way back to
 * it: the same rows, in the same order, wrapped to the terminal instead of cut,
 * scrolled with the same keys, and dismissed with Escape.
 *
 * It shows every row rather than one, because the viewport has no row cursor to
 * ask - arrow keys move the window, not a selection - and because a reader who
 * cannot see a value usually cannot see the two beside it either. It opens on
 * whichever row was at the top of the viewport, so dismissing it lands the
 * reader back where they started.
 *
 * Focus follows the overlay pattern `LogViewerOverlay` established: its own
 * `useFocusScope`, its own `useInput` guarded on `isFocused`, and Escape as the
 * only way out. It lives here rather than in `components/overlays/` because it
 * is built from this screen's layout module, and a shared component reaching
 * back into a screen is the wrong direction.
 *
 * @example
 * <FullTextOverlay text={rows.map((row) => row.text)} startRow={view.start} height={height} onClose={close} />
 */
import { useMemo, useState } from 'react';
import { Box, Text, useInput, useWindowSize } from 'ink';

import type { ReactElement } from 'react';

import { useFocusScope } from '../../../focus.js';
import { useWheelScroll } from '../../../mouse.js';
import { rowBudget, rowWindow, scrollTarget, wrapText } from './layout.js';

/**
 * Props for the full-text overlay.
 */
export interface FullTextOverlayProps {

    /** Untruncated text, one entry per row the viewport draws. */
    text: string[];

    /** Row the viewport had at its top, so the overlay opens where the reader was. */
    startRow: number;

    /** Lines the overlay may draw, its header included. */
    height: number;

    /** Called when the reader dismisses the overlay. */
    onClose: () => void;

}

/** The header line, which is also how a reader knows which view they are in. */
const HEADER_ROWS = 1;

/**
 * Wrapped lines, plus where each row's first line landed.
 *
 * The index is what lets the overlay open on the row the viewport had at its
 * top: a row is one line up there and however many the wrap needs down here, so
 * the two offsets are not the same number.
 */
function layoutLines(text: string[], width: number): { lines: string[]; rowStarts: number[] } {

    const lines: string[] = [];
    const rowStarts: number[] = [];

    for (const row of text) {

        rowStarts.push(lines.length);
        lines.push(...wrapText(row, width));

    }

    return { lines, rowStarts };

}

/**
 * FullTextOverlay component.
 */
export function FullTextOverlay({ text, startRow, height, onClose }: FullTextOverlayProps): ReactElement {

    const { isFocused } = useFocusScope('ExploreFullText');

    // useWindowSize rather than a prop: the wrap width is the terminal's, and
    // this is the one place that has to recompute when the terminal resizes.
    const { columns } = useWindowSize();

    const width = rowBudget(columns);

    const { lines, rowStarts } = useMemo(() => layoutLines(text, width), [text, width]);

    const [offset, setOffset] = useState(() => rowStarts[startRow] ?? 0);

    const budget = Math.max(1, height - HEADER_ROWS);
    const view = rowWindow(lines.length, offset, budget);
    const maxOffset = lines.length - view.count;

    const scrollTo = (next: number) => setOffset(Math.min(Math.max(next, 0), maxOffset));

    // Inert without a MouseProvider above it or with the setting off.
    useWheelScroll({ isActive: isFocused, onWheel: (delta) => scrollTo(view.start + delta) });

    useInput((input, key) => {

        if (!isFocused) return;

        if (key.escape) {

            onClose();

            return;

        }

        const target = scrollTarget(input, key, view, maxOffset);

        if (target !== null) scrollTo(target);

    });

    return (
        <Box flexDirection="column">
            <Text dimColor>Full text · [Esc] Close</Text>
            {view.above > 0 && <Text dimColor> ↑ {view.above} more</Text>}
            {lines.slice(view.start, view.start + view.count).map((line, index) => (
                <Text key={`full:${view.start + index}`}>{line}</Text>
            ))}
            {view.below > 0 && <Text dimColor> ↓ {view.below} more</Text>}
        </Box>
    );

}
