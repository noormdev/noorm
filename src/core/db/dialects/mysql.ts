/**
 * MySQL database operations.
 *
 * Dialect-specific SQL for database lifecycle management.
 */
import { sql } from 'kysely';
import { attempt } from '@logosdx/utils';

import type { ConnectionConfig } from '../../connection/types.js';
import type { DialectDbOperations } from '../types.js';

import { createConnection } from '../../connection/factory.js';
import { createDialectQuoting } from '../../shared/index.js';

const { quote } = createDialectQuoting({ open: '`', close: '`', escape: '``' });

/**
 * Builds the CREATE DATABASE IF NOT EXISTS statement.
 *
 * Quotes dbName as a single identifier so embedded backticks can't break
 * out of the DDL into arbitrary statements.
 *
 * @example
 * buildCreateDatabaseSql('my`app'); // → 'CREATE DATABASE IF NOT EXISTS `my``app`'
 */
export function buildCreateDatabaseSql(dbName: string): string {

    return `CREATE DATABASE IF NOT EXISTS ${quote(dbName)}`;

}

/**
 * Builds the DROP DATABASE IF EXISTS statement.
 *
 * @example
 * buildDropDatabaseSql('myapp'); // → 'DROP DATABASE IF EXISTS `myapp`'
 */
export function buildDropDatabaseSql(dbName: string): string {

    return `DROP DATABASE IF EXISTS ${quote(dbName)}`;

}

/**
 * Execute a query without a database (MySQL allows this).
 */
async function withoutDb<T>(
    config: ConnectionConfig,
    fn: (conn: Awaited<ReturnType<typeof createConnection>>) => Promise<T>,
): Promise<T> {

    const systemConfig = { ...config, database: '' };
    const conn = await createConnection(systemConfig, '__system__');

    const [result, err] = await attempt(() => fn(conn));

    await conn.destroy();

    if (err) throw err;

    return result;

}

/**
 * MySQL database operations.
 */
export const mysqlDbOperations: DialectDbOperations = {
    getSystemDatabase(): string | undefined {

        // MySQL allows connecting without a database
        return undefined;

    },

    async databaseExists(config: ConnectionConfig, dbName: string): Promise<boolean> {

        return withoutDb(config, async (conn) => {

            const result = await sql<{ count: number }>`
                SELECT COUNT(*) as count
                FROM information_schema.schemata
                WHERE schema_name = ${dbName}
            `.execute(conn.db);

            return (result.rows[0]?.count ?? 0) > 0;

        });

    },

    async createDatabase(config: ConnectionConfig, dbName: string): Promise<void> {

        await withoutDb(config, async (conn) => {

            await sql.raw(buildCreateDatabaseSql(dbName)).execute(conn.db);

        });

    },

    async dropDatabase(config: ConnectionConfig, dbName: string): Promise<void> {

        await withoutDb(config, async (conn) => {

            await sql.raw(buildDropDatabaseSql(dbName)).execute(conn.db);

        });

    },
};
