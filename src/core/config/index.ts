import { makeNestedConfig } from '@logosdx/utils';
import type { ConfigInput } from './types.js';
import { DialectSchema } from './schema.js';


/**
 * Meta env vars that control CLI behavior, not config values.
 * These are excluded from makeNestedConfig processing.
 */
const META_ENV_VARS = new Set([
    'NOORM_CONFIG', // Config selection
    'NOORM_YES', // Skip confirmations
    'NOORM_JSON', // JSON output mode
    'NOORM_HEADLESS', // Headless mode detection
    'NOORM_DEBUG', // Debug logging
    'NOORM_DEV', // Dev mode detection
    'NOORM_CI_CONFIG_NAME', // ci init config name override
    'NOORM_LOGGER_DEBUG', // Logger-internal debug
    'NOORM_CHANNEL', // Policy channel override (resolveChannel)
]);

/**
 * Env-var prefixes that belong to non-config subsystems.
 *
 * NOORM_IDENTITY_* is consumed by `loadIdentityFromEnv` (src/core/identity/env.ts),
 * not by config resolution. If forwarded through makeNestedConfig, the keys collide
 * with `identity: z.string()` in ConfigSchema (object vs string) and break parseConfig.
 */
const NON_CONFIG_ENV_PREFIXES = [
    'NOORM_IDENTITY_',
];

const VALID_DIALECTS = ['postgres', 'mysql', 'sqlite', 'mssql'] as const;

export const { allConfigs, getConfig } = makeNestedConfig<ConfigInput>(process.env as Record<string, string>, {
    filter: (key) =>
        key.startsWith('NOORM_')
        && !META_ENV_VARS.has(key)
        && !key.startsWith('NOORM_CONNECTION_')
        && !NON_CONFIG_ENV_PREFIXES.some((prefix) => key.startsWith(prefix)),
    stripPrefix: 'NOORM_',
    forceAllCapToLower: true,
    memoizeOpts: false,
    skipConversion: (key) => key.toLowerCase().includes('password'),
});

/**
 * Read config values from environment variables.
 *
 * Uses makeNestedConfig to automatically transform NOORM_* env vars
 * into a nested ConfigInput object. The underscore separator maps
 * directly to object nesting.
 *
 * @example
 * ```typescript
 * // With these env vars set:
 * // NOORM_CONNECTION_DIALECT=postgres
 * // NOORM_CONNECTION_HOST=db.example.com
 * // NOORM_CONNECTION_PORT=5432
 *
 * const envConfig = getEnvConfig()
 * // {
 * //   connection: { dialect: 'postgres', host: 'db.example.com', port: 5432 },
 * // }
 * ```
 */
export function getEnvConfig(): ConfigInput {

    const config = allConfigs();
    const connection: Record<string, unknown> = {};
    const nested: Record<string, Record<string, unknown>> = {};
    const fields: Record<string, [string, 'string' | 'integer' | 'boolean']> = {
        DIALECT: ['dialect', 'string'], HOST: ['host', 'string'],
        PORT: ['port', 'integer'], DATABASE: ['database', 'string'],
        FILENAME: ['filename', 'string'], USER: ['user', 'string'],
        PASSWORD: ['password', 'string'], SSL: ['ssl', 'boolean'],
        SSL_REJECT_UNAUTHORIZED: ['ssl.rejectUnauthorized', 'boolean'],
        SSL_CA: ['ssl.ca', 'string'], SSL_CERT: ['ssl.cert', 'string'],
        SSL_KEY: ['ssl.key', 'string'], POOL_MIN: ['pool.min', 'integer'],
        POOL_MAX: ['pool.max', 'integer'], TLS_SERVER_NAME: ['tlsServerName', 'string'],
        CONNECT_TIMEOUT_MS: ['connectTimeoutMs', 'integer'],
        POOL_IDLE_TIMEOUT_MILLIS: ['pool.idleTimeoutMillis', 'integer'],
        STATEMENT_TIMEOUT_MS: ['statementTimeoutMs', 'integer'],
        QUERY_TIMEOUT_MS: ['queryTimeoutMs', 'integer'],
        APPLICATION_NAME: ['applicationName', 'string'],
        KEEP_ALIVE: ['keepAlive', 'boolean'],
    };
    const keys = Object.keys(process.env).filter((key) => key.startsWith('NOORM_CONNECTION_')).sort();
    const scalar = 'NOORM_CONNECTION_SSL';
    const sslNested = keys.find((key) => key.startsWith(`${scalar}_`));
    if (keys.includes(scalar) && sslNested) {

        throw new Error(`${scalar} conflicts with ${sslNested}`);

    }
    for (const key of keys) {

        const mapping = fields[key.slice('NOORM_CONNECTION_'.length)];
        if (!mapping) throw new Error(`Unsupported connection environment variable ${key}`);
        const [path, type] = mapping;
        const raw = process.env[key]!;
        let value: string | number | boolean = raw;
        if (type === 'boolean') {

            if (!['true', 'false', '1', '0'].includes(raw)) throw new Error(`${key} must be true, false, 1, or 0`);
            value = raw === 'true' || raw === '1';

        }
        if (type === 'integer') {

            if (!/^\d+$/.test(raw) || !Number.isSafeInteger(Number(raw))) {

                throw new Error(`${key} must be an integer`);

            }
            value = Number(raw);

        }
        const [parent, child] = path.split('.');
        if (child) (nested[parent!] ??= {})[child] = value;
        else connection[parent!] = value;

    }
    Object.assign(connection, nested);
    if (keys.length) config.connection = connection as ConfigInput['connection'];

    // Validate dialect if provided
    if (config.connection?.dialect) {

        const result = DialectSchema.safeParse(config.connection.dialect);
        if (!result.success) {

            throw new Error(
                `Invalid NOORM_CONNECTION_DIALECT: must be one of ${VALID_DIALECTS.join(', ')}`,
            );

        }

    }

    return config;

}


/**
 * Config module - configuration management for noorm.
 *
 * Handles config loading, validation, merging from multiple sources,
 * and per-channel access roles (`docs/spec/config-access-roles.md`).
 */

// Types
export * from './types.js';

// Schema & Validation
export {
    ConfigSchema,
    ConfigInputSchema,
    ConnectionSchema,
    DialectSchema,
    EnvConfigSchema,
    ConfigValidationError,
    validateConfig,
    validateConfigInput,
    parseConfig,
    type ConfigSchemaType,
    type ConfigInputSchemaType,
    type ConnectionSchemaType,
} from './schema.js';

// Resolver
export {
    resolveConfig,
    checkConfigCompleteness,
    canDeleteConfig,
    assertCanDeleteConfig,
    ConfigStageLockedError,
    type ResolveOptions,
    type StateProvider,
    type SettingsProvider,
    type CompletenessCheckOptions,
} from './resolver.js';

