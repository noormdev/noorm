/**
 * ExploreDetailScreen - detailed view of a database object.
 *
 * Shows full details for tables, views, procedures, functions, and types.
 * Displays columns, indexes, foreign keys, parameters, etc.
 *
 * A detail view does not return a tree; it returns a flat list of rows, one
 * element per visual line, and `ScrollView` draws the slice of that list the
 * terminal has room for. Ink exposes no scroll offset, so the alternative was
 * to window five nested section trees independently — five implementations of
 * the same arithmetic, none of them assertable.
 *
 * Keyboard shortcuts:
 * - ↑/↓: Scroll one row
 * - Ctrl+U/Ctrl+D: Scroll half a viewport
 * - PageUp/PageDown (fn+↑/fn+↓ on a Mac), ⌘+↑/⌘+↓: Scroll one viewport
 * - Home/End: Jump to either end
 * - v: Open the full-text overlay, where nothing is truncated
 * - p: Peek at the table's first and last rows (tables only)
 * - Esc: Go back
 *
 * @example
 * ```bash
 * noorm db         # Then press 'e' > '1' > select a table
 * ```
 */
import { useState } from 'react';
import { Box, Text, useInput, useWindowSize } from 'ink';
import { attempt } from '@logosdx/utils';

import type { ReactElement } from 'react';
import type { Kysely } from 'kysely';
import type { ScreenProps } from '../../../types.js';

import { useRouter } from '../../../router.js';
import { useFocusScope } from '../../../focus.js';
import { useWheelScroll } from '../../../mouse.js';
import { useAppContext } from '../../../app-context.js';
import { Panel, Spinner } from '../../../components/index.js';
import { useConnection, useAsyncEffect } from '../../../hooks/index.js';
import { fetchDetail } from '../../../../core/explore/index.js';
import {
    CELL_GAP,
    MARKER_WIDTH,
    IDENTIFIER_CAP,
    DATA_TYPE_CAP,
    cellWidth,
    detailFooterHints,
    fitWidths,
    rowBudget,
    rowWindow,
    scrollTarget,
    viewportRows,
    wrapText,
} from './layout.js';
import { FullTextOverlay } from './FullTextOverlay.js';
import { RowPeekOverlay } from './RowPeekOverlay.js';

import type { DetailOverlay, DetailRow } from './layout.js';

import type { DetailCategory } from '../../../../core/explore/index.js';
import type {
    TableDetail,
    ViewDetail,
    ProcedureDetail,
    FunctionDetail,
    TypeDetail,
    ColumnDetail,
    ParameterDetail,
    IndexSummary,
    ForeignKeySummary,
} from '../../../../core/explore/index.js';

/**
 * Route to category mapping.
 */
const ROUTE_TO_CATEGORY: Record<string, DetailCategory> = {
    'db/explore/tables/detail': 'tables',
    'db/explore/views/detail': 'views',
    'db/explore/procedures/detail': 'procedures',
    'db/explore/functions/detail': 'functions',
    'db/explore/types/detail': 'types',
};

/**
 * Union type for all detail types.
 */
type AnyDetail = TableDetail | ViewDetail | ProcedureDetail | FunctionDetail | TypeDetail;

/**
 * The trailing cell of a column row: nullability, then the default if there
 * is one.
 */
function constraintText(col: ColumnDetail): string {

    const nullability = col.isNullable ? 'NULL' : 'NOT NULL';

    return col.defaultValue ? `${nullability} DEFAULT ${col.defaultValue}` : nullability;

}

/**
 * The cells of a row as one string, spaced the way the row Box gaps them.
 *
 * This is the untruncated copy of the line. It is not padded to the cell widths,
 * because padding is what the element does to keep the columns aligned and the
 * overlay's whole job is to stop paying for that.
 */
function joinCells(cells: string[]): string {

    return cells.join(' '.repeat(CELL_GAP));

}

/**
 * A blank line between two sections.
 *
 * The sections used to be `gap={1}` on a column Box. A gap is invisible to the
 * row count, so it becomes a row of its own here.
 */
