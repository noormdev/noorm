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

    /**
     * Milliseconds a single connection attempt may spend before the driver
     * gives up. Defaults to `DEFAULT_CONNECT_TIMEOUT_MS`.
     *
     * Raise it for a link that is slow but working — a serverless database
     * resuming from auto-pause is the case that motivates it, since the resume
     * can outlast any timeout tuned for a handshake.
     */
    connectTimeoutMs?: number;

    // SSL
    ssl?:
        | boolean
        | {
              rejectUnauthorized?: boolean;
              ca?: string;
              cert?: string;
              key?: string;
          };

    /**
     * Hostname the server's TLS certificate is issued for (its CN or a DNS
     * entry in the Subject Alternative Name).
     *
     * Only needed when `host` is an IP address: TLS carries the requested
     * hostname in the SNI extension, which RFC 6066 forbids from being an IP
     * literal, so the certificate has no name to be checked against. MSSQL is
     * the only dialect that reads this today.
     */
    tlsServerName?: string;
}

/**
 * Result of creating a connection.
 */
export interface ConnectionResult {
    db: Kysely<unknown>;
    dialect: Dialect;
    destroy: () => Promise<void>;
}
