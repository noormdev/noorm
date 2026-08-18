/**
 * Layout planning for the explore screens: cell widths across, row windows
 * down.
 *
 * Ink's `width` is a flex basis and flex items shrink by default, so a row of
 * fixed-width cells silently re-flows the moment a later cell is long: the
 * column list squeezed name and type on every row that carried a DEFAULT
 * expression and left them full width on every row that did not, so the
 * columns wandered down the screen. Cells are therefore sized once per
 * section from the content that section actually holds, rendered with
 * `flexShrink={0}`, and truncated rather than wrapped.
 *
 * Same idiom as the Form label gutter: derive from content, cap it, truncate
 * past the cap.
 *
 * Down the page the constraint is the opposite one. Ink has no scroll offset
 * and the only way to fake one on a nested tree is a negative margin, which
 * fights Yoga. So the detail screen flattens itself to one element per visual
 * line and `rowWindow` slices that list to what the terminal can draw.
 *
 * Truncating across is what makes the columns line up, and it is also what puts
 * a long value out of reach, so every row carries its untruncated `text`
 * alongside the element that draws it. One builder produces both, because two
 * builders would drift.
 *
 * The keymap and the footer hints live here too. Both are width decisions: the
 * footer is one wrapping line and the keys it can afford to name are bounded by
 * how many columns the terminal has.
 *
 * @example
 * const names = columns.map((col) => col.name);
 * const [nameWidth, typeWidth] = fitWidths(
 *     [cellWidth(names, IDENTIFIER_CAP), cellWidth(types, DATA_TYPE_CAP)],
 *     rowBudget(terminalColumns),
 * );
 */
import type { ReactElement } from 'react';

/** Columns between two cells in an explore row. */
export const CELL_GAP = 2;

/** Columns the `* ` primary-key marker occupies ahead of an identifier. */
export const MARKER_WIDTH = 2;

/**
 * Widest an identifier cell grows before it truncates. Fits the 30-character
 * identifier Postgres and MySQL allow in practice without letting a generated
 * 63-character name push every other column off the screen.
 */
export const IDENTIFIER_CAP = 32;

/** Widest a data-type cell grows. `timestamp with time zone` is exactly 24. */
export const DATA_TYPE_CAP = 24;

/** Widest a fixed label cell grows, e.g. the overview's category names. */
export const LABEL_CAP = 16;

/** No cell shrinks below this; past it the text carries no information. */
export const MIN_CELL_COLUMNS = 6;

/**
 * Rows the detail viewport gets once the chrome has taken its share.
 *
 * Re-exported rather than reimplemented: the detail screen is the same shape
 * every list screen has - shell, one titled Panel, a hotkey footer - so it
 * spends the same rows on chrome, and one copy of that accounting is enough.
 * Import it from here alongside `rowWindow`, which is the only thing it feeds.
 */
export { viewportRows } from '../../../hooks/useViewportRows.js';

/**
 * Row and viewport arithmetic, re-exported from where the SQL screens can also
 * reach it.
 *
 * These moved to `components/terminal/viewport.js` when the row document viewer
 * was promoted out of this directory: the viewer needs the same wrap width and
 * the same scroll keys, and a component may not import from a screen. Every
 * explore call site still imports them from here, because from an explore
 * screen's point of view nothing about them changed.
 */
export {
    halfPage,
    rowBudget,
    rowWindow,
    scrollTarget,
    wrapText,
} from '../../../components/terminal/viewport.js';
export type { RowWindow } from '../../../components/terminal/viewport.js';

/**
 * Truncate to a width, marking the cut so a reader knows the value continues.
 *
 * Ink's `wrap="truncate"` does this for rendered text; this is for the places
 * that need the truncated string itself.
 *
 * @example
 * truncateCell('information_schema', 8); // 'informa…'
 */
export function truncateCell(text: string, max: number): string {

    if (max <= 0) return '';

    if (text.length <= max) return text;

    return `${text.slice(0, max - 1)}…`;

}

/**
 * Width a cell wants: the longest entry it has to hold, capped.
 *
 * Derived per section rather than hardcoded, so a table of short names does
 * not pay for the one table that has long ones. Omit the cap for a trailing
 * cell, which `fitWidths` bounds by whatever the terminal has left.
 *
 * @example
 * cellWidth(['id', 'created_at'], IDENTIFIER_CAP); // 10
 */
export function cellWidth(cells: string[], cap: number = Number.POSITIVE_INFINITY): number {

    let widest = 0;

    for (const cell of cells) {

        if (cell.length > widest) widest = cell.length;

    }

    return Math.min(widest, cap);

}