function spacerRow(key: string): DetailRow {

    return { text: '', element: <Box key={key} height={1} /> };

}

/**
 * A section's underlined title.
 */
function headingRow(key: string, text: string): DetailRow {

    return { text, element: <Text key={key} bold underline>{text}</Text> };

}

/**
 * One row per column.
 *
 * Cell widths come from the longest entry in this table, not from a guess, so
 * the type and constraint columns land on one offset for every row no matter
 * which rows carry a default.
 *
 * @example
 * const rows = columnRows(detail.columns, rowBudget(terminalColumns));
 */
export function columnRows(columns: ColumnDetail[], width: number): DetailRow[] {

    if (columns.length === 0) {

        return [{ text: 'No columns', element: <Text key="col:empty" dimColor>No columns</Text> }];

    }

    const [nameWidth, typeWidth, constraintWidth] = fitWidths(
        [
            MARKER_WIDTH + cellWidth(columns.map((col) => col.name), IDENTIFIER_CAP),
            cellWidth(columns.map((col) => col.dataType), DATA_TYPE_CAP),
            cellWidth(columns.map(constraintText)),
        ],
        width,
    );

    return columns.map((col) => {

        const name = `${col.isPrimaryKey ? '* ' : '  '}${col.name}`;

        return {
            text: joinCells([name, col.dataType, constraintText(col)]),
            element: (
                <Box key={`col:${col.name}`} gap={CELL_GAP}>
                    <Box width={nameWidth} flexShrink={0}>
                        <Text color={col.isPrimaryKey ? 'yellow' : undefined} wrap="truncate">
                            {name}
                        </Text>
                    </Box>
                    <Box width={typeWidth} flexShrink={0}>
                        <Text dimColor wrap="truncate">{col.dataType}</Text>
                    </Box>
                    <Box width={constraintWidth} flexShrink={0}>
                        <Text dimColor wrap="truncate">{constraintText(col)}</Text>
                    </Box>
                </Box>
            ),
        };

    });

}

/**
 * One row per parameter.
 *
 * Same content-derived widths as the column rows, so a procedure with one
 * `timestamp with time zone` parameter does not stagger the rest.
 *
 * @example
 * const rows = parameterRows(detail.parameters, rowBudget(terminalColumns));
 */
export function parameterRows(parameters: ParameterDetail[], width: number): DetailRow[] {

    if (parameters.length === 0) {

        return [{ text: 'No parameters', element: <Text key="param:empty" dimColor>No parameters</Text> }];

    }

    const [nameWidth, typeWidth, modeWidth] = fitWidths(
        [
            cellWidth(parameters.map((param) => param.name), IDENTIFIER_CAP),
            cellWidth(parameters.map((param) => param.dataType), DATA_TYPE_CAP),
            cellWidth(parameters.map((param) => param.mode)),
        ],
        width,
    );

    return parameters.map((param) => ({
        text: joinCells([param.name, param.dataType, param.mode]),
        element: (
            <Box key={`param:${param.name}`} gap={CELL_GAP}>
                <Box width={nameWidth} flexShrink={0}>
                    <Text wrap="truncate">{param.name}</Text>
                </Box>
                <Box width={typeWidth} flexShrink={0}>
                    <Text dimColor wrap="truncate">{param.dataType}</Text>
                </Box>
                <Box width={modeWidth} flexShrink={0}>
                    <Text dimColor wrap="truncate">{param.mode}</Text>
                </Box>
            </Box>
        ),
    }));

}

/**
 * The trailing cell of an index row: the indexed columns, then UNIQUE when
 * that is not already implied by the primary-key marker.
 */
function indexColumnsText(idx: IndexSummary): string {

    const columns = `(${idx.columns.join(', ')})`;

    return idx.isUnique && !idx.isPrimary ? `${columns} UNIQUE` : columns;

}

/**
 * One row per index.
 *
 * Index names run long and unevenly, so the name cell is capped and truncated
 * rather than allowed to push the column list off the right edge.
 *
 * @example
 * const rows = indexRows(detail.indexes, rowBudget(terminalColumns));
 */
