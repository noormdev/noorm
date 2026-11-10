/**
 * Pool, keepalive, and driver option rules.
 *
 * One source for the config schema and the dialect adapters, so an option a
 * dialect cannot honor fails the same way whether the config was stored, read
 * from the environment, or passed inline.
 */
import { connectTimeoutFor } from './defaults.js';
import type { ConnectionConfig, Dialect, PgPoolOpts, RuntimeConnectionOptions, TarnPoolOpts } from './types.js';

type PooledDialect = Exclude<Dialect, 'sqlite'>;

/**
 * A connection option the dialect cannot honor, located for a schema issue.
 */
export interface OptionProblem {
    path: string[];
    message: string;
}

const SHARED_POOL_KEYS = ['min', 'max', 'idleTimeoutMs', 'idleTimeoutMillis'];
const TARN_POOL_KEYS = [...SHARED_POOL_KEYS, 'acquireTimeoutMs', 'createTimeoutMs', 'reapIntervalMs'];

const POOL_KEYS: Record<Dialect, readonly string[]> = {
    postgres: [...SHARED_POOL_KEYS, 'maxLifetimeMs', 'maxUses', 'allowExitOnIdle'],
    mysql: TARN_POOL_KEYS,
    mssql: TARN_POOL_KEYS,
    // Unused on SQLite, but its configs carry them: resolution defaults `min`
    // and `max` for every dialect, and the alias predates per-dialect rules.
    sqlite: ['min', 'max', 'idleTimeoutMillis'],
};

const KNOWN_POOL_KEYS = [...new Set(Object.values(POOL_KEYS).flat())];

const TARN_DEFAULT_TIMEOUT_MS = 30_000;

/** Milliseconds Tarn waits beyond the driver's connect timeout, so the driver's own error is the one reported. */
const TARN_TIMEOUT_MARGIN_MS = 5_000;

const KEEPALIVE_DELAY_UNSUPPORTED: Partial<Record<Dialect, string>> = {
    mssql: 'tedious fixes the delay at 30 seconds',
    sqlite: 'SQLite has no socket',
};

// A trusted test config grants admin-level access to the target noorm
// resolved. Driver options must not point the connection elsewhere, change
// who logs in, or weaken the TLS noorm configured.
// `__proto__` as an own key (what `JSON.parse` produces) becomes the options'
// prototype inside pg-pool's `Object.assign`, where every key above it hides.
const REJECTED_DRIVER_KEYS = ['__proto__', 'host', 'port', 'database', 'user', 'password', 'connectionString', 'ssl'];

const REJECTED_DRIVER_KEYS_BY_DIALECT: Record<PooledDialect, readonly string[]> = {
    postgres: [...REJECTED_DRIVER_KEYS, 'Client', 'stream', 'connection'],
    mysql: [
        ...REJECTED_DRIVER_KEYS,
        'uri',
        'socketPath',
        'stream',
        'password1',
        'password2',
        'password3',
        'passwordSha1',
        'authPlugins',
        'authSwitchHandler',
        // `-CONNECT_WITH_DB` logs in without selecting the database.
        'flags',
        // Skips the client handshake, and with it the login.
        'isServer',
    ],
    mssql: [
        ...REJECTED_DRIVER_KEYS,
        'server',
        'authentication',
        'instanceName',
        'connector',
        'serverName',
        'encrypt',
        'trustServerCertificate',
        'cryptoCredentialsDetails',
        'fallbackToDefaultDb',
    ],
};

function idleTimeoutMs(pool: PgPoolOpts & TarnPoolOpts): number | undefined {

    return pool.idleTimeoutMs ?? pool.idleTimeoutMillis;

}

/**
 * Word the rejection of a pool key noorm does not know.
 *
 * Names the camelCase spelling when only the case differs, which is what an
 * all-caps environment variable segment turns into.
 *
 * @example
 * unknownPoolKeyMessage('maxuses') // => 'pool.maxuses is not a pool option; write it as pool.maxUses. ...'
 */
export function unknownPoolKeyMessage(key: string): string {

    const intended = KNOWN_POOL_KEYS.find((known) => known.toLowerCase() === key.toLowerCase());

    if (!intended) return `pool.${key} is not a pool option`;

    return `pool.${key} is not a pool option; write it as pool.${intended}. `
        + `An all-caps environment variable segment is lowercased, so name it NOORM_CONNECTION_POOL_${intended}`;

}

