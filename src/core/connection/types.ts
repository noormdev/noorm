/**
 * Connection configuration types.
 *
 * Defines the shape of database connection configs that work with Kysely.
 * Each dialect has specific requirements.
 */
import type { Kysely } from 'kysely';

/**
 * Supported database dialects.
 */
export type Dialect = 'postgres' | 'mysql' | 'sqlite' | 'mssql';

/**
 * Database connection configuration.
 *
 * @example
 * ```typescript
 * const postgresConfig: ConnectionConfig = {
 *     dialect: 'postgres',
 *     host: 'localhost',
 *     port: 5432,
 *     database: 'myapp',
 *     user: 'postgres',
 *     password: 'secret',
 * }
 *
 * const sqliteConfig: ConnectionConfig = {
 *     dialect: 'sqlite',
 *     database: './data.db',
 * }
 * ```
 */
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

    // SQLite specific - can use instead of database
    filename?: string;

    // Pool settings
    pool?: {
        min?: number;
        max?: number;
    };

    // SSL
    ssl?:
        | boolean
        | {
              rejectUnauthorized?: boolean;
              ca?: string;
              cert?: string;
              key?: string;
          };
}

/**
 * Result of creating a connection.
 */
export interface ConnectionResult {
    db: Kysely<unknown>;
    dialect: Dialect;
    destroy: () => Promise<void>;
}