export function indexRows(indexes: IndexSummary[], width: number): DetailRow[] {

    if (indexes.length === 0) {

        return [{ text: 'No indexes', element: <Text key="idx:empty" dimColor>No indexes</Text> }];

    }

    const [nameWidth, columnsWidth] = fitWidths(
        [
            MARKER_WIDTH + cellWidth(indexes.map((idx) => idx.name), IDENTIFIER_CAP),
            cellWidth(indexes.map(indexColumnsText)),
        ],
        width,
    );

    return indexes.map((idx) => {

        const name = `${idx.isPrimary ? '* ' : '  '}${idx.name}`;

        return {
            text: joinCells([name, indexColumnsText(idx)]),
            element: (
                <Box key={`idx:${idx.name}`} gap={CELL_GAP}>
                    <Box width={nameWidth} flexShrink={0}>
                        <Text color={idx.isPrimary ? 'yellow' : undefined} wrap="truncate">
                            {name}
                        </Text>
                    </Box>
                    <Box width={columnsWidth} flexShrink={0}>
                        <Text dimColor wrap="truncate">{indexColumnsText(idx)}</Text>
                    </Box>
                </Box>
            ),
        };

    });

}

/**
 * Two rows per foreign key, not two columns: a constraint name plus both sides
 * of the reference never fits one line. Both rows truncate so a long reference
 * degrades instead of reflowing under the next key's name.
 *
 * @example
 * const rows = foreignKeyRows(detail.foreignKeys, rowBudget(terminalColumns));
 */
export function foreignKeyRows(foreignKeys: ForeignKeySummary[], width: number): DetailRow[] {

    if (foreignKeys.length === 0) {

        return [{ text: 'No foreign keys', element: <Text key="fk:empty" dimColor>No foreign keys</Text> }];

    }

    return foreignKeys.flatMap((fk) => {

        const reference = `  (${fk.columns.join(', ')}) → ${fk.referencedTable}(${fk.referencedColumns.join(', ')})`;

        return [
            {
                text: fk.name,
                element: (
                    <Box key={`fk:${fk.name}`} width={width}>
                        <Text wrap="truncate">{fk.name}</Text>
                    </Box>
                ),
            },
            {
                text: reference,
                element: (
                    <Box key={`fk:${fk.name}:ref`} width={width}>
                        <Text dimColor wrap="truncate">{reference}</Text>
                    </Box>
                ),
            },
        ];

    });

}

/**
 * Qualified object name, with whatever the view shows beside it.
 */
function titleRow(detail: AnyDetail, trailing?: string): DetailRow {

    const qualified = `${detail.schema ? `${detail.schema}.` : ''}${detail.name}`;

    return {
        text: trailing ? joinCells([qualified, trailing]) : qualified,
        element: (
            <Box key="title" gap={2}>
                <Text bold>{qualified}</Text>
                {trailing !== undefined && <Text dimColor>{trailing}</Text>}
            </Box>
        ),
    };

}

/**
 * The definition dump, one row per line it will occupy.
 *
 * The 500-character cut and its ASCII marker are left as they were; only the
 * line breaking is new, because a `<Text>` that wraps itself has a height the
 * viewport cannot count.
 */
function definitionRows(definition: string, width: number): DetailRow[] {

    const shown = `${definition.slice(0, 500)}${definition.length > 500 ? '...' : ''}`;

    return wrapText(shown, width).map((line, index) => ({
        text: line,
        element: <Text key={`def:${index}`} dimColor>{line}</Text>,
    }));

}

/**
 * Flatten sections into one row list, a blank line between each.
 *
 * Replaces the `gap={1}` the section Boxes used to carry, which the viewport
 * had no way to account for.
 */
function joinSections(sections: DetailRow[][]): DetailRow[] {

    return sections.flatMap((section, index) => (
        index === 0 ? section : [spacerRow(`gap:${index}`), ...section]
    ));

}

/**
 * Table detail as rows: identity, columns, then indexes and foreign keys when
 * the table has any.
 *
 * @example
 * const rows = tableDetailRows(detail, rowBudget(terminalColumns));
 */
