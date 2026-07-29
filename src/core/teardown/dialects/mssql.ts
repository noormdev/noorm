/**
 * MSSQL Teardown Dialect
 *
 * Microsoft SQL Server-specific SQL generation for teardown operations.
 */
import type { TeardownDialectOperations, TeardownTableRef } from '../types.js';
import { createDialectQuoting } from '../../shared/index.js';

const { quote, qualifiedName } = createDialectQuoting({
    open: '[',
    close: ']',
    escape: ']]',
});

/**
 * MSSQL teardown operations.
 *
 * MSSQL doesn't have a session-level FK disable like PostgreSQL or MySQL.
 * We have to explicitly drop FK constraints first.
 */
export const mssqlTeardownOperations: TeardownDialectOperations = {

    disableForeignKeyChecks(tables?: TeardownTableRef[]): string | string[] {

        // MSSQL has no session-level FK toggle. With a table list, emit
        // per-table NOCHECK statements (sequential, single connection).
        // Without a list, fall back to sp_MSforeachtable for backward
        // compatibility — but production callers should always pass tables
        // because the foreach spawns parallel workers that deadlock on
        // schema locks (see mssql-problems.md #6).
        if (tables && tables.length > 0) {

            return tables.map((t) => `ALTER TABLE ${qualifiedName(t.name, t.schema)} NOCHECK CONSTRAINT ALL`);

        }

        return 'EXEC sp_MSforeachtable \'ALTER TABLE ? NOCHECK CONSTRAINT ALL\'';

    },

    enableForeignKeyChecks(tables?: TeardownTableRef[]): string | string[] {

        if (tables && tables.length > 0) {

            // WITH CHECK CHECK CONSTRAINT ALL re-validates existing rows.
            // Plain CHECK CONSTRAINT ALL marks the FK as trusted-only, which
            // matches the original sp_MSforeachtable behavior.
            return tables.map((t) => `ALTER TABLE ${qualifiedName(t.name, t.schema)} CHECK CONSTRAINT ALL`);

        }

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

    dropCheckConstraints(): string {

        // A scalar UDF referenced by a CHECK constraint can't be dropped while
        // the referencing table exists (error 3729). We drop functions before
        // tables (for schema-bound deps), so sever the CHECK dependency first.
        // Built dynamically because constraint names aren't known up front;
        // the `noorm` schema is excluded so internal tables stay intact.
        return [
            "DECLARE @noorm_drop_checks NVARCHAR(MAX) = N'';",
            'SELECT @noorm_drop_checks += N\'ALTER TABLE \' '
                + '+ QUOTENAME(SCHEMA_NAME(t.schema_id)) + N\'.\' + QUOTENAME(t.name) '
                + '+ N\' DROP CONSTRAINT \' + QUOTENAME(cc.name) + N\';\'',
            'FROM sys.check_constraints cc '
                + 'INNER JOIN sys.tables t ON cc.parent_object_id = t.object_id',
            "WHERE SCHEMA_NAME(t.schema_id) <> 'noorm';",
            'EXEC sp_executesql @noorm_drop_checks;',
        ].join('\n');

    },

};
