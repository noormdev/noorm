/**
 * Vitest global setup.
 *
 * Creates required directories and ensures test databases exist before tests run.
 * Returns a teardown function to clean up test artifacts.
 */
import { mkdirSync, existsSync } from 'node:fs';
import { readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { sql } from 'kysely';

import { createConnection, testConnection } from '../src/core/connection/factory.js';
import { TEST_CONNECTIONS } from './utils/db.js';

/**
 * Pattern matching test directories (test-[8 hex chars]).
 */
const TEST_DIR_PATTERN = /^test-[0-9a-f]{8}$/;

/**
 * Ensure the MSSQL test database exists.
 *
 * Postgres and MySQL auto-create via POSTGRES_DB / MYSQL_DATABASE env vars.
 * MSSQL has no equivalent, so we create it manually against the master database.
 *
 * Only runs when MSSQL is reachable (i.e. Docker containers are up).
 * Skipped silently for local dev without containers — individual tests
 * will fail with clear errors via skipIfNoContainer.
 */
async function ensureMssqlDatabase(): Promise<void> {

    const config = TEST_CONNECTIONS.mssql;
    const dbName = config.database ?? 'noorm_test';

    // Check if MSSQL server is reachable
    const serverCheck = await testConnection(config, { testServerOnly: true });

    if (!serverCheck.ok) return;

    // Server is up — database creation must succeed or fail hard
    const conn = await createConnection({
        ...config,
        database: 'master',
    }, '__global_setup__');

    const dbCheck = await sql<{ count: number }>`
        SELECT COUNT(*) as count FROM sys.databases WHERE name = ${dbName}
    `.execute(conn.db);

    if (dbCheck.rows[0]?.count === 0) {

        await sql.raw(`CREATE DATABASE [${dbName}]`).execute(conn.db);

    }

    await conn.destroy();

}

export default async function globalSetup() {

    const tmpDir = join(process.cwd(), 'tmp');

    if (!existsSync(tmpDir)) {

        mkdirSync(tmpDir, { recursive: true });

    }

    await ensureMssqlDatabase();

    // Return teardown function
    return async () => {

        try {

            const entries = await readdir(tmpDir);
            const testDirs = entries.filter((name) => TEST_DIR_PATTERN.test(name));

            await Promise.all(
                testDirs.map((name) => rm(join(tmpDir, name), { recursive: true, force: true })),
            );

            if (testDirs.length > 0) {

                console.log(`\n🧹 Cleaned up ${testDirs.length} test directories`);

            }

        }
        catch {
            // tmp dir may not exist, ignore
        }

    };

}
