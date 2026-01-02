/**
 * SQLite Teardown Dialect
 *
 * SQLite-specific SQL generation for teardown operations.
 */
import type { TeardownDialectOperations } from '../types.js';

/**
 * Quote a SQLite identifier with double quotes.
 */
function quote(name: string): string {

    return `"${name.replace(/"/g, '""')}"`;

}

/**
 * Escape a value for single-quoted string literal.
 */
function escapeString(value: string): string {

    return value.replace(/'/g, "''");

}

/**
 * SQLite teardown operations.
 *
 * SQLite has limited DDL compared to other databases:
 * - No TRUNCATE statement (use DELETE)
 * - No stored procedures
 * - No custom types
 * - No schemas (single namespace)
 */
export const sqliteTeardownOperations: TeardownDialectOperations = {

    disableForeignKeyChecks(): string {

        return 'PRAGMA foreign_keys = OFF';

    },

    enableForeignKeyChecks(): string {

        return 'PRAGMA foreign_keys = ON';

    },

    truncateTable(tableName: string, _schema?: string, restartIdentity = false): string {

        // SQLite doesn't have TRUNCATE, use DELETE
        const deleteStmt = `DELETE FROM ${quote(tableName)}`;

        if (restartIdentity) {

            // Reset sqlite_sequence to restart AUTOINCREMENT counters
            // Note: sqlite_sequence only exists if the table has AUTOINCREMENT
            const sequenceStmt = `DELETE FROM sqlite_sequence WHERE name = '${escapeString(tableName)}'`;

            return `${deleteStmt}; ${sequenceStmt}`;

        }

        return deleteStmt;

    },

    dropTable(tableName: string, _schema?: string): string {

        return `DROP TABLE IF EXISTS ${quote(tableName)}`;

    },

    dropView(viewName: string, _schema?: string): string {

        return `DROP VIEW IF EXISTS ${quote(viewName)}`;

    },

    dropFunction(_name: string, _schema?: string): string {

        // SQLite doesn't support stored procedures/functions
        return '-- SQLite does not support stored procedures';

    },

    dropType(_typeName: string, _schema?: string): string {

        // SQLite doesn't support custom types
        return '-- SQLite does not support custom types';

    },

    dropForeignKey(_constraintName: string, _tableName: string, _schema?: string): string {

        // SQLite doesn't support ALTER TABLE DROP CONSTRAINT
        // FK constraints are disabled globally instead
        return '-- SQLite does not support dropping individual FK constraints';

    },

};