function poolProblems(dialect: Dialect | undefined, pool: PgPoolOpts & TarnPoolOpts): OptionProblem[] {

    const problems: OptionProblem[] = [];
    const { idleTimeoutMs: idle, idleTimeoutMillis: alias, min, max } = pool;
    const supported = dialect ? POOL_KEYS[dialect] : KNOWN_POOL_KEYS;

    if (idle !== undefined && alias !== undefined && idle !== alias) {

        problems.push({
            path: ['pool', 'idleTimeoutMs'],
            message: `pool.idleTimeoutMs (${idle}) and its alias pool.idleTimeoutMillis (${alias}) differ; set only pool.idleTimeoutMs`,
        });

    }

    for (const [key, value] of Object.entries(pool)) {

        if (value === undefined || supported.includes(key)) continue;

        problems.push({
            path: ['pool', key],
            message: KNOWN_POOL_KEYS.includes(key) ? `pool.${key} is not supported on ${dialect}` : unknownPoolKeyMessage(key),
        });

    }

    if (dialect !== 'sqlite' && min !== undefined && max !== undefined && min > max) {

        problems.push({ path: ['pool', 'min'], message: `pool.min (${min}) must not be greater than pool.max (${max})` });

    }

    if ((dialect === 'mysql' || dialect === 'mssql') && idleTimeoutMs(pool) === 0) {

        problems.push({
            path: ['pool', 'idleTimeoutMs'],
            message: `pool.idleTimeoutMs must be greater than zero on ${dialect}: its pool cannot disable the idle timeout`,
        });

    }

    return problems;

}

/**
 * List the pool and keepalive options a connection's dialect cannot honor.
 *
 * Without a dialect (a partial update) only the dialect-independent rules run.
 *
 * @example
 * connectionOptionProblems({ dialect: 'mysql', pool: { maxUses: 1 } })
 * // => [{ path: ['pool', 'maxUses'], message: 'pool.maxUses is not supported on mysql' }]
 */
export function connectionOptionProblems(
    connection: Pick<Partial<ConnectionConfig>, 'dialect' | 'pool' | 'keepAliveInitialDelayMs'>,
): OptionProblem[] {

    const { dialect, pool, keepAliveInitialDelayMs } = connection;
    const problems = pool ? poolProblems(dialect, pool) : [];
    const noKeepAliveDelay = dialect && KEEPALIVE_DELAY_UNSUPPORTED[dialect];

    if (keepAliveInitialDelayMs !== undefined && noKeepAliveDelay) {

        problems.push({
            path: ['keepAliveInitialDelayMs'],
            message: `keepAliveInitialDelayMs is not supported on ${dialect}: ${noKeepAliveDelay}`,
        });

    }

    return problems;

}

/**
 * Throw on the first option the dialect cannot honor.
 *
 * Adapters call this because a config can reach them without passing the
 * schema, and a silently ignored pool option looks like a working one.
 *
 * @example
 * assertConnectionOptions(config);
 * const pool = new Pool(pgPoolOptions(config.pool));
 */
export function assertConnectionOptions(config: ConnectionConfig): void {

    const [problem] = connectionOptionProblems(config);

    if (problem) throw new Error(problem.message);

}

/**
 * Translate noorm's PostgreSQL pool options to pg-pool's names and units.
 *
 * @example
 * pgPoolOptions({ maxLifetimeMs: 60_000 }) // => { maxLifetimeSeconds: 60, ... }
 */
export function pgPoolOptions(pool: PgPoolOpts = {}) {

    return {
        idleTimeoutMillis: idleTimeoutMs(pool),
        maxLifetimeSeconds: pool.maxLifetimeMs === undefined ? undefined : pool.maxLifetimeMs / 1000,
        maxUses: pool.maxUses,
        allowExitOnIdle: pool.allowExitOnIdle,
    };

}

/**
 * Build the Tarn pool options for MySQL and MSSQL.
 *
 * Tarn abandons a create or a checkout after 30 seconds by default, so both
 * are raised past a longer connect timeout unless the config sets them.
 *
 * @example
 * tarnPoolOptions({ pool: { acquireTimeoutMs: 5_000 } }) // => { acquireTimeoutMillis: 5000, ... }
 */
export function tarnPoolOptions(config: { pool?: TarnPoolOpts; connectTimeoutMs?: number }) {

    const { pool = {} } = config;
    const loginTimeout = Math.max(TARN_DEFAULT_TIMEOUT_MS, connectTimeoutFor(config) + TARN_TIMEOUT_MARGIN_MS);

    return {
        min: pool.min ?? 0,
        max: pool.max ?? 10,
        propagateCreateError: true,
        idleTimeoutMillis: idleTimeoutMs(pool),
        acquireTimeoutMillis: pool.acquireTimeoutMs ?? loginTimeout,
        createTimeoutMillis: pool.createTimeoutMs ?? loginTimeout,
        reapIntervalMillis: pool.reapIntervalMs,
    };

}

/**
 * Return a copy of the caller's driver options once none of them selects the
 * target, credentials, or TLS.
 *
 * Only own enumerable keys are checked and copied. Inherited ones are not
 * forwarded, so a prototype cannot carry a key past the check.
 *
 * @example
 * new Pool({ ...driverOptionsFor('postgres', runtime), host, port, ssl });
 */
export function driverOptionsFor(dialect: PooledDialect, runtime: RuntimeConnectionOptions | undefined): Record<string, unknown> {

    const driver = Object.entries(runtime?.driver ?? {});
    const rejected = REJECTED_DRIVER_KEYS_BY_DIALECT[dialect].find((key) => driver.some(([own]) => own === key));

    if (rejected) {

        throw new Error(
            `driver.${rejected} is not allowed on ${dialect}: `
            + 'the connection target, credentials, and TLS come from the connection config',
        );

    }

    return Object.fromEntries(driver);

}
