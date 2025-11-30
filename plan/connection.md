# Connection Management


## Overview

The connection module creates Kysely instances from config objects. It's a thin wrapper that:

- Maps config to Kysely dialect
- Manages connection pooling
- Provides a consistent interface regardless of database


## Dependencies

```json
{
    "kysely": "^0.27.0",
    "pg": "^8.11.0",
    "mysql2": "^3.6.0",
    "better-sqlite3": "^9.2.0",
    "tedious": "^16.6.0",
    "@logosdx/observer": "^x.x.x",
    "@logosdx/utils": "^x.x.x"
}
```

Install only the driver(s) you need:

```bash
# PostgreSQL
npm install pg

# MySQL
npm install mysql2

# SQLite
npm install better-sqlite3

# SQL Server (MSSQL)
npm install tedious tarn
```


## File Structure

```
src/core/
├── connection/
│   ├── index.ts           # Public exports
│   ├── factory.ts         # Connection factory
│   ├── types.ts           # Connection interfaces
│   └── dialects/
│       ├── postgres.ts
│       ├── mysql.ts
│       ├── sqlite.ts
│       └── mssql.ts
```


## Types

```typescript
// src/core/connection/types.ts

export type Dialect = 'postgres' | 'mysql' | 'sqlite' | 'mssql';

export interface ConnectionConfig {
    dialect: Dialect;

    // Network (postgres, mysql, mssql)
    host?: string;
    port?: number;

    // Auth
    user?: string;
    password?: string;

    // Database
    database: string;

    // SQLite specific
    filename?: string;  // For sqlite, can use instead of database

    // Pool settings
    pool?: {
        min?: number;
        max?: number;
    };

    // SSL
    ssl?: boolean | {
        rejectUnauthorized?: boolean;
        ca?: string;
        cert?: string;
        key?: string;
    };
}

export interface ConnectionResult {
    db: Kysely<any>;
    dialect: Dialect;
    destroy: () => Promise<void>;
}
```


## Dialect Adapters

### PostgreSQL

```typescript
// src/core/connection/dialects/postgres.ts

import { Kysely, PostgresDialect } from 'kysely';
import { Pool } from 'pg';
import { ConnectionConfig, ConnectionResult } from '../types';

export function createPostgresConnection(config: ConnectionConfig): ConnectionResult {
    const pool = new Pool({
        host: config.host ?? 'localhost',
        port: config.port ?? 5432,
        user: config.user,
        password: config.password,
        database: config.database,
        min: config.pool?.min ?? 0,
        max: config.pool?.max ?? 10,
        ssl: config.ssl,
    });

    const db = new Kysely<any>({
        dialect: new PostgresDialect({ pool }),
    });

    return {
        db,
        dialect: 'postgres',
        destroy: () => db.destroy(),
    };
}
```

### MySQL

```typescript
// src/core/connection/dialects/mysql.ts

import { Kysely, MysqlDialect } from 'kysely';
import { createPool } from 'mysql2';
import { ConnectionConfig, ConnectionResult } from '../types';

export function createMysqlConnection(config: ConnectionConfig): ConnectionResult {
    const pool = createPool({
        host: config.host ?? 'localhost',
        port: config.port ?? 3306,
        user: config.user,
        password: config.password,
        database: config.database,
        connectionLimit: config.pool?.max ?? 10,
        ssl: config.ssl ? {} : undefined,
    });

    const db = new Kysely<any>({
        dialect: new MysqlDialect({ pool }),
    });

    return {
        db,
        dialect: 'mysql',
        destroy: () => db.destroy(),
    };
}
```

### SQLite

```typescript
// src/core/connection/dialects/sqlite.ts

import { Kysely, SqliteDialect } from 'kysely';
import Database from 'better-sqlite3';
import { ConnectionConfig, ConnectionResult } from '../types';

export function createSqliteConnection(config: ConnectionConfig): ConnectionResult {
    const filename = config.filename ?? config.database;

    const db = new Kysely<any>({
        dialect: new SqliteDialect({
            database: new Database(filename),
        }),
    });

    return {
        db,
        dialect: 'sqlite',
        destroy: () => db.destroy(),
    };
}
```

### SQL Server (MSSQL)

