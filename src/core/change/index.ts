/**
 * Change module.
 *
 * Versioned database modifications applied after initial schema build.
 * Supports forward changes and rollbacks with execution tracking.
 *
 * @example
 * ```typescript
 * import {
 *     ChangeManager,
 *     createChange,
 *     parseChange,
 * } from './change'
 *
 * // Create a new change
 * const change = await createChange('/project/changes', {
 *     description: 'add-email-verification',
 * })
 *
 * // Use the manager for high-level operations
 * const manager = new ChangeManager(context)
 * const list = await manager.list()
 * const result = await manager.run('2024-01-15-add-users')
 * ```
 */

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────

export type {
    // File types
    ChangeFileType,
    ChangeFile,

    // Change types
    Change,
    ChangeStatus,
    ChangeListItem,

    // Options
    ChangeOptions,
    BatchChangeOptions,
    ChangeContext,

    // Results
    ChangeResult,
    ChangeFileResult,
    BatchChangeResult,

    // History
    ChangeHistoryRecord,
    UnifiedHistoryRecord,
    FileHistoryRecord,

    // Change detection
    ChangeRunReason,
    NeedsRunResult,

    // Scaffold
    CreateChangeOptions,
    AddFileOptions,
} from './types.js';

export {
    DEFAULT_CHANGE_OPTIONS,
    DEFAULT_BATCH_OPTIONS,

    // Errors
    ChangeValidationError,
    ChangeNotFoundError,
    ChangeAlreadyAppliedError,
    ChangeNotAppliedError,
    ChangeOrphanedError,
    ManifestReferenceError,
} from './types.js';

// ─────────────────────────────────────────────────────────────
// Parser
// ─────────────────────────────────────────────────────────────

export {
    parseChange,
    discoverChanges,
    resolveManifest,
    validateChange,
    hasRevertFiles,
    parseSequence,
    parseDescription,
} from './parser.js';

// ─────────────────────────────────────────────────────────────
// Scaffold
// ─────────────────────────────────────────────────────────────

export {
    createChange,
    addFile,
    removeFile,
    renameFile,
    reorderFiles,
    deleteChange,
} from './scaffold.js';

// ─────────────────────────────────────────────────────────────
// History & Tracking
// ─────────────────────────────────────────────────────────────

export { ChangeHistory } from './history.js';
export { ChangeTracker, type CanRevertResult } from './tracker.js';

// ─────────────────────────────────────────────────────────────
// Executor
// ─────────────────────────────────────────────────────────────

export { executeChange, revertChange } from './executor.js';

// ─────────────────────────────────────────────────────────────
// Manager
// ─────────────────────────────────────────────────────────────

export { ChangeManager } from './manager.js';
