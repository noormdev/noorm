/**
 * Runner module exports.
 *
 * SQL file execution with checksum-based change detection.
 */

// Runner functions
export {
    runBuild,
    runFile,
    runDir,
    runFiles,
    preview,
    discoverFiles,
    executeFiles,
    checkFilesStatus,
} from './runner.js';

// Tracker
export { Tracker } from './tracker.js';

// Checksum utilities
export {
    computeChecksum,
    computeChecksumFromContent,
    computeCombinedChecksum,
} from './checksum.js';

// Types
export type {
    RunOptions,
    RunContext,
    FileResult,
    BatchResult,
    BatchStatus,
    SkipReason,
    RunReason,
    NeedsRunResult,
    CreateOperationData,
    RecordExecutionData,
    // New unified types
    ChangeType,
    Direction,
    FileInput,
    ExecuteFilesOptions,
    // File status check types
    FileStatusCategory,
    FileStatusResult,
    FilesStatusResult,
} from './types.js';

export { DEFAULT_RUN_OPTIONS } from './types.js';
