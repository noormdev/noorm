/**
 * Changeset module.
 *
 * Versioned database modifications applied after initial schema build.
 * Supports forward changes and rollbacks with execution tracking.
 *
 * @example
 * ```typescript
 * import {
 *     ChangesetManager,
 *     createChangeset,
 *     parseChangeset,
 * } from './changeset'
 *
 * // Create a new changeset
 * const changeset = await createChangeset('/project/changesets', {
 *     description: 'add-email-verification',
 * })
 *
 * // Use the manager for high-level operations
 * const manager = new ChangesetManager(context)
 * const list = await manager.list()
 * const result = await manager.run('2024-01-15-add-users')
 * ```
 */

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────

export type {
    // File types
    ChangesetFileType,
    ChangesetFile,

    // Changeset types
    Changeset,
    ChangesetStatus,
    ChangesetListItem,

    // Options
    ChangesetOptions,
    BatchChangesetOptions,
    ChangesetContext,

    // Results
    ChangesetResult,
    ChangesetFileResult,
    BatchChangesetResult,

    // History
    ChangesetHistoryRecord,
    FileHistoryRecord,

    // Change detection
    ChangesetRunReason,
    NeedsRunResult,

    // Scaffold
    CreateChangesetOptions,
    AddFileOptions,
} from './types.js'

export {
    DEFAULT_CHANGESET_OPTIONS,
    DEFAULT_BATCH_OPTIONS,

    // Errors
    ChangesetValidationError,
    ChangesetNotFoundError,
    ChangesetAlreadyAppliedError,
    ChangesetNotAppliedError,
    ChangesetOrphanedError,
    ManifestReferenceError,
} from './types.js'


// ─────────────────────────────────────────────────────────────
// Parser
// ─────────────────────────────────────────────────────────────

export {
    parseChangeset,
    discoverChangesets,
    resolveManifest,
    validateChangeset,
    hasRevertFiles,
    parseSequence,
    parseDescription,
} from './parser.js'


// ─────────────────────────────────────────────────────────────
// Scaffold
// ─────────────────────────────────────────────────────────────

export {
    createChangeset,
    addFile,
    removeFile,
    renameFile,
    reorderFiles,
    deleteChangeset,
} from './scaffold.js'


// ─────────────────────────────────────────────────────────────
// History
// ─────────────────────────────────────────────────────────────

export { ChangesetHistory } from './history.js'


// ─────────────────────────────────────────────────────────────
// Executor
// ─────────────────────────────────────────────────────────────

export {
    executeChangeset,
    revertChangeset,
} from './executor.js'


// ─────────────────────────────────────────────────────────────
// Manager
// ─────────────────────────────────────────────────────────────

export { ChangesetManager } from './manager.js'
