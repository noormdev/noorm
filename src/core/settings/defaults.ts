/**
 * Default Settings
 *
 * Sensible defaults used when no settings.yml exists or when
 * optional fields are missing.
 */
import type { Settings, BuildConfig, PathConfig, StrictConfig, LoggingConfig } from './types.js';

/**
 * Default build configuration.
 *
 * Includes only the schema folder by default.
 */
export const DEFAULT_BUILD_CONFIG: BuildConfig = {
    include: ['schema'],
    exclude: [],
};

/**
 * Default path configuration.
 *
 * Standard locations relative to project root.
 */
export const DEFAULT_PATH_CONFIG: PathConfig = {
    sql: './sql',
    changes: './changes',
};

/**
 * Default strict mode configuration.
 *
 * Disabled by default - no required stages.
 */
export const DEFAULT_STRICT_CONFIG: StrictConfig = {
    enabled: false,
    stages: [],
};

/**
 * Default logging configuration.
 */
export const DEFAULT_LOGGING_CONFIG: LoggingConfig = {
    enabled: true,
    level: 'info',
    file: '.noorm/noorm.log',
    maxSize: '10mb',
    maxFiles: 5,
};

/**
 * Complete default settings.
 *
 * Used when no settings.yml exists.
 *
 * @example
 * ```typescript
 * // If settings.yml doesn't exist, use defaults
 * const settings = await loadSettings() ?? DEFAULT_SETTINGS
 * ```
 */
export const DEFAULT_SETTINGS: Settings = {
    build: DEFAULT_BUILD_CONFIG,
    paths: DEFAULT_PATH_CONFIG,
    rules: [],
    stages: {},
    strict: DEFAULT_STRICT_CONFIG,
    logging: DEFAULT_LOGGING_CONFIG,
};

/**
 * Create a fresh copy of default settings.
 *
 * IMPORTANT: Use this instead of spreading DEFAULT_SETTINGS
 * to avoid shared references to mutable nested objects.
 *
 * @example
 * ```typescript
 * // Good - creates fresh copy
 * this.#settings = createDefaultSettings()
 *
 * // Bad - shares references to rules[], stages{}, etc.
 * this.#settings = { ...DEFAULT_SETTINGS }
 * ```
 */
export function createDefaultSettings(): Settings {

    return {
        build: {
            include: [...(DEFAULT_BUILD_CONFIG.include ?? [])],
            exclude: [...(DEFAULT_BUILD_CONFIG.exclude ?? [])],
        },
        paths: { ...DEFAULT_PATH_CONFIG },
        rules: [],
        stages: {},
        strict: { ...DEFAULT_STRICT_CONFIG, stages: [...(DEFAULT_STRICT_CONFIG.stages ?? [])] },
        logging: { ...DEFAULT_LOGGING_CONFIG },
    };

}

/**
 * Settings file location relative to project root.
 */
export const SETTINGS_FILE_PATH = '.noorm/settings.yml';

/**
 * Settings directory relative to project root.
 */
export const SETTINGS_DIR_PATH = '.noorm';
