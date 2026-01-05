/**
 * Change module types.
 *
 * Defines interfaces for changes - versioned database modifications
 * applied after initial schema build. Changes support forward changes
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
 * File extension type in changes.
 *
 * - 'sql' for direct SQL files (.sql, .sql.tmpl)
 * - 'txt' for manifest files referencing build SQL
 */
export type ChangeFileType = 'sql' | 'txt';

/**
 * A single file within a change.
 *
 * @example
 * ```typescript
 * const file: ChangeFile = {
 *     filename: '001_alter-users.sql',
 *     path: '/project/changes/2024-01-15-add-users/change/001_alter-users.sql',
 *     type: 'sql',
 * }
 * ```
 */
export interface ChangeFile {
    /** Filename (e.g., "001_alter-users.sql") */
    filename: string;

    /** Absolute path to file */
    path: string;

    /** File type */
    type: ChangeFileType;

    /** For .txt files, the resolved SQL paths (relative to schema dir) */
    resolvedPaths?: string[];

    /** Execution status after running */
    status?: ExecutionStatus;

    /** Why the file was skipped */
    skipReason?: string;
}

// ─────────────────────────────────────────────────────────────
// Change (from disk)
// ─────────────────────────────────────────────────────────────

/**
 * A change parsed from disk.
 *
 * Contains the folder structure with change and revert files.
 *
 * @example
 * ```typescript
 * const change: Change = {
 *     name: '2024-01-15-add-email-verification',
 *     path: '/project/changes/2024-01-15-add-email-verification',
 *     date: new Date('2024-01-15'),
 *     description: 'add-email-verification',
 *     changeFiles: [...],
 *     revertFiles: [...],
 *     hasChangelog: true,
 * }
 * ```
 */
export interface Change {
    /** Folder name (e.g., "2024-01-15-add-email-verification") */
    name: string;

    /** Absolute path to change folder */
    path: string;

    /** Date parsed from name (null if no date prefix) */
    date: Date | null;

    /** Human-readable description from name */
    description: string;

    /** Files in change/ folder */
    changeFiles: ChangeFile[];

    /** Files in revert/ folder */
    revertFiles: ChangeFile[];

    /** Whether changelog.md exists */
    hasChangelog: boolean;
}

// ─────────────────────────────────────────────────────────────
// Change Status (from database)
// ─────────────────────────────────────────────────────────────

/**
 * Status of a change from database records.
 *
 * Represents the most recent execution state.
 *
 * @example
 * ```typescript
 * const status: ChangeStatus = {
 *     name: '2024-01-15-add-users',
 *     status: 'success',
 *     appliedAt: new Date('2024-01-15T10:30:00Z'),
 *     appliedBy: 'Alice <alice@example.com>',
 *     revertedAt: null,
 *     errorMessage: null,
 * }
 * ```
 */
export interface ChangeStatus {
    /** Change name */
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
// Change List Item (merged disk + DB)
// ─────────────────────────────────────────────────────────────

/**
 * A change with merged disk and database information.
 *
 * Used by the list command to show all changes with status.
 *
 * @example
 * ```typescript
 * const item: ChangeListItem = {
 *     // From disk
 *     name: '2024-01-15-add-users',
 *     path: '/project/changes/...',
 *     // ...other Change fields
 *
 *     // From DB
 *     status: 'success',
 *     appliedAt: new Date(),
 *     // ...other ChangeStatus fields
 *
 *     // Computed
 *     isNew: false,
 *     orphaned: false,
 * }
 * ```
 */
export interface ChangeListItem {
    /** Change name (always present) */
    name: string;

    // From disk (optional for orphaned)
    /** Absolute path to change folder */
    path?: string;

    /** Date parsed from name (null if no date prefix) */
    date?: Date | null;

    /** Human-readable description from name */
    description?: string;

    /** Files in change/ folder */
    changeFiles?: ChangeFile[];