```typescript
// src/core/connection/dialects/mssql.ts

import { Kysely, MssqlDialect } from 'kysely';
import * as Tedious from 'tedious';
import * as Tarn from 'tarn';
import { ConnectionConfig, ConnectionResult } from '../types';

export function createMssqlConnection(config: ConnectionConfig): ConnectionResult {
    const db = new Kysely<any>({
        dialect: new MssqlDialect({
            tarn: {
                ...Tarn,
                options: {
                    min: config.pool?.min ?? 0,
                    max: config.pool?.max ?? 10,
                },
            },
            tedious: {
                ...Tedious,
                connectionFactory: () =>
                    new Tedious.Connection({
                        server: config.host ?? 'localhost',
                        authentication: {
                            type: 'default',
                            options: {
                                userName: config.user,
                                password: config.password,
                            },
                        },
                        options: {
                            port: config.port ?? 1433,
                            database: config.database,
                            trustServerCertificate: !config.ssl,
                            encrypt: !!config.ssl,
                        },
                    }),
            },
        }),
    });

    return {
        db,
        dialect: 'mssql',
        destroy: () => db.destroy(),
    };
}
```


## Connection Factory

```typescript
// src/core/connection/factory.ts

import { sql } from 'kysely';
import { retry, attempt } from '@logosdx/utils';
import { ConnectionConfig, ConnectionResult, Dialect } from './types';
import { observer } from '../observer';

// Lazy imports to avoid requiring all drivers
const dialectFactories: Record<Dialect, () => Promise<(config: ConnectionConfig) => ConnectionResult>> = {
    postgres: async () => (await import('./dialects/postgres')).createPostgresConnection,
    mysql: async () => (await import('./dialects/mysql')).createMysqlConnection,
    sqlite: async () => (await import('./dialects/sqlite')).createSqliteConnection,
    mssql: async () => (await import('./dialects/mssql')).createMssqlConnection,
};

function getInstallCommand(dialect: Dialect): string {
    const commands: Record<Dialect, string> = {
        postgres: 'npm install pg',
        mysql: 'npm install mysql2',
        sqlite: 'npm install better-sqlite3',
        mssql: 'npm install tedious tarn',
    };
    return commands[dialect];
}

/**
 * Create a database connection from config with retry logic.
 */
export async function createConnection(
    config: ConnectionConfig,
    configName: string = '__default__'
): Promise<ConnectionResult> {
    const factory = dialectFactories[config.dialect];

    if (!factory) {
        throw new Error(`Unsupported dialect: ${config.dialect}`);
    }

    const connect = retry(
        async () => {
            const [createFn, importErr] = await attempt(() => factory());

            if (importErr) {
                const message = importErr.message;
                if (message.includes('Cannot find module')) {
                    throw new Error(
                        `Missing driver for ${config.dialect}. Install it with:\n` +
                        getInstallCommand(config.dialect)
                    );
                }
                throw importErr;
            }

            const conn = createFn!(config);

            // Test connection with simple query
            await sql`SELECT 1`.execute(conn.db);

            return conn;
        },
        {
            retries: 3,
            delay: 1000,
            backoff: 2,  // 1s, 2s, 4s
            jitterFactor: 0.1,
            shouldRetry: (err) => {
                const msg = err.message.toLowerCase();
                // Don't retry auth failures
                if (msg.includes('authentication')) return false;
                if (msg.includes('password')) return false;
                if (msg.includes('missing driver')) return false;
                // Retry connection issues
                return msg.includes('econnrefused') ||
                       msg.includes('etimedout') ||
                       msg.includes('too many connections') ||
                       msg.includes('connection reset');
            }
        }
    );

    const [conn, err] = await attempt(connect);

    if (err) {
        observer.emit('connection:error', { configName, error: err.message });
        throw err;
    }

    observer.emit('connection:open', { configName, dialect: config.dialect });
    return conn!;
}

/**
 * Test a connection config without keeping the connection open.
 */
export async function testConnection(config: ConnectionConfig): Promise<{ ok: boolean; error?: string }> {
    const [conn, err] = await attempt(() => createConnection(config, '__test__'));

    if (err) {
        return { ok: false, error: err.message };
    }

    await conn!.destroy();
    return { ok: true };
}
```


## Connection Manager

Manages active connections with caching and cleanup.

```typescript
// src/core/connection/manager.ts

import { attempt } from '@logosdx/utils';
import { Config } from '../config/types';
import { createConnection, ConnectionResult } from './factory';
import { observer } from '../observer';

class ConnectionManager {
    private connections = new Map<string, ConnectionResult>();

    /**
     * Get or create a connection for a config.
     */
    async getConnection(config: Config): Promise<ConnectionResult> {
        const key = config.name;

        if (this.connections.has(key)) {
            return this.connections.get(key)!;
        }

        const conn = await createConnection(config.connection, config.name);
        this.connections.set(key, conn);
        return conn;
    }

    /**
     * Close a specific connection.
     */
    async closeConnection(configName: string): Promise<void> {
        const conn = this.connections.get(configName);
        if (conn) {
            const [, err] = await attempt(() => conn.destroy());
            this.connections.delete(configName);

            if (err) {
                observer.emit('error', { source: 'connection', error: err });
            } else {
                observer.emit('connection:close', { configName });
            }
        }
    }

    /**
     * Close all connections.
     */
    async closeAll(): Promise<void> {
        const names = Array.from(this.connections.keys());
        for (const name of names) {
            await this.closeConnection(name);
        }
    }

    /**
     * Check if a connection exists.
     */
    hasConnection(configName: string): boolean {
        return this.connections.has(configName);
    }
}

// Singleton
let instance: ConnectionManager | null = null;

export function getConnectionManager(): ConnectionManager {
    if (!instance) {
        instance = new ConnectionManager();
    }
    return instance;
}

export function resetConnectionManager(): void {
    instance?.closeAll();
    instance = null;
}
```


