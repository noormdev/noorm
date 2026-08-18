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
 * Empty include means all files in the SQL directory are included.
 * Users can restrict to specific subdirectories via settings.
 */
export const DEFAULT_BUILD_CONFIG: BuildConfig = {
    include: [],
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
    file: '.noorm/state/noorm.log',
    maxSize: '10mb',
    maxFiles: 5,
};

/**
 * Whether the TUI answers mouse reports when nothing says otherwise.
 *
 * The single place "absent means on" is decided. The schema reads it for the
 * `ui: {}` case, `isMouseEnabled` reads it for the no-section case, and the TUI
 * reads neither directly — so the two cannot drift apart into a state where
 * writing an empty `ui:` block changes behaviour.
 */
export const DEFAULT_UI_MOUSE = true;

/**
 * Whether the TUI should answer mouse reports for these settings.
 *
 * A plain `settings?.ui?.mouse === true` read makes an absent section mean off,
 * which is the opposite of the default now, and a plain `!== false` read
 * scatters the decision across every caller. This is the one reader.
 *
 * @example
 * <MouseProvider enabled={isMouseEnabled(settings)}>
 */
export function isMouseEnabled(settings: Pick<Settings, 'ui'> | null | undefined): boolean {

    return settings?.ui?.mouse ?? DEFAULT_UI_MOUSE;

}

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

/**
 * State directory relative to project root.
 *
 * Contains gitignored artifacts: logs, sql history, etc.
 */
export const STATE_DIR_PATH = '.noorm/state';
