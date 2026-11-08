/**
 * Connection configuration types.
 *
 * Defines the shape of database connection configs that work with Kysely.
 * Each dialect has specific requirements.
 */
import type { Kysely } from 'kysely';
import type { PeerCertificate } from 'node:tls';

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
        /** PostgreSQL idle pool timeout in milliseconds; zero disables it. */
        idleTimeoutMillis?: number;
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

    /** PostgreSQL server-side statement timeout in milliseconds; zero disables it. */
    statementTimeoutMs?: number;
    /** PostgreSQL client-side query timeout in milliseconds; zero disables it. */
    queryTimeoutMs?: number;
    /** PostgreSQL session application_name. */
    applicationName?: string;
    /** Enable TCP keepalive on PostgreSQL sockets. */
    keepAlive?: boolean;

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
     * PostgreSQL verifies this identity even if the dial host differs.
     * For an IP dial host it also becomes SNI. pg uses the dial host as SNI
     * for DNS dial hosts. MSSQL uses it as the certificate hostname.
     */
    tlsServerName?: string;
}

/** Runtime-only credentials and TLS hooks; never part of persisted configuration. */
export interface RuntimeConnectionOptions {
    password?: () => string | Promise<string>;
    checkServerIdentity?: (hostname: string, cert: PeerCertificate) => Error | undefined;
}

/**
 * Result of creating a connection.
 */
export interface ConnectionResult {
    db: Kysely<unknown>;
    dialect: Dialect;
    destroy: () => Promise<void>;
}
