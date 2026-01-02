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
]);

const VALID_DIALECTS = ['postgres', 'mysql', 'sqlite', 'mssql'] as const;

export const { allConfigs, getConfig } = makeNestedConfig<ConfigInput>(process.env as Record<string, string>, {
    filter: (key) => key.startsWith('NOORM_') && !META_ENV_VARS.has(key),
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
 * // NOORM_PATHS_SCHEMA=./schema
 *
 * const envConfig = getEnvConfig()
 * // {
 * //   connection: { dialect: 'postgres', host: 'db.example.com', port: 5432 },
 * //   paths: { schema: './schema' }
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
} from './resolver.js';

// Protection
export {
    checkProtection,
    validateConfirmation,
    type ProtectedAction,
    type ProtectionCheck,
} from './protection.js';

