/**
 * Row budgets for anything that windows itself down the page.
 *
 * Ink has no scroll offset, so a list that renders more rows than the terminal
 * holds does not clip — it pushes the footer and the status bar off the bottom.
 * Every list therefore has to know how many rows it may draw, and until now
 * each one carried a hardcoded guess: a 60-row terminal showed the same eight
 * configs as a 24-row one, and the rest of the list was unreachable.
 *
 * The budget is the terminal minus the chrome around the list. The chrome
 * splits in two, and so does the accounting:
 *
 * - What the *screen* costs — the app shell, one titled Panel, the hotkey
 *   footer under it — is the same on nearly every screen, so it lives here as
 *   `SCREEN_CHROME_ROWS` and no caller counts it.
 * - What the *list component* costs — a search row, a status line — is known
 *   only to that component, so each one adds its own before calling this.
 * - What a *screen* puts beside its list — an intro paragraph, a dry-run
 *   banner — is known only to that screen, so it passes `reserveRows`.
 *
 * @example
 * // The list owns the screen: nothing to count.
 * const rows = useViewportRows();
 *
 * // Two lines of explanation sit above the list, inside the same Panel.
 * const rows = useViewportRows(2);
 */
import { useWindowSize } from 'ink';

import type { GlobalModes } from '../app-context.js';

/** Rows the app shell spends: the breadcrumb and its rule, the status bar and its rule. */
const SHELL_CHROME_ROWS = 4;

/** Rows a titled Panel spends: two borders, two padding rows, the title and its spacer. */
const PANEL_CHROME_ROWS = 6;

/** Rows the hotkey footer spends: the gap above it, and the line itself. */
const FOOTER_CHROME_ROWS = 2;

/**
 * Rows a screen spends before drawing any content of its own.
 *
 * The shape this assumes is the one nearly every screen in `src/tui/screens`
 * has: the app shell, a single titled Panel holding the content, and a row of
 * hotkey hints under the Panel. Verified empirically against a 30-row shell.
 *
 * `ConfigEditScreen` reserves 10 for the same shell and Panel because it has no
 * footer — the Form draws its own hints inside the Panel.
 */
export const SCREEN_CHROME_ROWS = SHELL_CHROME_ROWS + PANEL_CHROME_ROWS + FOOTER_CHROME_ROWS;

/**
 * Shortest viewport worth rendering, however little the terminal offers.
 *
 * Below this a list carries no more information than a single line would, and
 * the honest failure is a cramped list rather than a negative budget.
 */
export const MIN_VIEWPORT_ROWS = 5;

/**
 * Rows a viewport gets once the chrome around it has taken its share.
 *
 * Pure so it can be unit-tested and so a component that already holds the
 * terminal height does not have to call the hook a second time.
 *
 * @example
 * viewportRows(40);    // 28
 * viewportRows(40, 4); // 24 — four rows of the screen belong to something else
 * viewportRows(8);     // 5  — the floor, not a negative budget
 */
export function viewportRows(terminalRows: number, reserveRows = 0): number {

    return Math.max(terminalRows - SCREEN_CHROME_ROWS - reserveRows, MIN_VIEWPORT_ROWS);

}

/**
 * Rows the calling component may draw, recomputed whenever the terminal resizes.
 *
 * `useWindowSize` rather than `useStdout`: `stdout.rows` mutates on resize
 * without telling React, so anything derived from it stays frozen at mount
 * size. Call it above any early return, or the hook count changes across an
 * async load boundary.
 *
 * @example
 * const rows = useViewportRows(bannerRows);
 * <SelectList items={items} visibleCount={rows} />
 */
export function useViewportRows(reserveRows = 0): number {

    const { rows: terminalRows } = useWindowSize();

    return viewportRows(terminalRows, reserveRows);

}

/**
 * Rows the DRY RUN / FORCE banner claims above a screen's Panel.
 *
 * The three run screens stack it in the same gapped column as their Panel, so
 * an active mode costs a line per mode plus the gap under the block. Shared
 * because getting it wrong is invisible until someone toggles a mode and the
 * bottom of the list slides under the status bar.
 *
 * @example
 * const rows = useViewportRows(2 + modeBannerRows(globalModes));
 */
export function modeBannerRows(modes: GlobalModes): number {

    const lines = (modes.dryRun ? 1 : 0) + (modes.force ? 1 : 0);

    if (lines === 0) {

        return 0;

    }

    return lines + 1;

}
