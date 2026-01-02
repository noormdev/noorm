/**
 * Changeset module types.
 *
 * Defines interfaces for changesets - versioned database modifications
 * applied after initial schema build. Changesets support forward changes
 * and rollbacks with execution tracking.
 *
 * WHY: Centralized type definitions ensure consistency across
 * parser, executor, history, and manager components.
 */
import type { Kysely } from 'kysely';

import type {
    NoormDatabase,
    OperationStatus,
    Direction,
    ExecutionStatus,
} from '../shared/index.js';
import type { Identity } from '../identity/index.js';

// ─────────────────────────────────────────────────────────────
// File Types
// ─────────────────────────────────────────────────────────────

/**
 * File extension type in changesets.
 *
 * - 'sql' for direct SQL files (.sql, .sql.tmpl)
 * - 'txt' for manifest files referencing build SQL
 */
export type ChangesetFileType = 'sql' | 'txt';

/**
 * A single file within a changeset.
 *
 * @example
 * ```typescript
 * const file: ChangesetFile = {
 *     filename: '001_alter-users.sql',
 *     path: '/project/changesets/2024-01-15-add-users/change/001_alter-users.sql',
 *     type: 'sql',
 * }
 * ```
 */
export interface ChangesetFile {
    /** Filename (e.g., "001_alter-users.sql") */
    filename: string;

    /** Absolute path to file */
    path: string;

    /** File type */
    type: ChangesetFileType;

    /** For .txt files, the resolved SQL paths (relative to schema dir) */
    resolvedPaths?: string[];

    /** Execution status after running */
    status?: ExecutionStatus;

    /** Why the file was skipped */
    skipReason?: string;
}

// ─────────────────────────────────────────────────────────────
// Changeset (from disk)
// ─────────────────────────────────────────────────────────────

/**
 * A changeset parsed from disk.
 *
 * Contains the folder structure with change and revert files.
 *
 * @example
 * ```typescript
 * const changeset: Changeset = {
 *     name: '2024-01-15-add-email-verification',
 *     path: '/project/changesets/2024-01-15-add-email-verification',
 *     date: new Date('2024-01-15'),
 *     description: 'add-email-verification',
 *     changeFiles: [...],
 *     revertFiles: [...],
 *     hasChangelog: true,
 * }
 * ```
 */
export interface Changeset {
    /** Folder name (e.g., "2024-01-15-add-email-verification") */
    name: string;

    /** Absolute path to changeset folder */
    path: string;

    /** Date parsed from name (null if no date prefix) */
    date: Date | null;

    /** Human-readable description from name */
    description: string;

    /** Files in change/ folder */
    changeFiles: ChangesetFile[];

    /** Files in revert/ folder */
    revertFiles: ChangesetFile[];

    /** Whether changelog.md exists */
    hasChangelog: boolean;
}

// ─────────────────────────────────────────────────────────────
// Changeset Status (from database)
// ─────────────────────────────────────────────────────────────

/**
 * Status of a changeset from database records.
 *
 * Represents the most recent execution state.
 *
 * @example
 * ```typescript
 * const status: ChangesetStatus = {
 *     name: '2024-01-15-add-users',
 *     status: 'success',
 *     appliedAt: new Date('2024-01-15T10:30:00Z'),
 *     appliedBy: 'Alice <alice@example.com>',
 *     revertedAt: null,
 *     errorMessage: null,
 * }
 * ```
 */
export interface ChangesetStatus {
    /** Changeset name */
    name: string;

    /** Current status */
    status: OperationStatus;

    /** When last applied (null if never) */
    appliedAt: Date | null;

    /** Who applied it */
    appliedBy: string | null;

    /** When reverted (null if not reverted) */
    revertedAt: Date | null;

    /** Error message if failed */
    errorMessage: string | null;
}

// ─────────────────────────────────────────────────────────────
// Changeset List Item (merged disk + DB)
// ─────────────────────────────────────────────────────────────

/**
 * A changeset with merged disk and database information.
 *
 * Used by the list command to show all changesets with status.
 *
 * @example
 * ```typescript
 * const item: ChangesetListItem = {
 *     // From disk
 *     name: '2024-01-15-add-users',
 *     path: '/project/changesets/...',
 *     // ...other Changeset fields
 *
 *     // From DB
 *     status: 'success',
 *     appliedAt: new Date(),
 *     // ...other ChangesetStatus fields
 *
 *     // Computed
 *     isNew: false,
 *     orphaned: false,
 * }
 * ```
 */
export interface ChangesetListItem {
    /** Changeset name (always present) */
    name: string;

    // From disk (optional for orphaned)
    /** Absolute path to changeset folder */
    path?: string;

    /** Date parsed from name (null if no date prefix) */
    date?: Date | null;

    /** Human-readable description from name */
    description?: string;

    /** Files in change/ folder */
    changeFiles?: ChangesetFile[];

