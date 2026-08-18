/**
 * ResultBrowser - a result grid you can step into.
 *
 * `ResultTable` draws a result and `RowViewOverlay` draws one row of it; this
 * is the wiring between them, and it exists because both SQL screens need
 * exactly the same wiring. The explore peek composes the two itself, because it
 * has two grids sharing one viewer and a cursor per grid; a screen with one
 * grid does not, and would otherwise copy this five times.
 *
 * Two things it is responsible for:
 *
 * - **The cursor is here, not in the table.** `←`/`→` in the viewer move it and
 *   the table has to follow, so that Escape lands the reader back on the row
 *   they were reading rather than on the row they opened.
 * - **The grid is hidden, not unmounted, while a row is open.** Unmounting it
 *   would throw away the filter, the sort and the scroll offset that Escape is
 *   supposed to come back to.
 *
 * Nothing here claims Escape. The viewer pushes its own focus scope, which
 * makes the screen underneath unfocused, and the table stops answering keys
 * while a row is open; each level gives up its own key without taking the level
 * below with it.
 *
 * @example
 * <ResultBrowser columns={result.columns} rows={result.rows}
 *     maxVisibleRows={20} height={24} active onEscape={backToInput} />
 */
import { useEffect, useRef, useState } from 'react';
import { Box } from 'ink';

import type { ReactElement } from 'react';

import { ResultTable } from './ResultTable.js';
import { RowViewOverlay } from './RowViewOverlay.js';

/**
 * Props for the result browser.
 */
export interface ResultBrowserProps {

    /** Column names, in the order the query returned them. */
    columns: string[];

    /** Row data as array of objects. */
    rows: Record<string, unknown>[];

    /** Maximum visible rows before the grid scrolls. */
    maxVisibleRows?: number;

    /** Lines the row viewer may draw, its header included. */
    height: number;

    /** Whether the browser has input. */
    active?: boolean;

    /** What the viewer calls this list, above the row counter. */
    label?: string;

    /** Auto-sort by date or ID column on load. Default: true, as the grid's. */
    autoSort?: boolean;

    /** Called when Escape leaves the grid, which is only ever from browse mode. */
    onEscape?: () => void;

    /**
     * Told whether a row is open, so a screen footer outside this component can
     * stop advertising keys the viewer has taken over.
     *
     * Called from the three places that change it rather than from an effect: a
     * caller passing an inline arrow hands over a new function every render, and
     * an effect listing it would fire on every render for a value that did not
     * change.
     */
    onRowOpenChange?: (open: boolean) => void;

}

/**
 * ResultBrowser component.
 */
export function ResultBrowser({
    columns,
    rows,
    maxVisibleRows,
    height,
    active = true,
    label = 'Results',
    autoSort,
    onEscape,
    onRowOpenChange,
}: ResultBrowserProps): ReactElement {

    const [cursor, setCursor] = useState(0);

    // The rows as the grid was displaying them — filtered and sorted, which is
    // what `←`/`→` have to walk so the viewer moves through what the reader can
    // see rather than through what the query returned.
    const [subject, setSubject] = useState<Record<string, unknown>[] | null>(null);

    // Held in a ref so the reset effect below does not have to list it: a
    // caller passing an inline arrow renews it on every render, and an effect
    // that listed it would reset the cursor on every render.
    const notifyRef = useRef(onRowOpenChange);
    notifyRef.current = onRowOpenChange;

    // A new result is a new list, so a cursor carried over from the last one
    // would point at a row that is not there and an open viewer would be
    // showing a row from the previous query.
    useEffect(() => {

        setCursor(0);
        setSubject(null);
        notifyRef.current?.(false);

    }, [rows]);

    return (
        <Box flexDirection="column">
            <Box flexDirection="column" display={subject === null ? 'flex' : 'none'}>
                <ResultTable
                    columns={columns}
                    rows={rows}
                    {...(maxVisibleRows === undefined ? {} : { maxVisibleRows })}
                    {...(autoSort === undefined ? {} : { autoSort })}
                    active={active && subject === null}
                    highlightedRow={cursor}
                    onHighlightChange={setCursor}
                    onSelect={(_row, index, list) => {

                        setCursor(index);
                        setSubject(list);
                        onRowOpenChange?.(true);

                    }}
                    {...(onEscape ? { onEscape } : {})}
                />
            </Box>
            {subject !== null && (
                <RowViewOverlay
                    rows={subject}
                    index={cursor}
                    columns={columns}
                    setLabel={label}
                    height={height}
                    onMove={setCursor}
                    onClose={() => {

                        setSubject(null);
                        onRowOpenChange?.(false);

                    }}
                />
            )}
        </Box>
    );

}
