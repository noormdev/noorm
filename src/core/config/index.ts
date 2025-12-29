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

// Environment variables
export {
    getEnvConfig,
    getEnvConfigName,
    isCI,
    shouldSkipConfirmations,
    shouldOutputJson,
} from './env.js';

// Protection
export {
    checkProtection,
    validateConfirmation,
    type ProtectedAction,
    type ProtectionCheck,
} from './protection.js';