export function tableDetailRows(detail: TableDetail, width: number): DetailRow[] {

    const sections: DetailRow[][] = [
        [titleRow(
            detail,
            detail.rowCountEstimate === undefined
                ? undefined
                : `~${detail.rowCountEstimate.toLocaleString()} rows`,
        )],
        [headingRow('h:columns', `Columns (${detail.columns.length})`), ...columnRows(detail.columns, width)],
    ];

    if (detail.indexes.length > 0) {

        sections.push([
            headingRow('h:indexes', `Indexes (${detail.indexes.length})`),
            ...indexRows(detail.indexes, width),
        ]);

    }

    if (detail.foreignKeys.length > 0) {

        sections.push([
            headingRow('h:fks', `Foreign Keys (${detail.foreignKeys.length})`),
            ...foreignKeyRows(detail.foreignKeys, width),
        ]);

    }

    return joinSections(sections);

}

/**
 * View detail as rows: identity, columns, then the definition when there is one.
 *
 * @example
 * const rows = viewDetailRows(detail, rowBudget(terminalColumns));
 */
export function viewDetailRows(detail: ViewDetail, width: number): DetailRow[] {

    const sections: DetailRow[][] = [
        [titleRow(detail, detail.isUpdatable ? 'UPDATABLE' : 'READ-ONLY')],
        [headingRow('h:columns', `Columns (${detail.columns.length})`), ...columnRows(detail.columns, width)],
    ];

    if (detail.definition) {

        sections.push([headingRow('h:definition', 'Definition'), ...definitionRows(detail.definition, width)]);

    }

    return joinSections(sections);

}

/**
 * Procedure detail as rows: identity, parameters, then the definition.
 *
 * @example
 * const rows = procedureDetailRows(detail, rowBudget(terminalColumns));
 */
export function procedureDetailRows(detail: ProcedureDetail, width: number): DetailRow[] {

    const sections: DetailRow[][] = [
        [titleRow(detail)],
        [
            headingRow('h:parameters', `Parameters (${detail.parameters.length})`),
            ...parameterRows(detail.parameters, width),
        ],
    ];

    if (detail.definition) {

        sections.push([headingRow('h:definition', 'Definition'), ...definitionRows(detail.definition, width)]);

    }

    return joinSections(sections);

}

/**
 * Function detail as rows: identity and return type, parameters, definition.
 *
 * @example
 * const rows = functionDetailRows(detail, rowBudget(terminalColumns));
 */
export function functionDetailRows(detail: FunctionDetail, width: number): DetailRow[] {

    const sections: DetailRow[][] = [
        [titleRow(detail, `→ ${detail.returnType}`)],
        [
            headingRow('h:parameters', `Parameters (${detail.parameters.length})`),
            ...parameterRows(detail.parameters, width),
        ],
    ];

    if (detail.definition) {

        sections.push([headingRow('h:definition', 'Definition'), ...definitionRows(detail.definition, width)]);

    }

    return joinSections(sections);

}

/**
 * Type detail as rows. Which section follows the header depends on the kind:
 * enum values, composite attributes, or a domain's base type.
 *
 * @example
 * const rows = typeDetailRows(detail, rowBudget(terminalColumns));
 */
export function typeDetailRows(detail: TypeDetail, width: number): DetailRow[] {

    const sections: DetailRow[][] = [
        [titleRow(detail, detail.kind.toUpperCase())],
    ];

    if (detail.kind === 'enum' && detail.values) {

        sections.push([
            headingRow('h:values', `Values (${detail.values.length})`),
            ...detail.values.map((value, index) => ({
                text: `  ${value}`,
                element: <Text key={`value:${index}`}>  {value}</Text>,
            })),
        ]);

    }

    if (detail.kind === 'composite' && detail.attributes) {

        sections.push([
            headingRow('h:attributes', `Attributes (${detail.attributes.length})`),
            ...columnRows(detail.attributes, width),
        ]);

    }

    if (detail.kind === 'domain' && detail.baseType) {

        sections.push([
            headingRow('h:baseType', 'Base Type'),
            { text: `  ${detail.baseType}`, element: <Text key="baseType">  {detail.baseType}</Text> },
        ]);

    }

    return joinSections(sections);

}

