/**
 * Connection failures, worded for the user, with the server's own words kept
 * for the log.
 *
 * pg and mysql2 reject a refused port with an empty message, tedious reports
 * any socket failure as "Could not connect (sequence)", and SQLite gives one
 * message for a missing directory, an unreadable file, and an unwritable
 * directory. The codes still carry the reason.
 *
 * Some servers withhold the reason on purpose: SQL Server, PostgreSQL, and
 * MySQL each send one error for a wrong password and an unknown account, so
 * that a client cannot probe which accounts exist. For those the message says
 * so and lists the usual causes, rather than implying a wrong password.
 *
 * No message may say "does not exist" unless a database is missing: the TUI
 * offers to create a database on that phrase, and `testConnection` falls back
 * to the system database on it.
 */
import { accessSync, constants as fsConstants, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import { attemptSync } from '@logosdx/utils';

import type { ConnectionConfig } from './types.js';
import { DEFAULT_PORTS, connectTimeoutFor } from './defaults.js';

/**
 * A connection failure worded for the user.
 *
 * `serverCode` and `serverMessage` keep what the server or driver actually
 * said, so the log can show it next to the reworded message.
 *
 * @example
 * if (err instanceof DatabaseConnectionError) log(err.serverCode, err.serverMessage);
 */
export class DatabaseConnectionError extends Error {

    override readonly name = 'DatabaseConnectionError' as const;

    constructor(
        message: string,
        public readonly serverCode: string | undefined,
        public readonly serverMessage: string,
        options?: ErrorOptions,
    ) {

        super(message, options);

    }

}

/**
 * One error message a SQL Server sent during login.
 */
export interface MssqlServerError {
    number: number;
    message: string;
}

/**
 * Inputs to an `Explain`.
 */
interface Failure {
    user: string;
    database: string;
    host: string;
    where: string;
    config: ConnectionConfig;

    /** The driver's own message, for codes that cover several cases. */
    message: string;
}

type Explain = (failure: Failure) => string | undefined;

const noPassword: Explain = ({ user }) =>
    `No password was supplied for user '${user}', and the server requires one.`;

const timedOut: Explain = ({ where, config }) =>
    `${where} did not answer within ${connectTimeoutFor(config)}ms. `
    + 'Check the host and port, and that no firewall is dropping the connection.';

const SERVER_FULL = 'The server has no free connections (max_connections reached). Try again later.';

/**
 * Failures before the server had a say.
 */
const TRANSPORT_REASONS: [codes: string[], explain: Explain][] = [
    [['ECONNREFUSED'], ({ where }) =>
        `Connection refused at ${where}: nothing is listening there. `
        + 'Check the host and port, and that the server is running.'],
    [['ENOTFOUND'], ({ host }) => `Host '${host}' could not be found. Check the host name.`],
    [['EAI_AGAIN'], ({ host }) => `Host '${host}' could not be looked up: DNS did not answer. Check the network connection.`],
    [['ETIMEDOUT', 'ETIMEOUT'], timedOut],
    [['EHOSTUNREACH', 'ENETUNREACH'], ({ host }) => `${host} is unreachable from this machine: there is no network route to it.`],
    [['ECONNRESET'], ({ where }) =>
        `${where} closed the connection during the handshake. `
        + 'Check that the port belongs to this database server and that the ssl setting matches what it expects.'],
];

const TLS_CERTIFICATE_CODES = new Set([
    'DEPTH_ZERO_SELF_SIGNED_CERT',
    'SELF_SIGNED_CERT_IN_CHAIN',
    'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
    'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
    'CERT_HAS_EXPIRED',
    'CERT_NOT_YET_VALID',
    'ERR_TLS_CERT_ALTNAME_INVALID',
]);

/**
 * SQL Server login errors by number, most specific first: 4060 arrives
 * together with 18456, and 4060 is the reason.
 */
const MSSQL_REASONS: [number: number, explain: Explain][] = [
    [4060, ({ database, where }) =>
        `Cannot open database '${database}' on ${where}: it does not exist or this login has no access to it.`],
    [40615, () =>
        'The server\'s firewall does not allow this machine\'s IP address. Add it to the server\'s firewall rules.'],
    [18470, ({ user }) => `Login '${user}' is disabled. An administrator can enable it with ALTER LOGIN ... ENABLE.`],
    [18486, ({ user }) => `Login '${user}' is locked out after too many failed attempts.`],
    [18487, ({ user }) =>
        `The password for login '${user}' has expired. Change it with a SQL Server client, then update this connection.`],
    [18488, ({ user }) =>
        `The password for login '${user}' must be changed before it can log in. `
        + 'Change it with a SQL Server client, then update this connection.'],
    [18456, ({ user }) =>
        `Login failed for user '${user}'. SQL Server does not tell clients why; the usual causes are a wrong password, `
        + 'an unknown login, a login denied CONNECT SQL, or a server that only accepts Windows authentication. '
        + 'The server\'s error log names the cause.'],
];

/**
 * PostgreSQL errors by SQLSTATE.
 */
const POSTGRES_REASONS: Record<string, Explain> = {
    '28P01': ({ user }) =>
        `Password authentication failed for user '${user}'. PostgreSQL does not tell clients why; the usual causes `
        + 'are a wrong password, an unknown role, or an expired password (VALID UNTIL). The server log names the cause.',
    '28000': ({ user, database, message }) => {

        if (message.includes('is not permitted to log in')) return `Role '${user}' is not allowed to log in (NOLOGIN).`;

        if (message.includes('pg_hba.conf')) {

            return `The server's pg_hba.conf has no rule that lets user '${user}' connect to '${database}' from this machine.`;

        }

        return undefined;

    },
    '3D000': ({ database, where }) => `Database '${database}' does not exist on ${where}.`,
    '42501': ({ user, database, message }) => message.startsWith('permission denied for database')
        ? `Role '${user}' may not connect to database '${database}': it lacks the CONNECT privilege.`
        : undefined,
    '53300': ({ user, message }) => message.includes('for role')
        ? `Role '${user}' has used up its connection limit (CONNECTION LIMIT).`
        : SERVER_FULL,
    '57P03': () => 'The server is starting up or shutting down. Try again in a moment.',
};

/**
 * PostgreSQL failures pg raises itself, with no SQLSTATE.
 */
const POSTGRES_CLIENT_REASONS: [text: string, explain: Explain][] = [
    // pg raises this itself when the server asks for a SCRAM password and the
    // config has none.
    ['client password must be a string', noPassword],
    ['The server does not support SSL connections', () =>
        'The server does not accept TLS connections. Turn ssl off for this connection.'],
    ['Connection terminated due to connection timeout', timedOut],
];

/**
 * MySQL errors by mysql2 code.
 */
const MYSQL_REASONS: Record<string, Explain> = {
    ER_ACCESS_DENIED_ERROR: (failure) => failure.message.includes('(using password: NO)')
        ? noPassword(failure)
        : `Access denied for user '${failure.user}'. MySQL does not tell clients why; the usual causes are a wrong password, `
            + 'an unknown user, no account for this machine\'s host, or an account that requires TLS (REQUIRE SSL).',
    ER_DBACCESS_DENIED_ERROR: ({ user, database }) => `User '${user}' has no privileges on database '${database}'.`,
    ER_BAD_DB_ERROR: ({ database, where }) => `Database '${database}' does not exist on ${where}.`,
    ER_HOST_NOT_PRIVILEGED: () => 'The server accepts no account from this machine\'s host.',
    ER_ACCOUNT_HAS_BEEN_LOCKED: ({ user }) =>
        `Account '${user}' is locked. An administrator can unlock it with ALTER USER ... ACCOUNT UNLOCK.`,
    ER_MUST_CHANGE_PASSWORD_LOGIN: ({ user }) =>
        `The password for '${user}' has expired. Change it with a MySQL client, then update this connection.`,
    ER_CON_COUNT_ERROR: () => SERVER_FULL,
    ER_USER_LIMIT_REACHED: ({ user }) => `User '${user}' has used up its connection limit (MAX_USER_CONNECTIONS).`,
    ER_HOST_IS_BLOCKED: () =>
        'The server blocked this machine after too many connection errors. An administrator can clear its host cache.',
    ER_SECURE_TRANSPORT_REQUIRED: () => 'The server only accepts TLS connections. Turn ssl on for this connection.',
};

/**
 * Word a failed connection for the user and keep what the server said.
 *
 * An error with no code and nothing to explain comes back unchanged, so
 * noorm's own errors (an abort, a TLS misconfiguration) keep their type.
 *
 * @example
 * const [conn, err] = await attempt(() => openPool(config));
 * if (err) throw explainConnectionError(err, config);
 */
export function explainConnectionError(err: Error, config: ConnectionConfig): Error {

    if (err instanceof DatabaseConnectionError) return err;

    const codes = errorCodes(err);
    const failure = describeFailure(err, config);
    const reason = explainTransport(codes, failure) ?? explainServer(codes, failure);
    const serverMessage = serverMessages(err).join(' | ');

    if (!reason && codes.length === 0) return err;

    return new DatabaseConnectionError(
        reason ?? (err.message || serverMessage),
        codes.join(', ') || undefined,
        serverMessage,
        { cause: err },
    );

}

/**
 * Word a failed SQL Server login from the errors the MSSQL dialect recorded
 * during login.
 *
 * @example
 * throw explainMssqlLoginFailure(recordedErrors, connectErr, config);
 */
export function explainMssqlLoginFailure(
    serverErrors: readonly MssqlServerError[],
    err: Error,
    config: ConnectionConfig,
): Error {

    if (serverErrors.length === 0) return err;

    const failure = describeFailure(err, config);
    const match = MSSQL_REASONS.find(([number]) => serverErrors.some((e) => e.number === number));

    return new DatabaseConnectionError(
        match?.[1](failure) ?? err.message,
        serverErrors.map((e) => e.number).join(', '),
        serverErrors.map((e) => e.message).join(' | '),
        { cause: err },
    );

}

function describeFailure(err: Error, config: ConnectionConfig): Failure {

    const host = config.host ?? 'localhost';

    return {
        user: config.user ?? '',
        database: config.database,
        host,
        where: `${host}:${config.port ?? DEFAULT_PORTS[config.dialect]}`,
        config,
        message: err.message,
    };

}

/**
 * Walk the error and what it wraps: tedious puts the socket error in `cause`,
 * and a dual-stack refusal arrives as an AggregateError holding one error per
 * address tried.
 */
function walk(err: unknown, visit: (error: object) => void, seen = new Set<unknown>()): void {

    if (typeof err !== 'object' || err === null || seen.has(err)) return;

    const inner: unknown = Reflect.get(err, 'errors');

    seen.add(err);
    visit(err);
    walk(Reflect.get(err, 'cause'), visit, seen);

    if (Array.isArray(inner)) {

        for (const each of inner) walk(each, visit, seen);

    }

}

function errorCodes(err: unknown): string[] {

    const codes = new Set<string>();

    walk(err, (error) => {

        const code: unknown = Reflect.get(error, 'code');

        if (typeof code === 'string') codes.add(code);

    });

    return [...codes];

}

function serverMessages(err: unknown): string[] {

    const messages = new Set<string>();

    walk(err, (error) => {

        const message: unknown = Reflect.get(error, 'message');

        if (typeof message === 'string' && message) messages.add(message);

    });

    return [...messages];

}

function explainTransport(codes: string[], failure: Failure): string | undefined {

    const transport = TRANSPORT_REASONS.find(([matches]) => matches.some((code) => codes.includes(code)));

    if (transport) return transport[1](failure);

    const certificateCode = codes.find((code) => TLS_CERTIFICATE_CODES.has(code));

    if (!certificateCode) return undefined;

    // MSSQL encrypts either way; `ssl` only decides whether the certificate
    // is validated. For the others it turns TLS on or off.
    const withoutValidation = failure.config.dialect === 'mssql'
        ? 'turn ssl off to keep encryption without validating the certificate'
        : 'turn ssl off, which also turns off encryption';

    return `The server's TLS certificate was rejected (${certificateCode}). `
        + `Trust the authority that issued it on this machine, or ${withoutValidation}.`;

}

function explainServer(codes: string[], failure: Failure): string | undefined {

    const code = codes[0] ?? '';

    switch (failure.config.dialect) {

    case 'postgres': {

        const client = POSTGRES_CLIENT_REASONS.find(([text]) => failure.message.includes(text));

        return POSTGRES_REASONS[code]?.(failure) ?? client?.[1](failure);

    }

    case 'mysql':
        return MYSQL_REASONS[code]?.(failure);

    case 'sqlite':
        return explainSqlite(code, failure);

    default:
        return undefined;

    }

}

/**
 * SQLite reports every unopenable file as SQLITE_CANTOPEN; the filesystem
 * says which of the three it is.
 */
function explainSqlite(code: string, failure: Failure): string | undefined {

    const file = resolve(failure.config.filename ?? failure.database);
    const dir = dirname(file);

    if (code === 'SQLITE_NOTADB') {

        return `'${file}' is not a SQLite database, or it is encrypted.`;

    }

    if (code !== 'SQLITE_CANTOPEN') return undefined;

    if (!existsSync(dir)) {

        return `Cannot open SQLite database '${file}': directory '${dir}' is missing.`;

    }

    if (existsSync(file) && !canAccess(file, fsConstants.R_OK | fsConstants.W_OK)) {

        return `Cannot open SQLite database '${file}': this process lacks read or write permission on the file.`;

    }

    if (!existsSync(file) && !canAccess(dir, fsConstants.W_OK)) {

        return `Cannot create SQLite database '${file}': this process lacks write permission on '${dir}'.`;

    }

    return undefined;

}

function canAccess(path: string, mode: number): boolean {

    const [, err] = attemptSync(() => accessSync(path, mode));

    return !err;

}