## Public Exports

```typescript
// src/core/connection/index.ts

export { createConnection, testConnection } from './factory';
export { getConnectionManager, resetConnectionManager } from './manager';
export * from './types';
```


## Usage Examples

### Basic Connection

```typescript
import { createConnection } from './core/connection';

const conn = await createConnection({
    dialect: 'postgres',
    host: 'localhost',
    port: 5432,
    database: 'myapp',
    user: 'postgres',
    password: 'secret',
});

// Use Kysely
const users = await conn.db
    .selectFrom('users')
    .selectAll()
    .execute();

// Cleanup
await conn.destroy();
```

### With Config Object

```typescript
import { getConnectionManager } from './core/connection';
import { getStateManager } from './core/state';

const state = await getStateManager();
const config = state.getActiveConfig();

if (config) {
    const connManager = getConnectionManager();
    const conn = await connManager.getConnection(config);

    // Execute raw SQL
    await conn.db.executeQuery(
        conn.db.raw('CREATE TABLE test (id INT)').compile(conn.db)
    );
}
```

### Test Connection

```typescript
import { testConnection } from './core/connection';

const result = await testConnection({
    dialect: 'postgres',
    host: 'localhost',
    database: 'myapp',
    user: 'postgres',
    password: 'wrong',
});

if (!result.ok) {
    console.error('Connection failed:', result.error);
}
```


## Raw SQL Execution

Since noorm doesn't abstract SQL, you'll often run raw queries:

```typescript
import { sql } from 'kysely';

// Using sql template tag
await conn.db.executeQuery(
    sql`CREATE TABLE users (
        id SERIAL PRIMARY KEY,
        email VARCHAR(255) NOT NULL
    )`.compile(conn.db)
);

// Or with raw()
await conn.db.executeQuery(
    conn.db.raw(`
        INSERT INTO users (email) VALUES ('test@example.com')
    `).compile(conn.db)
);

// Reading results
const result = await sql<{ count: number }>`
    SELECT COUNT(*) as count FROM users
`.execute(conn.db);

console.log(result.rows[0].count);
```


## Error Handling

| Error | Cause | Resolution |
|-------|-------|------------|
| `Unsupported dialect` | Unknown dialect in config | Use postgres, mysql, sqlite, or mssql |
| `Missing driver for X` | DB driver not installed | Run the suggested npm install command |
| `Connection refused` | DB not running or wrong host/port | Check database server is running |
| `Authentication failed` | Wrong credentials | Verify user/password |


## Cleanup

Always close connections when done:

```typescript
import { getConnectionManager } from './core/connection';

// At app shutdown
process.on('SIGINT', async () => {
    await getConnectionManager().closeAll();
    process.exit(0);
});

// Or in CLI command completion
async function runCommand() {
    try {
        // ... do work
    } finally {
        await getConnectionManager().closeAll();
    }
}
```


## Testing

```typescript
import { createConnection, testConnection } from './core/connection';

describe('Connection', () => {
    // Use SQLite for tests (no external DB needed)
    const testConfig = {
        dialect: 'sqlite' as const,
        database: ':memory:',
    };

    it('should create sqlite connection', async () => {
        const conn = await createConnection(testConfig);
        expect(conn.dialect).toBe('sqlite');
        await conn.destroy();
    });

    it('should execute raw SQL', async () => {
        const conn = await createConnection(testConfig);

        await conn.db.executeQuery(
            conn.db.raw('CREATE TABLE test (id INTEGER PRIMARY KEY)').compile(conn.db)
        );

        await conn.db.executeQuery(
            conn.db.raw('INSERT INTO test (id) VALUES (1)').compile(conn.db)
        );

        const result = await conn.db
            .selectFrom('test')
            .selectAll()
            .execute();

        expect(result).toHaveLength(1);
        await conn.destroy();
    });

    it('should report connection errors', async () => {
        const result = await testConnection({
            dialect: 'postgres',
            host: 'nonexistent.local',
            database: 'test',
        });

        expect(result.ok).toBe(false);
        expect(result.error).toBeDefined();
    });
});
```