/**
 * Props for the detail viewport.
 */
export interface ScrollViewProps {

    /** One row per visual line, each carrying its own untruncated text. */
    rows: DetailRow[];

    /** Lines the viewport may draw, indicators included. */
    height: number;

    /** Focus comes from the screen; this component opens no scope of its own. */
    isFocused: boolean;

    /**
     * Told whenever an overlay opens or closes, so the screen can swap the
     * footer hints. The overlay's state lives here rather than on the screen
     * because the viewport is what has to survive it: keeping this component
     * mounted is what preserves the scroll offset across a dismissal.
     */
    onOverlayChange?: (overlay: DetailOverlay) => void;

    /**
     * Draws the row peek, when the object has rows to peek at. Absent is what
     * suppresses `p`, so a view or a procedure never offers a key that would
     * open an empty overlay.
     */
    renderPeek?: (close: () => void) => ReactElement;

}

/**
 * A vertical viewport over a flat row list.
 *
 * Takes `height` as a prop rather than reading `useWindowSize` itself so the
 * screen stays the one place that accounts for chrome, and so a test can pin a
 * viewport without a terminal to measure.
 *
 * `v` swaps the viewport for `FullTextOverlay`, which draws the same rows with
 * nothing truncated; `p` swaps it for the row peek, when the caller supplied
 * one. Both swaps happen here rather than on the screen so this component stays
 * mounted through them and its scroll offset survives Escape.
 *
 * @example
 * <ScrollView rows={tableDetailRows(detail, width)} height={viewportRows(rows)} isFocused={isFocused} />
 */
export function ScrollView({
    rows,
    height,
    isFocused,
    onOverlayChange,
    renderPeek,
}: ScrollViewProps): ReactElement {

    const [offset, setOffset] = useState(0);
    const [overlay, setOverlay] = useState<DetailOverlay>('none');

    const view = rowWindow(rows.length, offset, height);
    const maxOffset = rows.length - view.count;

    // Every move rebases on `view.start`, not on `offset`: the window clamps
    // what it draws, so a stale offset left by a resize or a smaller object
    // cannot send the next keypress somewhere the viewport never was.
    const scrollTo = (next: number) => setOffset(Math.min(Math.max(next, 0), maxOffset));

    // Only while this component owns the viewport: an overlay draws over it and
    // scrolls itself, so the pane underneath must not move under the notch.
    useWheelScroll({
        isActive: isFocused && overlay === 'none',
        onWheel: (delta) => scrollTo(view.start + delta),
    });

    const open = (next: DetailOverlay) => {

        setOverlay(next);
        onOverlayChange?.(next);

    };

    useInput((input, key) => {

        // The overlay as well as `isFocused`: an overlay pushes a focus scope,
        // so the screen's `isFocused` does go false in the app, but this
        // component is also rendered directly by tests that pin it true.
        // Whoever owns the keys, it is not this handler while an overlay is up.
        if (!isFocused || overlay !== 'none') return;

        // Ink reports Ctrl+V as `input === 'v'` with `key.ctrl` set, so the
        // modifier has to be excluded or a paste attempt opens the overlay.
        if (input === 'v' && !key.ctrl && !key.meta) {

            open('fullText');

            return;

        }

        // `r` for rows, matching the hint. Screen-local, as `r` already means
        // re-run, rename and transfer on three other screens.
        if (input === 'r' && !key.ctrl && !key.meta && renderPeek) {

            open('peek');

            return;

        }

        const target = scrollTarget(input, key, view, maxOffset);

        if (target !== null) scrollTo(target);

    });

    if (overlay === 'fullText') {

        return (
            <FullTextOverlay
                text={rows.map((row) => row.text)}
                startRow={view.start}
                height={height}
                onClose={() => open('none')}
            />
        );

    }

    if (overlay === 'peek' && renderPeek) {

        return renderPeek(() => open('none'));

    }

    return (
        <Box flexDirection="column">
            {view.above > 0 && <Text dimColor> ↑ {view.above} more</Text>}
            {rows.slice(view.start, view.start + view.count).map((row) => row.element)}
            {view.below > 0 && <Text dimColor> ↓ {view.below} more</Text>}
        </Box>
    );

}

