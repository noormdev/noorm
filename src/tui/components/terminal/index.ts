/**
 * Terminal components.
 *
 * Components for the SQL terminal interface, and the result grid the explore
 * screens share with it.
 */

export { SqlInput } from './SqlInput.js';
export type { SqlInputProps } from './SqlInput.js';

export { ResultTable } from './ResultTable.js';
export type { ResultTableProps } from './ResultTable.js';

export { ResultBrowser } from './ResultBrowser.js';
export type { ResultBrowserProps } from './ResultBrowser.js';

export { RowViewOverlay } from './RowViewOverlay.js';
export type { RowViewOverlayProps } from './RowViewOverlay.js';

export { ScrollPane } from './ScrollPane.js';
export type { ScrollPaneProps } from './ScrollPane.js';

export { fitGridColumns, fitPeekColumns, PEEK_COLUMN_CAP } from './columnFit.js';
export type { GridColumnFit, PeekColumnFit } from './columnFit.js';

export {
    DEFAULT_ROW_FORMAT,
    describeBinary,
    documentRow,
    documentValue,
    preferredRowFormat,
    rememberRowFormat,
    renderRowDocument,
} from './rowDocument.js';
export type { RowFormat } from './rowDocument.js';

export { halfPage, rowBudget, rowWindow, scrollTarget, wrapText } from './viewport.js';
export type { RowWindow } from './viewport.js';
