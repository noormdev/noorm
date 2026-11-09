import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sql, type Kysely } from 'kysely';
import { createConnection } from '../../src/core/connection/factory.js';
import type { ConnectionConfig, ConnectionResult, Dialect } from '../../src/core/connection/types.js';
import type { NoormDatabase } from '../../src/core/shared/tables.js';
import { TEST_CONNECTIONS } from './db.js';

/** A fresh database owned by one test; cleanup never targets a configured database. */
export async function withPipelineDatabase<T>(dialect: Dialect, body: (fixture: {
    db: Kysely<NoormDatabase>; untypedDb: Kysely<unknown>; connection: ConnectionConfig;
}) => Promise<T>, options: { sqliteFile?: boolean; pool?: ConnectionConfig['pool'] } = {}): Promise<T> {

    if (dialect === 'sqlite') {

        const directory = options.sqliteFile ? await mkdtemp(join(tmpdir(), 'noorm-pipeline-db-')) : undefined;
        const connection: ConnectionConfig = { dialect, database: directory ? join(directory, 'database.sqlite') : ':memory:' };
        let conn: ConnectionResult | undefined;
        try {

            conn = await createConnection(connection, 'pipeline-isolated');
            await sql`PRAGMA foreign_keys = ON`.execute(conn.db);

            return await body({ db: conn.db as Kysely<NoormDatabase>, untypedDb: conn.db, connection });

        }
        finally {

            try {

                if (conn) await conn.destroy();

            }
            finally {

                if (directory) await rm(directory, { recursive: true, force: true });

            }

        }

    }

    const name = `noorm_test_pipeline_${randomUUID().replaceAll('-', '')}`;
    const base = TEST_CONNECTIONS[dialect];
    const adminConfig: ConnectionConfig = dialect === 'mysql'
        ? { ...base, database: 'mysql', user: process.env['TEST_MYSQL_ADMIN_USER'] ?? 'root', password: process.env['TEST_MYSQL_ADMIN_PASSWORD'] ?? 'noorm_test' }
        : dialect === 'mssql' ? { ...base, database: 'master' } : base;
    const admin = await createConnection(adminConfig, 'pipeline-admin');
    let created = false;
    let conn: ConnectionResult | undefined;
    try {

        await sql`CREATE DATABASE ${sql.id(name)}`.execute(admin.db);
        created = true;
        const connection = { ...adminConfig, database: name, pool: options.pool };
        conn = await createConnection(connection, 'pipeline-isolated');

        return await body({ db: conn.db as Kysely<NoormDatabase>, untypedDb: conn.db, connection });

    }
    finally {

        try {

            if (conn) await conn.destroy();

        }
        finally {

            try {

                if (created) await sql`DROP DATABASE ${sql.id(name)}`.execute(admin.db);

            }
            finally {

                await admin.destroy();

            }

        }

    }

}
