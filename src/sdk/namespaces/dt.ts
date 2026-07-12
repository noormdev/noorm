/**
 * DT namespace — portable data file import/export.
 *
 * Requires a connection for both export and import operations.
 */
import type { Kysely } from 'kysely';

import type { Dialect } from '../../core/connection/index.js';
import { exportTable as coreExportTable, importDtFile } from '../../core/dt/index.js';

import type { ContextState } from '../state.js';
import { requireConnection } from '../state.js';
import type { ExportOptions, ImportOptions } from '../types.js';
import { checkProtectedConfig } from '../guards.js';

// ─────────────────────────────────────────────────────────────
// DtNamespace
// ─────────────────────────────────────────────────────────────

export class DtNamespace {

    #state: ContextState;

    constructor(state: ContextState) {

        this.#state = state;

    }

    /**
     * Export a table to a .dt file.
     *
     * @example
     * ```typescript
     * const [result, err] = await ctx.noorm.dt.exportTable('users', './exports/users.dtz')
     * ```
     */
    async exportTable(
        tableName: string,
        filepath: string,
        options?: ExportOptions,
    ): Promise<[{ rowsWritten: number; bytesWritten: number } | null, Error | null]> {

        return coreExportTable({
            db: this.#kysely,
            dialect: this.#dialect,
            tableName,
            filepath,
            schema: options?.schema,
            passphrase: options?.passphrase,
            batchSize: options?.batchSize,
        });

    }

    /**
     * Import a .dt file into the connected database.
     *
     * @example
     * ```typescript
     * const [result, err] = await ctx.noorm.dt.importFile('./exports/users.dtz', {
     *     onConflict: 'skip',
     * })
     * ```
     */
    async importFile(
        filepath: string,
        options?: ImportOptions,
    ): Promise<[{ rowsImported: number; rowsSkipped: number } | null, Error | null]> {

        checkProtectedConfig(this.#state.config, this.#state.options, 'db:reset', 'dt.importFile');

        return importDtFile({
            filepath,
            db: this.#kysely,
            dialect: this.#dialect,
            passphrase: options?.passphrase,
            batchSize: options?.batchSize,
            onConflict: options?.onConflict,
            truncate: options?.truncate,
        });

    }

    // ─────────────────────────────────────────────────────
    // Private
    // ─────────────────────────────────────────────────────

    get #kysely(): Kysely<unknown> {

        return requireConnection(this.#state).db;

    }

    get #dialect(): Dialect {

        return this.#state.config.connection.dialect;

    }

}
