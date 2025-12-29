/**
 * Settings Module
 *
 * Project-wide build behavior and stage configuration.
 * Settings are version controlled (.noorm/settings.yml) and
 * shared across the team.
 */

// Events
export type { SettingsEvents } from './events.js';

// Types
export type {
    SecretType,
    StageSecret,
    StageDefaults,
    Stage,
    RuleMatch,
    Rule,
    BuildConfig,
    PathConfig,
    StrictConfig,
    LoggingConfig,
    Settings,
    RuleEvaluationResult,
    RulesEvaluationResult,
    ConfigForRuleMatch,
} from './types.js';

// Schemas and Validation
export {
    SettingsSchema,
    SettingsValidationError,
    validateSettings,
    parseSettings,
    validateStage,
    validateRule,
} from './schema.js';

export type {
    SettingsSchemaType,
    StageSchemaType,
    StageDefaultsSchemaType,
    StageSecretSchemaType,
    RuleSchemaType,
    RuleMatchSchemaType,
    BuildConfigSchemaType,
    PathConfigSchemaType,
    StrictConfigSchemaType,
    LoggingConfigSchemaType,
} from './schema.js';

// Defaults
export {
    DEFAULT_SETTINGS,
    DEFAULT_BUILD_CONFIG,
    DEFAULT_PATH_CONFIG,
    DEFAULT_STRICT_CONFIG,
    DEFAULT_LOGGING_CONFIG,
    SETTINGS_FILE_PATH,
    SETTINGS_DIR_PATH,
    createDefaultSettings,
} from './defaults.js';

// Rule Evaluation
export {
    ruleMatches,
    evaluateRule,
    evaluateRules,
    mergeWithBuildConfig,
    getEffectiveBuildPaths,
} from './rules.js';

// Manager
export { SettingsManager, getSettingsManager, resetSettingsManager } from './manager.js';

export type { SettingsManagerOptions } from './manager.js';
