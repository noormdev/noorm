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

    truncateTable(tableName: string, schema?: string, restartIdentity = true): string {

        // MSSQL TRUNCATE cannot be used on tables referenced by FK constraints
        // even with NOCHECK CONSTRAINT. Use DELETE instead.
        const qualified = qualifiedName(tableName, schema);
        const deleteStmt = `DELETE FROM ${qualified}`;

        // If restarting identity, also reset the seed
        if (restartIdentity) {

            // DBCC CHECKIDENT resets identity; IF EXISTS check prevents error if no identity column
            // Use schemaName.tableName format for DBCC (without brackets)
            const dbccName = schema && schema !== 'dbo'
                ? `${schema}.${tableName}`
                : tableName;

            // eslint-disable-next-line max-len
            return `${deleteStmt}; IF EXISTS (SELECT * FROM sys.identity_columns WHERE OBJECT_NAME(object_id) = '${tableName}') DBCC CHECKIDENT ('${dbccName}', RESEED, 0)`;

        }

        return deleteStmt;

    },

    dropTable(tableName: string, schema?: string): string {

        return `DROP TABLE IF EXISTS ${qualifiedName(tableName, schema)}`;

    },

    dropView(viewName: string, schema?: string): string {

        return `DROP VIEW IF EXISTS ${qualifiedName(viewName, schema)}`;

    },

    dropFunction(name: string, schema?: string): string {

        // MSSQL functions (FN=scalar, IF=inline table, TF=table-valued)
        return `DROP FUNCTION IF EXISTS ${qualifiedName(name, schema)}`;

    },

    dropProcedure(name: string, schema?: string): string {

        // MSSQL stored procedures
        return `DROP PROCEDURE IF EXISTS ${qualifiedName(name, schema)}`;

    },

    dropType(typeName: string, schema?: string): string {

        return `DROP TYPE IF EXISTS ${qualifiedName(typeName, schema)}`;

    },

    dropForeignKey(constraintName: string, tableName: string, schema?: string): string {

        return `ALTER TABLE ${qualifiedName(tableName, schema)} DROP CONSTRAINT ${quote(constraintName)}`;

    },

};
