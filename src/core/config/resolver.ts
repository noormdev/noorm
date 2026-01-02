/**
 * Config resolver - merges configuration from multiple sources.
 *
 * Priority order (highest to lowest):
 * 1. CLI flags
 * 2. Environment variables
 * 3. Stored config
 * 4. Stage defaults (from settings.yml)
 * 5. Defaults
 */
import { merge, clone } from '@logosdx/utils';

import type { Config, ConfigInput, CompletenessCheck } from './types.js';
import { getEnvConfigName } from '../environment.js';
import { parseConfig } from './schema.js';
import { getEnvConfig } from './index.js';
import type { SettingsManager, StageDefaults } from '../settings/index.js';

/**
 * Interface for state manager dependency.
 *
 * Using an interface instead of the class to avoid circular dependencies.
 */
export interface StateProvider {
    getConfig(name: string): Config | null;
    getActiveConfigName(): string | null;
    listSecrets(configName: string): string[];
}

/**
 * Interface for settings provider dependency.
 *
 * Settings provide stage definitions and build rules.
 * Optional - config resolution works without settings.
 */
export class SettingsProvider {

    #manager: SettingsManager;

    constructor(manager: SettingsManager) {

        this.#manager = manager;

    }

    /** Get a stage by name */
    getStage(name: string) {

        return this.#manager.getStage(name) ?? null;

    }

    /** Get stage that matches a config name (for auto-linking) */
    findStageForConfig(configName: string) {

        // Auto-link: if a stage exists with same name as config, use it
        return this.#manager.getStage(configName) ?? null;

    }

}

/**
 * Default config values.
 */
const DEFAULTS: ConfigInput = {
    type: 'local',
    isTest: false,
    protected: false,
    paths: {
        sql: './sql',
        changes: './changes',
    },
    connection: {
        host: 'localhost',
        pool: { min: 0, max: 10 },
    },
    log: {
        level: 'info',
    },
};

/**
 * Options for resolving a config.
 */
export interface ResolveOptions {
    /** Config name to load (overrides env var and active config) */
    name?: string;

    /** CLI flag overrides */
    flags?: ConfigInput;

    /** Stage name to use for defaults (from --stage flag) */
    stage?: string;

    /** Settings provider for stage lookup */
    settings?: SettingsProvider;
}

/**
 * Resolve the active config from all sources.
 *
 * Merges config from (lowest to highest priority):
 * 1. Defaults
 * 2. Stage defaults (from settings.yml, if stage provided or config name matches)
 * 3. Stored config (if name provided or active config exists)
 * 4. Environment variables (NOORM_*)
 * 5. CLI flags
 *
 * @example
 * ```typescript
 * const state = await getStateManager()
 * const config = resolveConfig(state)
 *
 * if (!config) {
 *     console.error('No config found. Run: noorm config add')
 *     process.exit(1)
 * }
 * ```
 *
 * @example
 * ```typescript
 * // With CLI flag overrides
 * const config = resolveConfig(state, {
 *     name: 'production',
 *     flags: { connection: { host: 'db.example.com' } }
 * })
 * ```
 *
 * @example
 * ```typescript
 * // With stage defaults from settings
 * const config = resolveConfig(state, {
 *     name: 'prod',
 *     stage: 'prod',
 *     settings: settingsManager,
 * })
 * ```
 */
export function resolveConfig(state: StateProvider, options: ResolveOptions = {}): Config | null {

    // 1. Determine which config to use
    const configName = options.name ?? getEnvConfigName() ?? state.getActiveConfigName();

    if (!configName) {

        // Check if we have enough env vars to run without a stored config
        const envConfig = getEnvConfig();
        if (envConfig.connection?.dialect && envConfig.connection?.database) {

            return resolveFromEnvOnly(envConfig, options.flags, options.stage, options.settings);

        }

        return null;

    }

    // 2. Load stored config
    const stored = state.getConfig(configName);
    if (!stored) {

        throw new Error(`Config "${configName}" not found`);

    }

    // 3. Get stage defaults (if settings available)
    const stageDefaults = getStageDefaults(configName, options.stage, options.settings);

    // 4. Merge: defaults <- stage <- stored <- env <- flags
    // Clone DEFAULTS to avoid mutation
    const envConfig = getEnvConfig();
    let merged = clone(DEFAULTS);

    if (stageDefaults) {

        merged = merge(merged, stageDefaults);

    }

    merged = merge(merged, stored);
    merged = merge(merged, envConfig) as ConfigInput;
    merged = merge(merged, options.flags ?? {});

    // 5. Validate and return with defaults applied
    return parseConfig(merged);

}

