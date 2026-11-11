/**
 * Connection configuration types.
 *
 * Defines the shape of database connection configs that work with Kysely.
 * Each dialect has specific requirements.
 */
import type { Kysely } from 'kysely';
import type { PeerCertificate } from 'node:tls';

/** Each `ssl` certificate field as its inline form and its file form: `[inline, file]`. */
export const SSL_FIELD_PAIRS = [
    ['ca', 'caFile'],
    ['cert', 'certFile'],
    ['key', 'keyFile'],
] as const;

/**
 * Supported database dialects.
 */
export type Dialect = 'postgres' | 'mysql' | 'sqlite' | 'mssql';

/** Pool options every pooled dialect honors. */
export interface PoolOpts {
    min?: number;
    max?: number;
    /**
     * Milliseconds a connection may sit idle before the pool closes it. Zero
     * disables the timeout on PostgreSQL; MySQL and MSSQL require a positive value.
     */
    idleTimeoutMs?: number;
    /** @deprecated Alias of `idleTimeoutMs`. Setting both to different values is an error. */
    idleTimeoutMillis?: number;
}

export interface PgPoolOpts extends PoolOpts {
    /** Milliseconds a connection may live before the pool replaces it. */
    maxLifetimeMs?: number;
    /** Checkouts after which the pool replaces a connection. */
    maxUses?: number;
    /** Let the process exit while only idle connections remain. */
    allowExitOnIdle?: boolean;
}

/** Options of the Tarn pool behind MySQL and MSSQL. */
export interface TarnPoolOpts extends PoolOpts {
    /** Milliseconds a checkout may wait for a free connection. */
    acquireTimeoutMs?: number;
    /** Milliseconds opening one physical connection may take. */
    createTimeoutMs?: number;
    /** Milliseconds between sweeps that close idle connections. */
    reapIntervalMs?: number;
}

export type MssqlPoolOpts = TarnPoolOpts;
export type MysqlPoolOpts = TarnPoolOpts;

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

    /** Each dialect rejects the options it cannot honor; `DialectConnectionConfig` types this per dialect. */
    pool?: PgPoolOpts & TarnPoolOpts;

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
    /** TCP keepalive on PostgreSQL and MySQL sockets; `false` turns it off, including MySQL's default. */
    keepAlive?: boolean;
    /**
     * Milliseconds a PostgreSQL or MySQL socket stays idle before the first
     * TCP keepalive probe. Implies `keepAlive` unless that is `false`.
     *
     * Without it the first probe waits for the operating system default,
     * about two hours, so a socket left half-open by a failover is found
     * hours late.
     */
    keepAliveInitialDelayMs?: number;

    // SSL
    ssl?:
        | boolean
        | {
              rejectUnauthorized?: boolean;
              ca?: string;
              cert?: string;
              key?: string;
              /** Path to the CA PEM, read each time a pool opens, on every connect attempt. Exclusive with `ca`. */
              caFile?: string;
              /** Path to the client certificate PEM. Exclusive with `cert`. */
              certFile?: string;
              /** Path to the client key PEM. Exclusive with `key`. */
              keyFile?: string;
          };

    /**
     * Hostname the server's TLS certificate is issued for (its CN or a DNS
     * entry in the Subject Alternative Name).
     *
     * PostgreSQL, MySQL and MSSQL verify this identity even if the dial host
     * differs. For an IP dial host on PostgreSQL it also becomes SNI. pg uses
     * the dial host as SNI for DNS dial hosts. MSSQL uses it as the
     * certificate hostname.
     */
    tlsServerName?: string;
}

/**
 * A `ConnectionConfig` whose `pool` is typed for its dialect, so an option the
 * dialect cannot honor is a compile error instead of a validation error.
 *
 * @example
 * ```typescript
 * const config: DialectConnectionConfig = {
 *     dialect: 'postgres',
 *     host: 'localhost',
 *     database: 'myapp',
 *     pool: { max: 20, maxUses: 5_000 },
 * }
 * ```
 */
export type DialectConnectionConfig =
    | PostgresConnectionConfig
    | MysqlConnectionConfig
    | MssqlConnectionConfig
    | SqliteConnectionConfig;

type ForDialect<D extends Dialect, Pool> = Omit<ConnectionConfig, 'dialect' | 'pool'> & { dialect: D; pool?: Pool };

export type PostgresConnectionConfig = ForDialect<'postgres', PgPoolOpts>;
export type MysqlConnectionConfig = ForDialect<'mysql', MysqlPoolOpts>;
export type MssqlConnectionConfig = ForDialect<'mssql', MssqlPoolOpts>;
/** SQLite has no pool; the size is accepted because resolved configs carry it for every dialect. */
export type SqliteConnectionConfig = ForDialect<'sqlite', Pick<PoolOpts, 'min' | 'max'>>;

/** Runtime-only credentials, TLS hooks, and driver options; never part of persisted configuration. */
export interface RuntimeConnectionOptions {
    password?: () => string | Promise<string>;
    checkServerIdentity?: (hostname: string, cert: PeerCertificate) => Error | undefined;
    /**
     * Options merged into what noorm hands the driver: the `pg` Pool config,
     * the mysql2 connection options, or the tedious `options` block. They
     * override flat config fields and `pool`. Keys that select the target,
     * credentials, or TLS are rejected; SQLite accepts none.
     */
    driver?: Record<string, unknown>;
}

/**
 * The one connection a `withConnection` callback is pinned to.
 *
 * @example
 * ```typescript
 * await ctx.withConnection(async (db, connection) => {
 *     const [, err] = await attempt(() => doWork(db));
 *     if (err) connection.discard();
 * })
 * ```
 */
export interface PinnedConnection {
    /** Close this connection when the callback ends instead of returning it to the pool. Does nothing on SQLite. */
    discard(): void;
}

/**
 * Result of creating a connection.
 */
export interface ConnectionResult {
    db: Kysely<unknown>;
    dialect: Dialect;
    destroy: () => Promise<void>;
    /** Run `fn` on one pinned connection it may discard. Absent on SQLite, which has no pool. */
    withConnection?: <T>(fn: (db: Kysely<unknown>, connection: PinnedConnection) => Promise<T>) => Promise<T>;
}
