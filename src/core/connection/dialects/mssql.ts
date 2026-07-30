/**
 * SQL Server (MSSQL) dialect adapter.
 *
 * Uses 'tedious' and 'tarn' packages for MSSQL connections.
 * Install with: npm install tedious tarn
 *
 * Verifies database existence via sys.databases before connecting
 * to the target database, avoiding cryptic ECONNRESET errors when
 * the database doesn't exist.
 */
import { isIP } from 'node:net';

import { Kysely, MssqlDialect, sql } from 'kysely';
import type { ConnectionConfiguration } from 'tedious';

import type { ConnectionConfig, ConnectionResult } from '../types.js';
import { DEFAULT_PORTS } from '../defaults.js';
import { MssqlLimitPlugin } from './mssql-limit-plugin.js';

/**
 * SNI ServerName presented when connecting to an MSSQL host by IP address
 * without certificate validation.
 *
 * TLS carries the requested hostname in the SNI extension, which RFC 6066
 * forbids from being an IP literal — Node's `tls.connect` enforces that. On
 * the PRELOGIN handshake that `encrypt: true` uses, tedious 19.2.1 passes
 * `config.server` straight through to `tls.connect({ servername })` with no
 * guard (`lib/connection.js:2248` -> `lib/message-io.js:53`), so an IP host
 * fails the connection outright. Its TDS 8.0 path is guarded
 * (`lib/connection.js:1200`) but is not a general substitute.
 *
 * Substituting a name is safe *only* on the `trustServerCertificate: true`
 * branch: nothing compares the presented name against the certificate, so the
 * value is inert and encryption stays on. Under certificate validation the
 * same substitution would quietly defeat hostname verification, which is why
 * `resolveTlsServerName` throws there instead of falling back to this.
 *
 * `.invalid` is reserved by RFC 2606 and can never resolve to a real host, so
 * the placeholder cannot collide with a certificate anyone could obtain.
 */
export const UNVERIFIED_TLS_SERVER_NAME = 'noorm-unverified.invalid';

/**
 * Raised when no usable TLS ServerName can be derived for an MSSQL connection.
 *
 * Carries the offending host so callers can name it back to the user; the
 * message names `tlsServerName` because supplying it is the only fix that
 * keeps certificate validation on.
 *
 * @example
 * throw new MssqlTlsServerNameError('10.0.0.5', 'Cannot validate ...');
 */
export class MssqlTlsServerNameError extends Error {

    override readonly name = 'MssqlTlsServerNameError' as const;

    constructor(public readonly host: string, message: string) {

        super(message);

    }

}

/**
 * Resolve the TLS ServerName (SNI) tedious should present, if any.
 *
 * Returns `undefined` for hostname connections so tedious keeps deriving the
 * name from `server` itself — that path already works and is the common case.
 *
 * @example
 * resolveTlsServerName({ dialect: 'mssql', host: '10.0.0.5', database: 'app' })
 * // => 'noorm-unverified.invalid'
 */
export function resolveTlsServerName(config: ConnectionConfig): string | undefined {

    const host = config.host ?? 'localhost';
    const supplied = config.tlsServerName;
    const validatingCertificate = !!config.ssl;

    if (supplied && isIP(supplied) !== 0) {

        throw new MssqlTlsServerNameError(
            host,
            `Invalid tlsServerName '${supplied}': a TLS ServerName must be a hostname, not an IP address. ` +
            'Set it to the hostname the server\'s certificate is issued for.',
        );

    }

    if (supplied) {

        return supplied;

    }

    if (isIP(host) === 0) {

        return undefined;

    }

    if (validatingCertificate) {

        throw new MssqlTlsServerNameError(
            host,
            `Cannot verify the TLS certificate of MSSQL host '${host}': a certificate cannot be validated ` +
            'against an IP address, because TLS forbids sending one as the ServerName. ' +
            'Set connection.tlsServerName to the hostname the server\'s certificate is issued for, ' +
            'or connect using that hostname instead.',
        );

    }

    return UNVERIFIED_TLS_SERVER_NAME;

}

