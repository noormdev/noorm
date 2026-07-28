/**
 * PostgreSQL database operations.
 *
 * Dialect-specific SQL for database lifecycle management.
 */
import { sql } from 'kysely';
import { attempt } from '@logosdx/utils';

import type { ConnectionConfig } from '../../connection/types.js';
import type { DialectDbOperations } from '../types.js';

import { createConnection } from '../../connection/factory.js';
import { createDialectQuoting } from '../../shared/index.js';

const { quote } = createDialectQuoting({ open: '"', close: '"', escape: '""' });

/**
 * Builds the CREATE DATABASE statement.
 *
 * Quotes dbName as a single identifier so embedded double quotes can't
 * break out of the DDL into arbitrary statements.
 *
 * @example
 * buildCreateDatabaseSql('my"app'); // → 'CREATE DATABASE "my""app"'
 */
export function buildCreateDatabaseSql(dbName: string): string {

    return `CREATE DATABASE ${quote(dbName)}`;

}

/**
 * Builds the DROP DATABASE IF EXISTS statement.
 *
 * @example
 * buildDropDatabaseSql('myapp'); // → 'DROP DATABASE IF EXISTS "myapp"'
 */
export function buildDropDatabaseSql(dbName: string): string {

    return `DROP DATABASE IF EXISTS ${quote(dbName)}`;

}

/**
 * Execute a query against the system database.
 */
async function withSystemDb<T>(
    config: ConnectionConfig,
    fn: (conn: Awaited<ReturnType<typeof createConnection>>) => Promise<T>,
): Promise<T> {

    const systemConfig = { ...config, database: 'postgres' };
    const conn = await createConnection(systemConfig, '__system__');

    const [result, err] = await attempt(() => fn(conn));

    await conn.destroy();

    if (err) throw err;

    return result;

}

/**
 * PostgreSQL database operations.
 */
export const postgresDbOperations: DialectDbOperations = {
    getSystemDatabase(): string {

        return 'postgres';

    },

    async databaseExists(config: ConnectionConfig, dbName: string): Promise<boolean> {

        return withSystemDb(config, async (conn) => {

            const result = await sql<{ exists: boolean }>`
                SELECT EXISTS(
                    SELECT 1 FROM pg_database WHERE datname = ${dbName}
                ) as exists
            `.execute(conn.db);

            return result.rows[0]?.exists ?? false;

        });

    },

    async createDatabase(config: ConnectionConfig, dbName: string): Promise<void> {

        // Check if exists first (CREATE DATABASE IF NOT EXISTS not supported in PG)
        const exists = await this.databaseExists(config, dbName);

        if (exists) return;

        await withSystemDb(config, async (conn) => {

            await sql.raw(buildCreateDatabaseSql(dbName)).execute(conn.db);

        });

    },

    async dropDatabase(config: ConnectionConfig, dbName: string): Promise<void> {

        await withSystemDb(config, async (conn) => {

            // Terminate existing connections first
            await sql`
                SELECT pg_terminate_backend(pg_stat_activity.pid)
                FROM pg_stat_activity
                WHERE pg_stat_activity.datname = ${dbName}
                AND pid <> pg_backend_pid()
            `.execute(conn.db);

            await sql.raw(buildDropDatabaseSql(dbName)).execute(conn.db);

        });

    },
};
