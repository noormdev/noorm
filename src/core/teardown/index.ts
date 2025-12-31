/**
 * Teardown Module
 *
 * Database reset and teardown operations.
 * Supports data wipe (truncate) and schema teardown (drop).
 */

// Operations
export {
    truncateData,
    teardownSchema,
    previewTeardown,
} from './operations.js';

// Types
export type {
    TruncateOptions,
    TruncateResult,
    TeardownOptions,
    TeardownResult,
    TeardownPreview,
    TeardownDialectOperations,
} from './types.js';

// Dialect operations (for advanced use cases)
export { getTeardownOperations } from './dialects/index.js';