/**
 * One visual line of a detail view.
 *
 * `element` is the line as the viewport draws it: cells sized to the section
 * and truncated at the terminal's edge. `text` is the same line with nothing
 * cut, which is the only copy of a value the reader can still get to once the
 * element has clipped it.
 *
 * @example
 * const [row] = columnRows([jobid], rowBudget(100));
 * row.text; // "* jobid  bigint  NOT NULL DEFAULT nextval('cron.jobid_seq'::regclass)"
 */
export interface DetailRow {

    /** The line with nothing truncated. */
    text: string;

    /** The line as the viewport draws it. */
    element: ReactElement;

}

/**
 * What to call the full-page keys on this platform.
 *
 * No Mac keyboard has a key labelled PgUp, so naming one sends a reader looking
 * for something that is not there. The keys themselves work everywhere - on a
 * Mac fn+↑ and fn+↓ send the same escape sequences - so only the label changes.
 *
 * Takes the platform rather than reading `process.platform` at the call site so
 * both branches are reachable from one machine.
 *
 * @example
 * pageKeyLabel('darwin'); // 'fn ↑↓'
 * pageKeyLabel('linux');  // 'PgUp/PgDn'
 */
export function pageKeyLabel(platform: NodeJS.Platform = process.platform): string {

    return platform === 'darwin' ? 'fn ↑↓' : 'PgUp/PgDn';

}

/**
 * What is drawn in the viewport's place, if anything.
 *
 * Three states rather than an `expanded` flag, because the two overlays answer
 * to different keys: the full-text view scrolls and the row peek does not, so a
 * footer that could only say "an overlay is open" would advertise scroll keys
 * during a peek that ignores them.
 */
export type DetailOverlay = 'none' | 'fullText' | 'peek';

/**
 * What the detail screen's footer says, in order.
 *
 * The footer is a single `flexWrap` line, so every hint added is a column the
 * next one does not have. The Home/End hint was dropped to pay for the two that
 * arrived: Home and End stay bound, but on a Mac they are fn+← and fn+→, so the
 * hint had the same defect the paging hint did, and jumping to either end is
 * the least-reached of the four movements. `[r] Rows` is named that way for the
 * same reason — `Peek rows` is five columns the line cannot spare.
 *
 * @example
 * detailFooterHints({ scrolls: true, overlay: 'none', canPeek: true, platform: 'darwin' });
 * // ['[↑↓] Scroll', '[^U/^D] Half', '[fn ↑↓] Page', '[v] Full text', '[r] Rows', '[Esc] Back']
 */
export function detailFooterHints(options: {
    scrolls: boolean;
    overlay: DetailOverlay;
    canPeek?: boolean;
    platform?: NodeJS.Platform;
}): string[] {

    const { scrolls, overlay, canPeek, platform } = options;

    if (overlay === 'fullText') {

        return ['[↑↓] Scroll', '[^U/^D] Half', '[Esc] Close'];

    }

    // The peek draws its own tables and does not scroll, so Escape is the only
    // key it owns.
    if (overlay === 'peek') {

        return ['[Esc] Close'];

    }

    // A detail that fits has nothing to scroll, and reads exactly as it did
    // before any of this. It can still hold a value too wide for the row.
    const movement = scrolls
        ? ['[↑↓] Scroll', '[^U/^D] Half', `[${pageKeyLabel(platform)}] Page`]
        : [];

    return [...movement, '[v] Full text', ...(canPeek ? ['[r] Rows'] : []), '[Esc] Back'];

}

/**
 * Fit a row's cells into the terminal budget.
 *
 * Allocates left to right, holding back enough room for every later cell, so a
 * narrow terminal loses detail from the trailing cell rather than reflowing the
 * row into a wrapped mess. Left to right because the identifier is what a
 * reader scans by; the qualifiers after it are the affordable loss.
 *
 * The floor only ever shrinks a cell, never widens one: a cell that wants three
 * columns gets three.
 *
 * Overloaded per row shape so callers can destructure without every width
 * widening to `number | undefined`.
 *
 * @example
 * fitWidths([32, 7, 52], rowBudget(100)); // [32, 7, 52]
 * fitWidths([32, 7, 52], rowBudget(50));  // [30, 6, 6]
 */
export function fitWidths(desired: [number, number], budget: number): [number, number];
export function fitWidths(desired: [number, number, number], budget: number): [number, number, number];
export function fitWidths(desired: number[], budget: number): number[] {

    const widths: number[] = [];

    let remaining = budget - CELL_GAP * Math.max(0, desired.length - 1);

    for (const [index, want] of desired.entries()) {

        let reserved = 0;

        for (const later of desired.slice(index + 1)) {

            reserved += Math.min(later, MIN_CELL_COLUMNS);

        }

        const room = Math.max(MIN_CELL_COLUMNS, remaining - reserved);
        const width = Math.min(want, room);

        widths.push(width);
        remaining -= width;

    }

    return widths;

}
