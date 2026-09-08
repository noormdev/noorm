/**
 * ScrollPane - a vertical viewport over a flat list of pre-laid-out lines.
 *
 * Ink has no scroll offset. A screen that renders more rows than the terminal
 * holds does not clip them, it pushes its own footer off the bottom, so the
 * content past the fold is not merely unscrolled — it is unreachable. Every
 * screen that can overflow therefore has to flatten itself to one element per
 * visual line and draw a slice of that list, which is what this does.
 *
 * It is the plain form of the pattern: offset state, the shared window
 * arithmetic, the shared scroll keys, and the two "more above / more below"
 * indicators. `ExploreDetailScreen`'s `ScrollView` is the same viewport with a
 * full-text overlay and a row peek switched in over the top of it, and it stays
 * where it is — its overlays are built from explore's own layout module, so
 * pulling it down here would drag a screen's vocabulary into a shared
 * component for no gain. Anything that needs a viewport and not those overlays
 * uses this.
 *
 * Takes `height` and `isFocused` as props rather than measuring or scoping for
 * itself, so the screen stays the single place that accounts for chrome, and so
 * a test can pin a viewport without a terminal to measure.
 *
 * @example
 * <ScrollPane lines={contextLines} height={viewportRows(rows)} isFocused={isFocused} />
 */
import { useState } from 'react';
import { Box, Text, useInput } from 'ink';

import type { ReactElement } from 'react';

import { useWheelScroll } from '../../mouse.js';
import { rowWindow, scrollTarget } from './viewport.js';

/**
 * Props for the scroll pane.
 */
export interface ScrollPaneProps {

    /**
     * One element per visual line, each carrying its own `key`.
     *
     * One *visual* line: an element that wraps to two rows makes the window
     * arithmetic wrong by one, so callers wrap their own text (`wrapText`) or
     * truncate it (`wrap="truncate"`) before handing it over.
     */
    lines: ReactElement[];

    /** Rows the viewport may draw, indicators included. */
    height: number;

    /** Focus comes from the screen; this component opens no scope of its own. */
    isFocused: boolean;

}

/**
 * ScrollPane component.
 */
export function ScrollPane({ lines, height, isFocused }: ScrollPaneProps): ReactElement {

    const [offset, setOffset] = useState(0);

    const view = rowWindow(lines.length, offset, height);
    const maxOffset = lines.length - view.count;

    const scrollTo = (next: number) => setOffset(Math.min(Math.max(next, 0), maxOffset));

    // Inert without a MouseProvider above it or with the setting off.
    useWheelScroll({ isActive: isFocused, onWheel: (delta) => scrollTo(view.start + delta) });

    useInput((input, key) => {

        if (!isFocused) return;

        // Rebases on `view.start` rather than on `offset`: the window clamps
        // what it draws, so a stale offset left by a resize or by shorter
        // content cannot send the next keypress somewhere the viewport never
        // was.
        const target = scrollTarget(input, key, view, maxOffset);

        if (target !== null) scrollTo(target);

    });

    return (
        <Box flexDirection="column">
            {view.above > 0 && <Text dimColor> ↑ {view.above} more</Text>}
            {lines.slice(view.start, view.start + view.count)}
            {view.below > 0 && <Text dimColor> ↓ {view.below} more</Text>}
        </Box>
    );

}
