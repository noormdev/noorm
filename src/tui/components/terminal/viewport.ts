/**
 * Viewport arithmetic: how wide a row may be, how much of a list fits, and
 * where a keypress moves the fold.
 *
 * Ink has no scroll offset, and a `<Text>` left to wrap itself occupies however
 * many rows the terminal decides. Anything that counts rows therefore has to
 * flatten its content to one element per visual line and slice that list — the
 * explore detail screen, the full-text overlay, and the row document viewer all
 * do, which is why the arithmetic lives here rather than in any one of them.
 *
 * It sits under `components/terminal` because that is the shared layer both the
 * SQL screens and the explore screens already depend on. `screens/db/explore/
 * layout.ts` re-exports every symbol here, so the explore call sites read the
 * same as they always did.
 *
 * @example
 * const view = rowWindow(lines.length, offset, height - HEADER_ROWS);
 * lines.slice(view.start, view.start + view.count);
 */
import type { Key } from 'ink';

/** Columns a Panel spends on its border and horizontal padding. */
const PANEL_CHROME_COLUMNS = 4;

/** Narrowest row worth planning for. Below it the terminal is unusable anyway. */
const MIN_ROW_COLUMNS = 24;

/**
 * Rows the two scroll indicators claim once the content overflows.
 *
 * Held back as a pair rather than per-indicator so the viewport keeps one
 * height for the whole scroll, instead of growing a row at each end.
 */
const INDICATOR_ROWS = 2;

/**
 * Columns a row inside a Panel actually gets.
 *
 * @example
 * const budget = rowBudget(useWindowSize().columns);
 */
export function rowBudget(terminalColumns: number): number {

    return Math.max(terminalColumns - PANEL_CHROME_COLUMNS, MIN_ROW_COLUMNS);

}

/**
 * The slice of a row list that is on screen, and what is off it either way.
 */
export interface RowWindow {

    /** Index of the first row drawn. */
    start: number;

    /** Rows drawn. */
    count: number;

    /** Rows scrolled off the top. */
    above: number;

    /** Rows still below the fold. */
    below: number;

}

/**
 * Window a row list to a height budget.
 *
 * The offset is clamped here rather than trusted, so a resize or a smaller
 * object cannot strand the viewport past the end of the content: whatever
 * offset the caller is holding, what it renders is always in range.
 *
 * @example
 * const view = rowWindow(rows.length, offset, viewportRows(terminalRows));
 * rows.slice(view.start, view.start + view.count);
 */
export function rowWindow(total: number, offset: number, budget: number): RowWindow {

    if (total <= budget) {

        return { start: 0, count: total, above: 0, below: 0 };

    }

    const count = Math.max(1, budget - INDICATOR_ROWS);
    const start = Math.min(Math.max(offset, 0), total - count);

    return { start, count, above: start, below: total - start - count };

}

/**
 * Rows a half-page key moves, never less than one.
 *
 * @example
 * halfPage(10); // 5
 */
export function halfPage(count: number): number {

    return Math.max(1, Math.floor(count / 2));

}

/**
 * Where a keypress moves a viewport, or `null` when the key is not one of ours.
 *
 * Shared by the detail viewport, the full-text overlay and the row document
 * viewer so the three answer to the same keys, and so the reasoning below sits
 * in one place instead of three.
 *
 * Ctrl+U / Ctrl+D are the advertised paging keys. Ctrl reaches the application
 * on every terminal and platform, needs no fn-key contortion, and matches vim.
 * PageUp/PageDown stay bound behind them: they do work on a Mac, via fn+↑ and
 * fn+↓, which is why the footer names the chord rather than the key cap.
 *
 * @example
 * const target = scrollTarget(input, key, view, maxOffset);
 * if (target !== null) scrollTo(target);
 */
export function scrollTarget(input: string, key: Key, view: RowWindow, maxOffset: number): number | null {

    // ⌘+↑↓ mirror PageUp/PageDown, and are checked ahead of the plain arrows
    // because the chord sets `upArrow`/`downArrow` too.
    //
    // Do not add a footer hint for this. `key.super` is only ever set under the
    // kitty keyboard protocol - Ink's own `use-input.d.ts` says so, and
    // Terminal.app and iTerm2 bind ⌘ combinations to their own actions and
    // never forward them - so on the terminal most readers are using, the
    // chord does nothing. A hint for a key that silently fails is worse than
    // no hint. It is bound because it costs nothing where it happens to work.
    if (key.super && key.upArrow) return view.start - view.count;

    if (key.super && key.downArrow) return view.start + view.count;

    if (key.upArrow) return view.start - 1;

    if (key.downArrow) return view.start + 1;

    if (key.ctrl && input === 'u') return view.start - halfPage(view.count);

    if (key.ctrl && input === 'd') return view.start + halfPage(view.count);

    if (key.pageUp) return view.start - view.count;

    if (key.pageDown) return view.start + view.count;

    if (key.home) return 0;

    if (key.end) return maxOffset;

    return null;

}

/**
 * Break text into lines that each fit a width.
 *
 * A viewport counts rows, so anything it draws has to have a line count known
 * before Ink lays it out. A `<Text>` left to wrap itself does not: it occupies
 * however many rows the terminal decides, and the window arithmetic is wrong by
 * that much. Wrapping here keeps every line the caller hands over exactly one
 * row tall.
 *
 * @example
 * wrapText('create view v as select 1', 12); // ['create view', 'v as select', '1']
 */
export function wrapText(text: string, width: number): string[] {

    const limit = Math.max(1, width);
    const lines: string[] = [];

    for (const paragraph of text.split('\n')) {

        let remainder = paragraph;
        let broke = false;

        while (remainder.length > limit) {

            const space = remainder.lastIndexOf(' ', limit);
            const cut = space > 0 ? space : limit;

            lines.push(remainder.slice(0, cut));
            remainder = remainder.slice(space > 0 ? cut + 1 : cut);
            broke = true;

        }

        if (remainder.length > 0 || !broke) {

            lines.push(remainder);

        }

    }

    return lines;

}