    /** Files in revert/ folder */
    revertFiles?: ChangesetFile[];

    /** Whether changelog.md exists */
    hasChangelog?: boolean;

    // From DB
    /** Current status */
    status: OperationStatus;

    /** When last applied (null if never) */
    appliedAt: Date | null;

    /** Who applied it */
    appliedBy: string | null;

    /** When reverted (null if not reverted) */
    revertedAt: Date | null;

    /** Error message if failed */
    errorMessage: string | null;

    // Computed
    /** True if exists on disk but no DB record */
    isNew: boolean;

    /** True if exists in DB but folder deleted from disk */
    orphaned: boolean;
}

// ─────────────────────────────────────────────────────────────
// Execution Options
// ─────────────────────────────────────────────────────────────

/**
 * Options for executing a changeset.
 *
 * @example
 * ```typescript
 * const options: ChangesetOptions = {
 *     force: false,
 *     dryRun: false,
 *     preview: false,
 * }
 * ```
 */
export interface ChangesetOptions {
    /** Re-run even if already applied. Default: false */
    force?: boolean;

    /** Render to tmp/ without executing. Default: false */
    dryRun?: boolean;

    /** Output rendered SQL without executing. Default: false */
    preview?: boolean;

    /** Write preview output to file. Default: null */
    output?: string | null;
}

/**
 * Options for batch operations (next, ff, rewind).
 */
export interface BatchChangesetOptions extends ChangesetOptions {
    /** Stop on first failure. Default: true */
    abortOnError?: boolean;
}

/**
 * Default changeset options.
 */
export const DEFAULT_CHANGESET_OPTIONS: Required<Omit<ChangesetOptions, 'output'>> & {
    output: string | null;
} = {
    force: false,
    dryRun: false,
    preview: false,
    output: null,
};

/**
 * Default batch options.
 */
export const DEFAULT_BATCH_OPTIONS: Required<Omit<BatchChangesetOptions, 'output'>> & {
    output: string | null;
} = {
    ...DEFAULT_CHANGESET_OPTIONS,
    abortOnError: true,
};

// ─────────────────────────────────────────────────────────────
// Execution Context
// ─────────────────────────────────────────────────────────────

/**
 * Context required to execute changesets.
 *
 * @example
 * ```typescript
 * const context: ChangesetContext = {
 *     db,
 *     configName: 'dev',
 *     identity: { name: 'Alice', email: 'alice@example.com' },
 *     projectRoot: '/project',
 *     changesetsDir: '/project/changesets',
 *     schemaDir: '/project/sql',
 * }
 * ```
 */
export interface ChangesetContext {
    /** Kysely database connection */
    db: Kysely<NoormDatabase>;

    /** Name of the active config */
    configName: string;

    /** User identity for tracking */
    identity: Identity;

    /** Project root for template resolution */
    projectRoot: string;

    /** Directory containing changesets */
    changesetsDir: string;

    /** Schema directory for resolving .txt references */
    schemaDir: string;

    /** Config object for template context */
    config?: Record<string, unknown>;

    /** Secrets for template context */
    secrets?: Record<string, string>;

    /** Global secrets for template context */
    globalSecrets?: Record<string, string>;
}

// ─────────────────────────────────────────────────────────────
// Execution Results
// ─────────────────────────────────────────────────────────────

/**
 * Result of executing a single changeset.
 *
 * @example
 * ```typescript
 * const result: ChangesetResult = {
 *     name: '2024-01-15-add-users',
 *     direction: 'change',
 *     status: 'success',
 *     files: [...],
 *     durationMs: 1234,
 * }
 * ```
 */
export interface ChangesetResult {
    /** Changeset name */
    name: string;

    /** Operation direction */
    direction: Direction;

    /** Final status */
    status: OperationStatus;

    /** Individual file results */
    files: ChangesetFileResult[];

    /** Total execution time */
    durationMs: number;

    /** Error message if failed */
    error?: string;

    /** Operation ID in tracking table */
    operationId?: number;
}

/**
 * Result of executing a single file within a changeset.
 */
export interface ChangesetFileResult {
    /** File path */
    filepath: string;

    /** File checksum */
    checksum: string;

    /** Execution status */
    status: ExecutionStatus;

    /** Why skipped (if skipped) */
    skipReason?: string;

    /** Execution time in milliseconds */
    durationMs?: number;

    /** Error message if failed */
    error?: string;

    /** Rendered SQL (only in preview mode) */
    renderedSql?: string;
}

/**
 * Result of a batch operation (next, ff, rewind).
 */
export interface BatchChangesetResult {
    /** Overall status */
    status: 'success' | 'failed' | 'partial';

    /** Results for each changeset */
    changesets: ChangesetResult[];

    /** Number of changesets executed */
    executed: number;

    /** Number of changesets skipped */
    skipped: number;

    /** Number of changesets that failed */
    failed: number;

    /** Total execution time */
    durationMs: number;
}

