/**
 * DB Screens - database lifecycle management and exploration.
 *
 * Provides screens for:
 * - DbListScreen: Overview and actions menu
 * - DbCreateScreen: Create/build database schema
 * - DbDestroyScreen: Destroy database objects and reset tracking
 * - DbTruncateScreen: Truncate table data (wipe)
 * - DbTeardownScreen: Drop user objects (teardown)
 * - Explore*Screen: Browse database schema objects
 *
 * @example
 * ```typescript
 * import { DbListScreen, DbCreateScreen, DbDestroyScreen } from './screens/db/index.js'
 * import { DbTruncateScreen, DbTeardownScreen } from './screens/db/index.js'
 * import { ExploreOverviewScreen, ExploreListScreen } from './screens/db/index.js'
 * ```
 */

export { DbListScreen } from './DbListScreen.js';
export { DbCreateScreen } from './DbCreateScreen.js';
export { DbDestroyScreen } from './DbDestroyScreen.js';
export { DbTruncateScreen } from './DbTruncateScreen.js';
export { DbTeardownScreen } from './DbTeardownScreen.js';
export {
    ExploreOverviewScreen,
    ExploreListScreen,
    ExploreDetailScreen,
} from './explore/index.js';

// SQL Terminal
export { SqlTerminalScreen } from './SqlTerminalScreen.js';
export { SqlHistoryScreen } from './SqlHistoryScreen.js';
export { SqlClearScreen } from './SqlClearScreen.js';