/**
 * Build tedious connection options from noorm config.
 *
 * Centralizes the tedious config so both the preflight check
 * and the real pool use the same settings.
 *
 * @example
 * const options = buildTediousOptions(config, 'master');
 */
export function buildTediousOptions(
    config: ConnectionConfig,
    database?: string,
): ConnectionConfiguration {

    return {
        server: config.host ?? 'localhost',
        authentication: {
            type: 'default',
            options: {
                userName: config.user,
                password: config.password,
            },
        },
        options: {
            port: config.port ?? DEFAULT_PORTS.mssql,
            database: database ?? config.database,
            trustServerCertificate: !config.ssl,
            encrypt: true,
            serverName: resolveTlsServerName(config),
        },
    };

}

/**
 * Instantiate a tedious Connection for the given noorm config.
 */
function buildTediousConfig(
    Tedious: typeof import('tedious'),
    config: ConnectionConfig,
    database?: string,
) {

    return new Tedious.Connection(buildTediousOptions(config, database));

}

/**
 * Verify the target database exists by querying sys.databases on master.
 *
 * Connects to 'master' first and checks sys.databases. Throws a clear
 * error if the database is missing, instead of letting tedious hang
 * with a cryptic ECONNRESET.
 */
async function verifyDatabaseExists(
    Tedious: typeof import('tedious'),
    Tarn: typeof import('tarn'),
    config: ConnectionConfig,
): Promise<void> {

    const masterDb = new Kysely<unknown>({
        dialect: new MssqlDialect({
            tarn: {
                ...Tarn,
                options: {
                    min: 0,
                    max: 1,
                    propagateCreateError: true,
                },
            },
            tedious: {
                ...Tedious,
                connectionFactory: () => buildTediousConfig(Tedious, config, 'master'),
            },
        }),
        plugins: [new MssqlLimitPlugin()],
    });

    try {

        const { rows } = await sql<{ name: string }>`
            SELECT name FROM sys.databases WHERE name = ${config.database}
        `.execute(masterDb);

        if (rows.length === 0) {

            throw new Error(
                `Database '${config.database}' does not exist on ${config.host ?? 'localhost'}:${config.port ?? DEFAULT_PORTS.mssql}`,
            );

        }

    }
    finally {

        await masterDb.destroy();

    }

}

/**
 * Create a SQL Server connection.
 *
 * Verifies the target database exists via master before opening
 * the connection pool. This avoids the tedious/tarn hang that
 * occurs when MSSQL rejects login for a non-existent database.
 *
 * @example
 * ```typescript
 * const conn = createMssqlConnection({
 *     dialect: 'mssql',
 *     host: 'localhost',
 *     database: 'myapp',
 *     user: 'sa',
 *     password: 'secret',
 * })
 * ```
 */
export async function createMssqlConnection(config: ConnectionConfig): Promise<ConnectionResult> {

    // Dynamic import to avoid compile-time dependency. Normalize CJS interop:
    // when bundled (tsup), the module's exports land under `.default`, so a
    // bare `Tarn.Pool` is undefined and kysely throws "Pool is not a
    // constructor". Mirror the postgres dialect's `pkg.default ?? pkg` guard.
    const TediousImport = await import('tedious');
    const TarnImport = await import('tarn');
    const Tedious = TediousImport.default ?? TediousImport;
    const Tarn = TarnImport.default ?? TarnImport;

    // Preflight: verify database exists via master
    await verifyDatabaseExists(Tedious, Tarn, config);

    const db = new Kysely<unknown>({
        dialect: new MssqlDialect({
            tarn: {
                ...Tarn,
                options: {
                    min: config.pool?.min ?? 0,
                    max: config.pool?.max ?? 10,
                    propagateCreateError: true,
                },
            },
            tedious: {
                ...Tedious,
                connectionFactory: () => buildTediousConfig(Tedious, config),
            },
        }),
        plugins: [new MssqlLimitPlugin()],
    });

    return {
        db,
        dialect: 'mssql',
        destroy: () => db.destroy(),
    };

}
