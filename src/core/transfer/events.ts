/**
 * Transfer event types for observer integration.
 *
 * Events emitted during data transfer operations for CLI progress display.
 */

/**
 * Events emitted by the transfer module.
 *
 * Subscribe to these events to track transfer progress in the CLI.
 */
export interface TransferEvents {

    /** Emitted when transfer planning starts */
    'transfer:planning': {
        source: string;
        destination: string;
    };

    /** Emitted when transfer plan is ready */
    'transfer:plan:ready': {
        sameServer: boolean;
        tableCount: number;
        estimatedRows: number;
        warnings: string[];
    };

    /** Emitted when transfer execution starts */
    'transfer:starting': {
        tableCount: number;
        sameServer: boolean;
    };

    /** Emitted before transferring each table */
    'transfer:table:before': {
        table: string;
        index: number;
        total: number;
        rowCount: number;
    };

    /** Emitted during table transfer with progress */
    'transfer:table:progress': {
        table: string;
        rowsTransferred: number;
        rowsTotal: number;
        rowsSkipped: number;
    };

    /** Emitted after transferring each table */
    'transfer:table:after': {
        table: string;
        status: 'success' | 'skipped' | 'failed';
        rowsTransferred: number;
        rowsSkipped: number;
        durationMs: number;
        error?: string;
    };

    /** Emitted when transfer completes */
    'transfer:complete': {
        status: 'success' | 'partial' | 'failed';
        totalRows: number;
        tableCount: number;
        durationMs: number;
    };

}
