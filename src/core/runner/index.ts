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
    preview,
} from './runner.js'

// Tracker
export { Tracker } from './tracker.js'

// Checksum utilities
export {
    computeChecksum,
    computeChecksumFromContent,
    computeCombinedChecksum,
} from './checksum.js'

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
} from './types.js'

export { DEFAULT_RUN_OPTIONS } from './types.js'
