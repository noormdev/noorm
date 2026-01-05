/**
 * MySQL Teardown Dialect
 *
 * MySQL-specific SQL generation for teardown operations.
 */
import type { TeardownDialectOperations } from '../types.js';

/**
 * Quote a MySQL identifier.
 */
function quote(name: string): string {

    return `\`${name.replace(/`/g, '``')}\``;

}

/**
 * Build fully qualified name with optional schema.
 * MySQL uses database instead of schema.
 */
function qualifiedName(name: string, schema?: string): string {

    if (schema) {

        return `${quote(schema)}.${quote(name)}`;

    }

    return quote(name);

}

/**
 * MySQL teardown operations.
 */
export const mysqlTeardownOperations: TeardownDialectOperations = {

    disableForeignKeyChecks(): string {

        return 'SET FOREIGN_KEY_CHECKS = 0';

    },

    enableForeignKeyChecks(): string {

        return 'SET FOREIGN_KEY_CHECKS = 1';

    },

    truncateTable(tableName: string, schema?: string, _restartIdentity = true): string {

        // MySQL TRUNCATE always resets AUTO_INCREMENT
        return `TRUNCATE TABLE ${qualifiedName(tableName, schema)}`;

    },

    dropTable(tableName: string, schema?: string): string {

        return `DROP TABLE IF EXISTS ${qualifiedName(tableName, schema)}`;

    },

    dropView(viewName: string, schema?: string): string {

        return `DROP VIEW IF EXISTS ${qualifiedName(viewName, schema)}`;

    },

    dropFunction(name: string, schema?: string): string {

        // MySQL user-defined functions
        return `DROP FUNCTION IF EXISTS ${qualifiedName(name, schema)}`;

    },

    dropProcedure(name: string, schema?: string): string {

        // MySQL stored procedures
        return `DROP PROCEDURE IF EXISTS ${qualifiedName(name, schema)}`;

    },

    dropType(_typeName: string, _schema?: string): string {

        // MySQL doesn't support custom types
        return '-- MySQL does not support custom types';

    },

    dropForeignKey(constraintName: string, tableName: string, schema?: string): string {

        return `ALTER TABLE ${qualifiedName(tableName, schema)} DROP FOREIGN KEY ${quote(constraintName)}`;

    },

};