// ─────────────────────────────────────────────────────────────
// History Types
// ─────────────────────────────────────────────────────────────

/**
 * A single execution record from history.
 */
export interface ChangesetHistoryRecord {
    /** Record ID */
    id: number;

    /** Changeset name */
    name: string;

    /** Operation direction */
    direction: Direction;

    /** Status */
    status: OperationStatus;

    /** When executed */
    executedAt: Date;

    /** Who executed */
    executedBy: string;

    /** Duration in milliseconds */
    durationMs: number;

    /** Error message if failed */
    errorMessage: string | null;

    /** Checksum of files */
    checksum: string;
}

/**
 * Unified history record that includes the change type.
 *
 * Used to display all operation types (builds, runs, changesets)
 * in a unified activity view.
 */
export interface UnifiedHistoryRecord extends ChangesetHistoryRecord {
    /** Type of change operation */
    changeType: 'build' | 'run' | 'changeset';
}

/**
 * File execution record from history.
 */
export interface FileHistoryRecord {
    /** Record ID */
    id: number;

    /** Parent changeset ID */
    changesetId: number;

    /** File path */
    filepath: string;

    /** File type */
    fileType: ChangesetFileType;

    /** File checksum */
    checksum: string;

    /** Execution status */
    status: ExecutionStatus;

    /** Skip reason if skipped */
    skipReason: string | null;

    /** Error message if failed */
    errorMessage: string | null;

    /** Duration in milliseconds */
    durationMs: number;
}

// ─────────────────────────────────────────────────────────────
// Change Detection
// ─────────────────────────────────────────────────────────────

/**
 * Why a changeset needs to run.
 */
export type ChangesetRunReason = 'new' | 'changed' | 'failed' | 'reverted' | 'stale' | 'force';

/**
 * Result of checking if a changeset needs to run.
 */
export interface NeedsRunResult {
    /** Whether the changeset needs to run */
    needsRun: boolean;

    /** Why it needs to run (if needsRun is true) */
    reason?: ChangesetRunReason;

    /** Why it was skipped (if needsRun is false) */
    skipReason?: string;

    /** Previous checksum if exists */
    previousChecksum?: string;

    /** Previous status if exists */
    previousStatus?: OperationStatus;
}

// ─────────────────────────────────────────────────────────────
// Scaffold Types
// ─────────────────────────────────────────────────────────────

/**
 * Options for creating a new changeset.
 */
export interface CreateChangesetOptions {
    /** Description for the changeset name */
    description: string;

    /** Optional date (defaults to today) */
    date?: Date;
}

/**
 * Options for adding a file to a changeset.
 */
export interface AddFileOptions {
    /** Descriptive name for the file */
    name: string;

    /** File type */
    type: ChangesetFileType;

    /** For 'txt' type, the paths to include */
    paths?: string[];

    /** Initial content (optional) */
    content?: string;
}

// ─────────────────────────────────────────────────────────────
// Error Types
// ─────────────────────────────────────────────────────────────

/**
 * Error when changeset structure is invalid.
 */
export class ChangesetValidationError extends Error {

    override readonly name = 'ChangesetValidationError' as const;

    constructor(
        public readonly changesetName: string,
        public readonly issue: string,
    ) {

        super(`Invalid changeset '${changesetName}': ${issue}`);

    }

}

/**
 * Error when changeset is not found.
 */
export class ChangesetNotFoundError extends Error {

    override readonly name = 'ChangesetNotFoundError' as const;

    constructor(public readonly changesetName: string) {

        super(`Changeset not found: ${changesetName}`);

    }

}

/**
 * Error when changeset is already applied.
 */
export class ChangesetAlreadyAppliedError extends Error {

    override readonly name = 'ChangesetAlreadyAppliedError' as const;

    constructor(
        public readonly changesetName: string,
        public readonly appliedAt: Date,
    ) {

        super(`Changeset '${changesetName}' already applied at ${appliedAt.toISOString()}`);

    }

}

/**
 * Error when trying to revert an unapplied changeset.
 */
export class ChangesetNotAppliedError extends Error {

    override readonly name = 'ChangesetNotAppliedError' as const;

    constructor(public readonly changesetName: string) {

        super(`Cannot revert '${changesetName}': not applied`);

    }

}

/**
 * Error when changeset is orphaned (in DB but not on disk).
 */
export class ChangesetOrphanedError extends Error {

    override readonly name = 'ChangesetOrphanedError' as const;

    constructor(public readonly changesetName: string) {

        super(`Changeset '${changesetName}' is orphaned (folder deleted from disk)`);

    }

}

/**
 * Error when .txt manifest has invalid references.
 */
export class ManifestReferenceError extends Error {

    override readonly name = 'ManifestReferenceError' as const;

    constructor(
        public readonly manifestPath: string,
        public readonly missingPath: string,
    ) {

        super(`Manifest '${manifestPath}' references missing file: ${missingPath}`);

    }

}
