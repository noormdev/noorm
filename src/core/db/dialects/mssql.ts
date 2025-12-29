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

            await sql.raw(`CREATE DATABASE [${dbName}]`).execute(conn.db);

        });

    },

    async dropDatabase(config: ConnectionConfig, dbName: string): Promise<void> {

        await withMasterDb(config, async (conn) => {

            // Set to single user mode to disconnect all users
            await sql
                .raw(
                    `
                IF EXISTS(SELECT 1 FROM sys.databases WHERE name = '${dbName}')
                BEGIN
                    ALTER DATABASE [${dbName}] SET SINGLE_USER WITH ROLLBACK IMMEDIATE;
                    DROP DATABASE [${dbName}];
                END
            `,
                )
                .execute(conn.db);

        });

    },
};
