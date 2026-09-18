/**
 * SQL Server (MSSQL) dialect adapter.
 *
 * Uses 'tedious' and 'tarn' packages for MSSQL connections.
 * Install with: npm install tedious tarn
 *
 * Connects straight to the target database, so a login needs no access to
 * `master` or to other databases' rows in `sys.databases`.
 */
import { isIP } from 'node:net';

import { attempt } from '@logosdx/utils';
import { Kysely, MssqlDialect, sql } from 'kysely';
import type { ConnectionConfiguration } from 'tedious';

import type { ConnectionConfig, ConnectionResult } from '../types.js';
import { DEFAULT_PORTS, connectTimeoutFor } from '../defaults.js';
import { explainMssqlLoginFailure } from '../errors.js';
import type { MssqlServerError } from '../errors.js';
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
 * Kept separate from the pool so the TLS and timeout choices can be asserted
 * without a server.
 *
 * @example
 * const options = buildTediousOptions(config);
 */
export function buildTediousOptions(config: ConnectionConfig): ConnectionConfiguration {

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
            database: config.database,
            trustServerCertificate: !config.ssl,
            encrypt: true,
            serverName: resolveTlsServerName(config),
            // Matches tedious's own default, so mssql keeps the behaviour it
            // had while becoming overridable alongside the other dialects.
            // `requestTimeout` is deliberately left alone: a long-running
            // query is legitimate, and Escape is the answer for that, not a
            // deadline nobody asked for.
            connectTimeout: connectTimeoutFor(config),
        },
    };

}

/**
 * Instantiate a tedious Connection that records every error the server sends
 * while logging in. tedious keeps only the last one, which for a missing
 * database or a withheld reason is the generic 18456 "Login failed".
 */
function buildTediousConnection(
    Tedious: typeof import('tedious'),
    config: ConnectionConfig,
    loginErrors: MssqlServerError[],
) {

    const connection = new Tedious.Connection(buildTediousOptions(config));
    const record = (token: MssqlServerError) => loginErrors.push({ number: token.number, message: token.message });

    // Pooled connections live on, and their query errors are not login errors.
    connection.on('errorMessage', record);
    connection.once('connect', () => connection.removeListener('errorMessage', record));

    return connection;

}

/**
 * Create a SQL Server connection.
 *
 * Runs a first query before returning, so a failed login is reported here with
 * the error numbers the server sent. They name a missing database, a login
 * without access to it, or the causes a plain 18456 can stand for.
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
    let loginErrors: MssqlServerError[] = [];

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
                connectionFactory: () => {

                    loginErrors = [];

                    return buildTediousConnection(Tedious, config, loginErrors);

                },
            },
        }),
        plugins: [new MssqlLimitPlugin()],
    });

    const [, connectErr] = await attempt(() => sql`SELECT 1`.execute(db));

    if (connectErr) {

        await db.destroy();

        throw explainMssqlLoginFailure(loginErrors, connectErr, config);

    }

    return {
        db,
        dialect: 'mssql',
        destroy: () => db.destroy(),
    };

}
