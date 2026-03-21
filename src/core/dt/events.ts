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

    // --- Three-tier worker pipeline progress ---

    /** A batch of rows arrived from the Connection Worker. */
    'dt:export:loaded': { table: string; loaded: number; totalRows: number };

    /** A compute worker finished serializing a row. */
    'dt:export:processed': { table: string; processed: number; totalRows: number };

    /** Order buffer flushed consecutive rows to DtWriter. */
    'dt:export:saved': { table: string; saved: number; totalRows: number };

    /** A batch of lines read from file by DtReader. */
    'dt:import:loaded': { table: string; loaded: number; totalRows: number };

    /** A compute worker finished deserializing a row. */
    'dt:import:processed': { table: string; processed: number; totalRows: number };

    /** Deserialized rows inserted into the database. */
    'dt:import:saved': { table: string; saved: number; totalRows: number };

    // --- Modify pipeline ---

    /** Modify operation begins. */
    'dt:modify:start': {
        inputPath: string;
        outputPath: string;
        recipeLength: number;
    };

    /** After each row processed during modify. */
    'dt:modify:progress': {
        rowsRead: number;
        rowsWritten: number;
        rowsFiltered: number;
    };

    /** Modify operation finished. */
    'dt:modify:complete': {
        result: {
            rowsRead: number;
            rowsWritten: number;
            rowsFiltered: number;
            columnsDropped: number;
            columnsAdded: number;
            columnsRenamed: number;
            outputPath: string;
            durationMs: number;
        };
    };

}
