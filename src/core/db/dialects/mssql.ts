/**
 * MSSQL database operations.
 *
 * Dialect-specific SQL for database lifecycle management.
 */
import { sql } from 'kysely';
import { attempt } from '@logosdx/utils';

import type { ConnectionConfig } from '../../connection/types.js';
import type { DialectDbOperations } from '../types.js';

import { createConnection } from '../../connection/factory.js';
import { createDialectQuoting } from '../../shared/index.js';

const { quote } = createDialectQuoting({ open: '[', close: ']', escape: ']]' });

/**
 * Builds the CREATE DATABASE statement.
 *
 * Quotes dbName as a single identifier so embedded closing brackets can't
 * break out of the DDL into arbitrary statements.
 *
 * @example
 * buildCreateDatabaseSql('my]app'); // → 'CREATE DATABASE [my]]app]'
 */
export function buildCreateDatabaseSql(dbName: string): string {

    return `CREATE DATABASE ${quote(dbName)}`;

}

/**
 * Builds the conditional-drop batch: single-user + rollback to disconnect
 * active sessions, then drop, guarded by an existence check.
 *
 * T-SQL string literals have no backslash-escape channel, so the embedded
 * single quote is doubled per the standard SQL literal-escaping rule; the
 * `ALTER`/`DROP` identifiers are bracket-quoted independently of the
 * literal, since the two escaping rules don't share a channel to break out
 * through.
 *
 * @example
 * buildDropDatabaseSql('myapp');
 * // → "IF EXISTS(SELECT 1 FROM sys.databases WHERE name = 'myapp')\n" +
 * //   'BEGIN\n' +
 * //   '    ALTER DATABASE [myapp] SET SINGLE_USER WITH ROLLBACK IMMEDIATE;\n' +
 * //   '    DROP DATABASE [myapp];\n' +
 * //   'END'
 */
export function buildDropDatabaseSql(dbName: string): string {

    const identifier = quote(dbName);
    const literal = dbName.replace(/'/g, '\'\'');

    return [
        `IF EXISTS(SELECT 1 FROM sys.databases WHERE name = '${literal}')`,
        'BEGIN',
        `    ALTER DATABASE ${identifier} SET SINGLE_USER WITH ROLLBACK IMMEDIATE;`,
        `    DROP DATABASE ${identifier};`,
        'END',
    ].join('\n');

}

/**
 * Execute a query against the master database.
 */
async function withMasterDb<T>(
    config: ConnectionConfig,
    fn: (conn: Awaited<ReturnType<typeof createConnection>>) => Promise<T>,
): Promise<T> {

    const systemConfig = { ...config, database: 'master' };
    const conn = await createConnection(systemConfig, '__system__');

    const [result, err] = await attempt(() => fn(conn));

    await conn.destroy();

    if (err) throw err;

    return result;

}

/**
 * MSSQL database operations.
 */
export const mssqlDbOperations: DialectDbOperations = {
    getSystemDatabase(): string {

        return 'master';

    },

    async databaseExists(config: ConnectionConfig, dbName: string): Promise<boolean> {

        return withMasterDb(config, async (conn) => {

            const result = await sql<{ count: number }>`
                SELECT COUNT(*) as count
                FROM sys.databases
                WHERE name = ${dbName}
            `.execute(conn.db);

            return (result.rows[0]?.count ?? 0) > 0;

        });

    },

    async createDatabase(config: ConnectionConfig, dbName: string): Promise<void> {

        // Check if exists first (MSSQL has no IF NOT EXISTS for CREATE DATABASE)
        const exists = await this.databaseExists(config, dbName);

        if (exists) return;

        await withMasterDb(config, async (conn) => {

            await sql.raw(buildCreateDatabaseSql(dbName)).execute(conn.db);

        });

    },

    async dropDatabase(config: ConnectionConfig, dbName: string): Promise<void> {

        await withMasterDb(config, async (conn) => {

            // Set to single user mode to disconnect all users
            await sql.raw(buildDropDatabaseSql(dbName)).execute(conn.db);

        });

    },
};