/**
 * Whether this detail is a table, by shape rather than by assertion.
 *
 * `TableDetail` is the only variant carrying both an index list and a foreign
 * key list, so the pair narrows the union without a cast. The peek needs a real
 * `TableDetail` — it reads the column list for the primary key — and trusting
 * the route alone would hand it whatever `fetchDetail` happened to return.
 *
 * @example
 * if (isTableDetail(detail)) peek(detail.columns);
 */
function isTableDetail(detail: AnyDetail): detail is TableDetail {

    return 'indexes' in detail && 'foreignKeys' in detail;

}

/**
 * Rows for whichever kind of object the route asked for.
 *
 * The route is what decides, not the object's shape: `fetchDetail` was called
 * with this category and returns the matching detail for it.
 */
function buildDetailRows(category: DetailCategory | undefined, detail: AnyDetail, width: number): DetailRow[] {

    switch (category) {

    case 'tables':
        return tableDetailRows(detail as TableDetail, width);

    case 'views':
        return viewDetailRows(detail as ViewDetail, width);

    case 'procedures':
        return procedureDetailRows(detail as ProcedureDetail, width);

    case 'functions':
        return functionDetailRows(detail as FunctionDetail, width);

    case 'types':
        return typeDetailRows(detail as TypeDetail, width);

    default:
        return [{ text: 'Unknown category', element: <Text key="unknown">Unknown category</Text> }];

    }

}

/**
 * ExploreDetailScreen component.
 *
 * Shows full details for a selected database object.
 */
