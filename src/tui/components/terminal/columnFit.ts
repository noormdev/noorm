/**
 * Which columns a result grid draws, and how wide.
 *
 * Ink's `width` is a flex basis and flex items shrink by default, so a row of
 * cells wider than the terminal does not overflow — it squeezes. Every cell
 * loses columns at once, headers wrap onto a second line and silently double
 * the height of every row, and values break mid-value: `select * from ai_usage`
 * produced a grid whose headers read `ai_u`/`sage` and whose ids read
 * `1283`/`2`. Fifteen columns shown uselessly is worth less than three shown
 * properly, so the fit drops columns rather than shrinking past readable.
 *
 * Dropping is only acceptable because the dropped columns stay reachable:
 * `ResultTable` marks how many it left off, and `Enter` on a row opens
 * `RowViewOverlay`, which shows every column of it.
 *
 * @example
 * const fit = fitGridColumns(columns, desiredWidths, terminalColumns);
 * fit.columns.map((col) => fit.widths[col]);
 */
import { rowBudget } from './viewport.js';

/** Widest a grid column grows before it truncates. */
export const PEEK_COLUMN_CAP = 24;

/**
 * Narrowest a column may be and still be worth a column of the row.
 *
 * Sixteen, chosen from what a reader can actually do with the result rather
 * than from what fits:
 *
 * - `2024-03-01` is whole, and `2024-03-01 12:…` is enough of a timestamp to
 *   order rows by eye.
 * - A UUID reads `ee3d58b5-be2b-4…`, which distinguishes one row from another.
 *   At six it reads `ee3d5…`, which distinguishes nothing and still costs a
 *   column of the row.
 * - The identifiers that turn up as headers on a wide table — `provider_name`,
 *   `sales_order_no`, `idempotency_key` — fit whole, so the reader can still
 *   tell which column they are looking at.
 *
 * Below this a column is not narrow, it is absent while still charging rent,
 * which is why the fit drops columns rather than shrinking past it. It is a
 * floor on what a column may be *shrunk* to, never a floor on what a column
 * *asks* for: an `id` column holding single digits is drawn three wide.
 */
const MIN_READABLE_COLUMN = 16;

/** Columns between two cells, as `ResultTable` draws them: ` | `. */
const CELL_SEPARATOR = 3;

/**
 * Which columns the grid draws, and how wide, when nothing is known about the
 * values.
 */
export interface PeekColumnFit {

    /** The leading columns that fit, in their original order. */
    columns: string[];

    /** How many were left off the right edge. */
    hidden: number;

    /** Width every drawn column gets. */
    width: number;

}

/**
 * Fit columns across the row by dropping them, not by squeezing them.
 *
 * The worst case, and the width ceiling: every column is assumed to want at
 * least `MIN_READABLE_COLUMN`, so this is how many columns fit when none of
 * them can be drawn short. `fitGridColumns` takes the `width` from here as its
 * per-column cap and then shows more columns than this when the values are
 * narrow enough to allow it.
 *
 * One column is always drawn, however narrow the terminal: an empty grid is
 * strictly worse than a cramped one, and `rowBudget` already floors the width
 * at something a terminal can hold.
 *
 * @example
 * fitPeekColumns(fifteenColumns, 76); // { columns: 3, hidden: 12, width: 22 }
 */
export function fitPeekColumns(columns: string[], terminalColumns: number): PeekColumnFit {

    const budget = rowBudget(terminalColumns);

    if (columns.length === 0) return { columns: [], hidden: 0, width: PEEK_COLUMN_CAP };

    let shown = 1;

    while (shown < columns.length) {

        const next = shown + 1;
        const needed = next * MIN_READABLE_COLUMN + (next - 1) * CELL_SEPARATOR;

        if (needed > budget) break;

        shown = next;

    }

    // Whatever the drops bought goes into width, up to the cap: a row with room
    // to spare should show three whole values rather than three narrow ones.
    const room = budget - CELL_SEPARATOR * (shown - 1);
    const width = Math.max(
        MIN_READABLE_COLUMN,
        Math.min(PEEK_COLUMN_CAP, Math.floor(room / shown)),
    );

    return { columns: columns.slice(0, shown), hidden: columns.length - shown, width };

}

/**
 * Which columns the grid draws, and how wide each one is.
 */
export interface GridColumnFit {

    /** The leading columns that fit, in their original order. */
    columns: string[];

    /** How many were left off the right edge. */
    hidden: number;

    /** Width per drawn column, keyed by column name. */
    widths: Record<string, number>;

}

/**
 * Fit columns to the row, spending only what each one's values actually need.
 *
 * `fitPeekColumns` answers the same question knowing nothing about the values,
 * which is the only answer available before a query runs. A grid does know: it
 * has every row in hand, so an `id` column of single digits costs three columns
 * rather than sixteen, and the row has that much more left over for the columns
 * after it. What it inherits from `fitPeekColumns` is the ceiling — no column is
 * drawn wider than the peek fit would have allowed — which is what keeps a
 * single `text` column from eating the whole row.
 *
 * The first column is drawn even when it does not fit, clamped to the budget,
 * for the same reason `fitPeekColumns` always keeps one.
 *
 * @example
 * fitGridColumns(['id', 'note'], { id: 2, note: 40 }, 100);
 * // { columns: ['id', 'note'], hidden: 0, widths: { id: 2, note: 24 } }
 */
export function fitGridColumns(
    columns: string[],
    desired: Record<string, number>,
    terminalColumns: number,
): GridColumnFit {

    const budget = rowBudget(terminalColumns);
    const cap = fitPeekColumns(columns, terminalColumns).width;
    const widths: Record<string, number> = {};

    let used = 0;
    let shown = 0;

    for (const column of columns) {

        const want = Math.max(1, Math.min(desired[column] ?? column.length, cap));

        if (shown === 0) {

            widths[column] = Math.min(want, budget);
            used = widths[column]!;
            shown = 1;

            continue;

        }

        if (used + CELL_SEPARATOR + want > budget) break;

        widths[column] = want;
        used += CELL_SEPARATOR + want;
        shown += 1;

    }

    return { columns: columns.slice(0, shown), hidden: columns.length - shown, widths };

}
