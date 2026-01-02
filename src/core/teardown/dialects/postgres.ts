/**
 * PostgreSQL Teardown Dialect
 *
 * PostgreSQL-specific SQL generation for teardown operations.
 */
import type { TeardownDialectOperations } from '../types.js';

/**
 * Quote a PostgreSQL identifier.
 */
function quote(name: string): string {

    return `"${name.replace(/"/g, '""')}"`;

}

/**
 * Build fully qualified name with optional schema.
 */
function qualifiedName(name: string, schema?: string): string {

    if (schema && schema !== 'public') {

        return `${quote(schema)}.${quote(name)}`;

    }

    return quote(name);

}

/**
 * PostgreSQL teardown operations.
 */
export const postgresTeardownOperations: TeardownDialectOperations = {

    disableForeignKeyChecks(): string {

        // Session-level setting that disables FK triggers
        return 'SET session_replication_role = \'replica\'';

    },

    enableForeignKeyChecks(): string {

        return 'SET session_replication_role = \'origin\'';

    },

    truncateTable(tableName: string, schema?: string, restartIdentity = true): string {

        const fullName = qualifiedName(tableName, schema);
        const restart = restartIdentity ? ' RESTART IDENTITY' : '';

        return `TRUNCATE TABLE ${fullName}${restart}`;

    },

    dropTable(tableName: string, schema?: string): string {

        return `DROP TABLE IF EXISTS ${qualifiedName(tableName, schema)} CASCADE`;

    },

    dropView(viewName: string, schema?: string): string {

        return `DROP VIEW IF EXISTS ${qualifiedName(viewName, schema)} CASCADE`;

    },

    dropFunction(name: string, schema?: string): string {

        // PostgreSQL functions may have overloads, CASCADE drops all
        return `DROP FUNCTION IF EXISTS ${qualifiedName(name, schema)} CASCADE`;

    },

    dropType(typeName: string, schema?: string): string {

        return `DROP TYPE IF EXISTS ${qualifiedName(typeName, schema)} CASCADE`;

    },

    dropForeignKey(constraintName: string, tableName: string, schema?: string): string {

        return `ALTER TABLE ${qualifiedName(tableName, schema)} DROP CONSTRAINT IF EXISTS ${quote(constraintName)}`;

    },

};
