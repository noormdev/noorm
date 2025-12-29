/**
 * Settings module event definitions.
 *
 * Events emitted by SettingsManager for settings lifecycle and mutations.
 */
import type {
    Settings,
    Stage,
    Rule,
    BuildConfig,
    PathConfig,
    StrictConfig,
    LoggingConfig,
} from './types.js';

/**
 * Settings events emitted by the settings module.
 */
export interface SettingsEvents {
    /** Settings loaded from file or defaults */
    'settings:loaded': {
        path: string;
        settings: Settings;
        fromFile: boolean;
    };

    /** Settings saved to disk */
    'settings:saved': {
        path: string;
    };

    /** Settings file initialized */
    'settings:initialized': {
        path: string;
        force: boolean;
    };

    /** Stage added or updated */
    'settings:stage-set': {
        name: string;
        stage: Stage;
    };

    /** Stage removed */
    'settings:stage-removed': {
        name: string;
    };

    /** Rule added */
    'settings:rule-added': {
        rule: Rule;
    };

    /** Rule removed */
    'settings:rule-removed': {
        index: number;
        rule: Rule;
    };

    /** Build config updated */
    'settings:build-updated': {
        build: BuildConfig;
    };

    /** Paths config updated */
    'settings:paths-updated': {
        paths: PathConfig;
    };

    /** Strict mode config updated */
    'settings:strict-updated': {
        strict: StrictConfig;
    };

    /** Logging config updated */
    'settings:logging-updated': {
        logging: LoggingConfig;
    };
}
