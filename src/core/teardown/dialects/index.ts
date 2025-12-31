/**
 * Teardown Dialect Factory
 *
 * Provides dialect-specific teardown operations.
 */
import type { Dialect } from '../../connection/types.js';
import type { TeardownDialectOperations } from '../types.js';
import { postgresTeardownOperations } from './postgres.js';
import { mysqlTeardownOperations } from './mysql.js';
import { mssqlTeardownOperations } from './mssql.js';
import { sqliteTeardownOperations } from './sqlite.js';

/**
 * Get teardown operations for a specific dialect.
 *
 * @param dialect - Database dialect
 * @returns Dialect-specific teardown operations
 *
 * @example
 * ```typescript
 * const ops = getTeardownOperations('postgres')
 * const sql = ops.truncateTable('users', 'public', true)
 * ```
 */
export function getTeardownOperations(dialect: Dialect): TeardownDialectOperations {

    switch (dialect) {

    case 'postgres':
        return postgresTeardownOperations;

    case 'mysql':
        return mysqlTeardownOperations;

    case 'mssql':
        return mssqlTeardownOperations;

    case 'sqlite':
        return sqliteTeardownOperations;

    default: {

        const exhaustiveCheck: never = dialect;
        throw new Error(`Unknown dialect: ${exhaustiveCheck}`);

    }

    }

}

// Re-export individual dialect operations for direct access if needed
export { postgresTeardownOperations } from './postgres.js';
export { mysqlTeardownOperations } from './mysql.js';
export { mssqlTeardownOperations } from './mssql.js';
export { sqliteTeardownOperations } from './sqlite.js';