    /** Files in revert/ folder */
    revertFiles?: ChangeFile[];

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
 * Options for executing a change.
 *
 * @example
 * ```typescript
 * const options: ChangeOptions = {
 *     force: false,
 *     dryRun: false,
 *     preview: false,
 * }
 * ```
 */
export interface ChangeOptions {
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
export interface BatchChangeOptions extends ChangeOptions {
    /** Stop on first failure. Default: true */
    abortOnError?: boolean;
}

/**
 * Default change options.
 */
export const DEFAULT_CHANGE_OPTIONS: Required<Omit<ChangeOptions, 'output'>> & {
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
export const DEFAULT_BATCH_OPTIONS: Required<Omit<BatchChangeOptions, 'output'>> & {
    output: string | null;
} = {
    ...DEFAULT_CHANGE_OPTIONS,
    abortOnError: true,
};

// ─────────────────────────────────────────────────────────────
// Execution Context
// ─────────────────────────────────────────────────────────────

/**
 * Context required to execute changes.
 *
 * @example
 * ```typescript
 * const context: ChangeContext = {
 *     db,
 *     configName: 'dev',
 *     identity: { name: 'Alice', email: 'alice@example.com' },
 *     projectRoot: '/project',
 *     changesDir: '/project/changes',
 *     sqlDir: '/project/sql',
 * }
 * ```
 */
export interface ChangeContext {
    /** Kysely database connection */
    db: Kysely<NoormDatabase>;

    /** Name of the active config */
    configName: string;

    /** User identity for tracking */
    identity: Identity;

    /** Project root for template resolution */
    projectRoot: string;

    /** Directory containing changes */
    changesDir: string;

    /** Schema directory for resolving .txt references */
    sqlDir: string;

    /** Config object for template context */
    config?: Record<string, unknown>;

    /** Secrets for template context */
    secrets?: Record<string, string>;

    /** Global secrets for template context */
    globalSecrets?: Record<string, string>;

    /** Database dialect for lock formatting. Default: 'postgres' */
    dialect?: 'postgres' | 'mysql' | 'sqlite' | 'mssql';
}

// ─────────────────────────────────────────────────────────────
// Execution Results
// ─────────────────────────────────────────────────────────────

/**
 * Result of executing a single change.
 *
 * @example
 * ```typescript
 * const result: ChangeResult = {
 *     name: '2024-01-15-add-users',
 *     direction: 'change',
 *     status: 'success',
 *     files: [...],
 *     durationMs: 1234,
 * }
 * ```
 */
export interface ChangeResult {
    /** Change name */
    name: string;

    /** Operation direction */
    direction: Direction;

    /** Final status */
    status: OperationStatus;

    /** Individual file results */
    files: ChangeFileResult[];

    /** Total execution time */
    durationMs: number;

    /** Error message if failed */
    error?: string;

    /** Operation ID in tracking table */
    operationId?: number;
}

/**
 * Result of executing a single file within a change.
 */
export interface ChangeFileResult {
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
export interface BatchChangeResult {
    /** Overall status */
    status: 'success' | 'failed' | 'partial';

    /** Results for each change */
    changes: ChangeResult[];

    /** Number of changes executed */
    executed: number;

    /** Number of changes skipped */
    skipped: number;

    /** Number of changes that failed */
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
export interface ChangeHistoryRecord {
    /** Record ID */
    id: number;

    /** Change name */
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
 * Used to display all operation types (builds, runs, changes)
 * in a unified activity view.
 */
export interface UnifiedHistoryRecord extends ChangeHistoryRecord {
    /** Type of change operation */
    changeType: 'build' | 'run' | 'change';
}

/**
 * File execution record from history.
 */
export interface FileHistoryRecord {
    /** Record ID */
    id: number;

    /** Parent change ID */
    changeId: number;

    /** File path */
    filepath: string;

    /** File type */
    fileType: ChangeFileType;

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
 * Why a change needs to run.
 */
export type ChangeRunReason = 'new' | 'changed' | 'failed' | 'reverted' | 'stale' | 'force';

/**
 * Result of checking if a change needs to run.
 */
export interface NeedsRunResult {
    /** Whether the change needs to run */
    needsRun: boolean;

    /** Why it needs to run (if needsRun is true) */
    reason?: ChangeRunReason;

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
 * Options for creating a new change.
 */
export interface CreateChangeOptions {
    /** Description for the change name */
    description: string;

    /** Optional date (defaults to today) */
    date?: Date;
}

/**
 * Options for adding a file to a change.
 */
export interface AddFileOptions {
    /** Descriptive name for the file */
    name: string;

    /** File type */
    type: ChangeFileType;

    /** For 'txt' type, the paths to include */
    paths?: string[];

    /** Initial content (optional) */
    content?: string;
}

// ─────────────────────────────────────────────────────────────
// Error Types
// ─────────────────────────────────────────────────────────────

/**
 * Error when change structure is invalid.
 */
export class ChangeValidationError extends Error {

    override readonly name = 'ChangeValidationError' as const;

    constructor(
        public readonly changeName: string,
        public readonly issue: string,
    ) {

        super(`Invalid change '${changeName}': ${issue}`);

    }

}

/**
 * Error when change is not found.
 */
export class ChangeNotFoundError extends Error {

    override readonly name = 'ChangeNotFoundError' as const;

    constructor(public readonly changeName: string) {

        super(`Change not found: ${changeName}`);

    }

}

/**
 * Error when change is already applied.
 */
export class ChangeAlreadyAppliedError extends Error {

    override readonly name = 'ChangeAlreadyAppliedError' as const;

    constructor(
        public readonly changeName: string,
        public readonly appliedAt: Date,
    ) {

        super(`Change '${changeName}' already applied at ${appliedAt.toISOString()}`);

    }

}

/**
 * Error when trying to revert an unapplied change.
 */
export class ChangeNotAppliedError extends Error {

    override readonly name = 'ChangeNotAppliedError' as const;

    constructor(public readonly changeName: string) {

        super(`Cannot revert '${changeName}': not applied`);

    }

}

/**
 * Error when change is orphaned (in DB but not on disk).
 */
export class ChangeOrphanedError extends Error {

    override readonly name = 'ChangeOrphanedError' as const;

    constructor(public readonly changeName: string) {

        super(`Change '${changeName}' is orphaned (folder deleted from disk)`);

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