/**
 * Get stage defaults for a config.
 *
 * Looks up stage by:
 * 1. Explicit stage name (from --stage flag)
 * 2. Config name matching a stage name
 */
function getStageDefaults(
    configName: string,
    stageName: string | undefined,
    settings: SettingsProvider | undefined,
): StageDefaults | null {

    if (!settings) return null;
    if (stageName) return settings.getStage(stageName)?.defaults ?? null;

    return settings.findStageForConfig(configName)?.defaults ?? null;

}

/**
 * Build a config purely from environment variables (CI mode).
 *
 * Useful when no stored config exists but env vars provide all needed values.
 */
function resolveFromEnvOnly(
    envConfig: ConfigInput,
    flags?: ConfigInput,
    stageName?: string,
    settings?: SettingsProvider,
): Config {

    // Generate a name if not provided
    const name = envConfig.name ?? flags?.name ?? '__env__';

    // Get stage defaults if available
    const stageDefaults = getStageDefaults(name, stageName, settings);

    // Merge: defaults <- stage <- env <- flags
    let merged = clone(DEFAULTS);

    if (stageDefaults) {

        merged = merge(merged, stageDefaults);

    }

    merged = merge(merged, envConfig);
    merged = merge(merged, flags ?? {});

    // Ensure name is set
    if (!merged.name) {

        merged.name = '__env__';

    }

    return parseConfig(merged);

}

/**
 * Check if a config is complete and usable.
 *
 * A config is complete when all required secrets (from its stage) are set.
 * Also checks for stage constraint violations.
 *
 * @example
 * ```typescript
 * const check = checkConfigCompleteness(config, state, settings)
 * if (!check.complete) {
 *     console.log('Missing secrets:', check.missingSecrets)
 *     console.log('Violations:', check.violations)
 * }
 * ```
 */
export function checkConfigCompleteness(
    config: Config,
    state: StateProvider,
    settings?: SettingsProvider,
    stageName?: string,
): CompletenessCheck {

    const result: CompletenessCheck = {
        complete: true,
        missingSecrets: [],
        violations: [],
    };

    // Get stage for this config
    const stage = settings
        ? stageName
            ? settings.getStage(stageName)
            : settings.findStageForConfig(config.name)
        : null;

    if (!stage) {

        // No stage = no requirements to check
        return result;

    }

    // Check required secrets
    const existingSecrets = state.listSecrets(config.name);

    for (const secret of stage.secrets ?? []) {

        const isRequired = secret.required !== false; // Default to true
        if (isRequired && !existingSecrets.includes(secret.key)) {

            result.missingSecrets.push(secret.key);

        }

    }

    // Check stage constraint violations
    const defaults = stage.defaults ?? {} as ConfigInput;

    // protected: true cannot be overridden to false
    if (defaults.protected === true && config.protected === false) {

        result.violations.push(
            `Stage "${stageName ?? config.name}" requires protected=true, but config has protected=false`,
        );

    }

    // isTest: true cannot be overridden to false
    if (defaults.isTest === true && config.isTest === false) {

        result.violations.push(
            `Stage "${stageName ?? config.name}" requires isTest=true, but config has isTest=false`,
        );

    }

    // Update complete flag
    result.complete = result.missingSecrets.length === 0 && result.violations.length === 0;

    return result;

}

/**
 * Check if a config can be deleted.
 *
 * Locked stages prevent config deletion.
 */
export function canDeleteConfig(
    configName: string,
    settings?: SettingsProvider,
    stageName?: string,
): { allowed: boolean; reason?: string } {

    if (!settings) {

        return { allowed: true };

    }

    const stage = stageName
        ? settings.getStage(stageName)
        : settings.findStageForConfig(configName);

    if (stage?.locked) {

        return {
            allowed: false,
            reason: `Config "${configName}" is linked to a locked stage and cannot be deleted`,
        };

    }

    return { allowed: true };

}
