/**
 * MSSQL Teardown Dialect
 *
 * Microsoft SQL Server-specific SQL generation for teardown operations.
 */
import type { TeardownDialectOperations } from '../types.js';

/**
 * Quote a MSSQL identifier.
 */
function quote(name: string): string {

    return `[${name.replace(/\]/g, ']]')}]`;

}

/**
 * Build fully qualified name with optional schema.
 */
function qualifiedName(name: string, schema?: string): string {

    if (schema && schema !== 'dbo') {

        return `${quote(schema)}.${quote(name)}`;

    }

    return quote(name);

}

/**
 * MSSQL teardown operations.
 *
 * MSSQL doesn't have a session-level FK disable like PostgreSQL or MySQL.
 * We have to explicitly drop FK constraints first.
 */
export const mssqlTeardownOperations: TeardownDialectOperations = {

    disableForeignKeyChecks(): string {

        // MSSQL uses NOCHECK per-table, but we'll use sp_MSforeachtable
        // for a session-wide effect during teardown
        return 'EXEC sp_MSforeachtable \'ALTER TABLE ? NOCHECK CONSTRAINT ALL\'';

    },

    enableForeignKeyChecks(): string {

        return 'EXEC sp_MSforeachtable \'ALTER TABLE ? CHECK CONSTRAINT ALL\'';

    },

    truncateTable(tableName: string, schema?: string, _restartIdentity = true): string {

        // MSSQL TRUNCATE requires special handling for identity reset
        // TRUNCATE automatically resets identity if the table has one
        return `TRUNCATE TABLE ${qualifiedName(tableName, schema)}`;

    },

    dropTable(tableName: string, schema?: string): string {

        return `DROP TABLE IF EXISTS ${qualifiedName(tableName, schema)}`;

    },

    dropView(viewName: string, schema?: string): string {

        return `DROP VIEW IF EXISTS ${qualifiedName(viewName, schema)}`;

    },

    dropFunction(name: string, schema?: string): string {

        // MSSQL uses PROCEDURE for stored procedures
        return `DROP PROCEDURE IF EXISTS ${qualifiedName(name, schema)}`;

    },

    dropType(typeName: string, schema?: string): string {

        return `DROP TYPE IF EXISTS ${qualifiedName(typeName, schema)}`;

    },

    dropForeignKey(constraintName: string, tableName: string, schema?: string): string {

        return `ALTER TABLE ${qualifiedName(tableName, schema)} DROP CONSTRAINT ${quote(constraintName)}`;

    },

};