export function ExploreDetailScreen({ params }: ScreenProps): ReactElement {

    const { back, route } = useRouter();
    const { isFocused } = useFocusScope('ExploreDetail');
    const { activeConfig, activeConfigName } = useAppContext();

    // useWindowSize, not useStdout: stdout.columns and .rows mutate on resize
    // without telling React, so anything derived from them would freeze at mount
    // size. Above the early returns, or the hook count changes once the load
    // resolves.
    const { columns: terminalColumns, rows: terminalRows } = useWindowSize();

    const [detail, setDetail] = useState<AnyDetail | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    // Mirrors the viewport's overlay state, which the footer is the only thing
    // here that needs. Above the early returns, like every other hook.
    const [overlay, setOverlay] = useState<DetailOverlay>('none');

    // Get category from route
    const category = ROUTE_TO_CATEGORY[route];
    const name = params.name;
    const schema = params.schema;

    // Shared connection.
    //
    // `ConnectionProvider` labels it `Kysely<NoormDatabase>` — by its own cast
    // at `ConnectionProvider.tsx:192`, over a connection `createConnection`
    // returned untyped — so the vault and lock screens can name noorm's own
    // tables. Nothing here reads one, and Kysely treats the two instantiations
    // as mutually unassignable, so the untyped view is recovered once and both
    // core calls take it. This replaces the per-call cast `fetchDetail` used to
    // carry rather than adding a second one.
    const { db: typedDb, dialect, loading: connLoading, error: connError } = useConnection();
    const db = typedDb as Kysely<unknown> | null;

    // Load detail when connection is ready
    useAsyncEffect(async (isCancelled) => {

        if (!db || !dialect || !category || !name) {

            if (!connLoading && !connError) setIsLoading(false);

            return;

        }

        setIsLoading(true);
        setError(null);

        const [result, err] = await attempt(async () => {

            return await fetchDetail(db, dialect, category, name, schema);

        });

        if (isCancelled()) return;

        if (err) {

            setError(err.message);

        }
        else if (!result) {

            setError(`${name} not found`);

        }
        else {

            setDetail(result as AnyDetail);

        }

        setIsLoading(false);

    }, [db, dialect, category, name, schema]);

    // Handle escape
    useInput((input, key) => {

        if (!isFocused) return;

        if (key.escape) {

            back();

        }

    });

    // Get title based on category
    const getTitle = () => {

        switch (category) {

        case 'tables': return 'Table';
        case 'views': return 'View';
        case 'procedures': return 'Procedure';
        case 'functions': return 'Function';
        case 'types': return 'Type';
        default: return 'Detail';

        }

    };

    // Missing params
    if (!name) {

        return (
            <Box flexDirection="column" gap={1}>
                <Panel title="Error" borderColor="red" paddingX={1} paddingY={1}>
                    <Text color="red">Missing object name</Text>
                </Panel>

                <Box flexWrap="wrap" columnGap={2}>
                    <Text dimColor>[Esc] Back</Text>
                </Box>
            </Box>
        );

    }

    // No active config
    if (!activeConfig) {

        return (
            <Box flexDirection="column" gap={1}>
                <Panel title={getTitle()} borderColor="yellow" paddingX={1} paddingY={1}>
                    <Text color="yellow">No active configuration selected.</Text>
                </Panel>

                <Box flexWrap="wrap" columnGap={2}>
                    <Text dimColor>[Esc] Back</Text>
                </Box>
            </Box>
        );

    }

    // Loading state
    if (isLoading || connLoading) {

        return (
            <Box flexDirection="column" gap={1}>
                <Panel title={getTitle()} paddingX={1} paddingY={1}>
                    <Spinner label={`Loading ${name}...`} />
                </Panel>
            </Box>
        );

    }

    // Error state
    if (error || connError || !detail) {

        return (
            <Box flexDirection="column" gap={1}>
                <Panel title={getTitle()} borderColor="red" paddingX={1} paddingY={1}>
                    <Box flexDirection="column" gap={1}>
                        <Text color="red">Error</Text>
                        <Text dimColor>{error ?? connError ?? 'Object not found'}</Text>
                    </Box>
                </Panel>

                <Box flexWrap="wrap" columnGap={2}>
                    <Text dimColor>[Esc] Back</Text>
                </Box>
            </Box>
        );

    }

    // Columns a detail row gets once the Panel has taken its border and padding.
    const rowWidth = rowBudget(terminalColumns);

    // Rows the viewport gets once the shell, the Panel, and the footer have
    // taken theirs.
    const height = viewportRows(terminalRows);

    const detailRows = buildDetailRows(category, detail, rowWidth);

    // Advertise the scroll keys only when there is something to scroll, so a
    // detail that fits reads exactly as it did before.
    const scrolls = detailRows.length > height;

    // Only a table has rows to peek at, and only a live connection can read
    // them. Anything missing suppresses the key rather than opening an overlay
    // that can only report why it is empty.
    const peekable = category === 'tables'
        && isTableDetail(detail)
        && db !== null
        && dialect !== null
        && activeConfigName !== null;

    return (
        <Box flexDirection="column" gap={1}>
            <Panel title={getTitle()} paddingX={1} paddingY={1}>
                <ScrollView
                    rows={detailRows}
                    height={height}
                    isFocused={isFocused}
                    onOverlayChange={setOverlay}
                    renderPeek={peekable
                        ? (close) => (
                            <RowPeekOverlay
                                db={db}
                                dialect={dialect}
                                detail={detail}
                                // 'user': the TUI is a human at a keyboard, and
                                // every other policy-checking screen says the
                                // same. A non-interactive caller resolves its
                                // own channel and passes it here instead.
                                gate={{
                                    configName: activeConfigName,
                                    access: activeConfig.access,
                                    channel: 'user',
                                }}
                                height={height}
                                onClose={close}
                            />
                        )
                        : undefined}
                />
            </Panel>

            <Box flexWrap="wrap" columnGap={2}>
                {detailFooterHints({ scrolls, overlay, canPeek: peekable }).map((hint) => (
                    <Text key={hint} dimColor>{hint}</Text>
                ))}
            </Box>
        </Box>
    );

}
