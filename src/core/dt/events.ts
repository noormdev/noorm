/**
 * Observer event types for .dt operations.
 *
 * Events emitted during export, import, cross-dialect streaming,
 * and schema validation for CLI progress display.
 */
import type { SchemaValidationResult } from './types.js';

/**
 * Events emitted by the dt module.
 *
 * Subscribe to these events to track .dt operation progress in the CLI.
 */
export interface DtEvents {

    /** Export begins for a table. */
    'dt:export:start': {
        filepath: string;
        table: string;
        columnCount: number;
    };

    /** After each batch flush during export. */
    'dt:export:progress': {
        filepath: string;
        table: string;
        rowsWritten: number;
        bytesWritten: number;
    };

    /** Export finished for a table. */
    'dt:export:complete': {
        filepath: string;
        table: string;
        rowsWritten: number;
        bytesWritten: number;
        durationMs: number;
    };

    /** Import begins for a file. */
    'dt:import:start': {
        filepath: string;
        sourceDialect: string;
        sourceVersion: string;
        table: string;
    };

    /** Schema parsed and validated during import. */
    'dt:import:schema': {
        filepath: string;
        table: string;
        columns: number;
        validation: SchemaValidationResult;
    };

    /** After each batch insert during import. */
    'dt:import:progress': {
        filepath: string;
        table: string;
        rowsImported: number;
        rowsSkipped: number;
    };

    /** Import finished for a file. */
    'dt:import:complete': {
        filepath: string;
        table: string;
        rowsImported: number;
        rowsSkipped: number;
        durationMs: number;
    };

    /** Cross-dialect stream begins. */
    'dt:stream:start': {
        table: string;
        sourceDialect: string;
        targetDialect: string;
    };

    /** After each batch conversion during streaming. */
    'dt:stream:progress': {
        table: string;
        rowsConverted: number;
    };

    /** Cross-dialect stream finished. */
    'dt:stream:complete': {
        table: string;
        rowsConverted: number;
        durationMs: number;
    };

    /** Schema validation completed. */
    'dt:validate:result': {
        table: string;
        valid: boolean;
        errors: string[];
        warnings: string[];
    };

}
