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
    'NOORM_IDENTITY', // Identity string override (identity resolver)
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
 * and protected config handling.
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
    type ResolveOptions,
    type StateProvider,
    type SettingsProvider,
    type CompletenessCheckOptions,
} from './resolver.js';

// Protection
export {
    checkProtection,
    validateConfirmation,
    type ProtectedAction,
    type ProtectionCheck,
} from './protection.js';

