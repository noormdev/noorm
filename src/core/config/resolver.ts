/**
 * Config resolver - merges configuration from multiple sources.
 *
 * Priority order (highest to lowest):
 * 1. CLI flags
 * 2. Environment variables
 * 3. Stored config file
 * 4. Defaults
 */
import { merge, clone } from '@logosdx/utils'

import type { Config, ConfigInput } from './types.js'
import { getEnvConfig, getEnvConfigName } from './env.js'
import { parseConfig } from './schema.js'


/**
 * Interface for state manager dependency.
 *
 * Using an interface instead of the class to avoid circular dependencies.
 */
export interface StateProvider {

    getConfig(name: string): Config | null
    getActiveConfigName(): string | null
}


/**
 * Default config values.
 */
const DEFAULTS: ConfigInput = {

    type: 'local',
    isTest: false,
    protected: false,
    paths: {
        schema: './schema',
        changesets: './changesets',
    },
    connection: {
        host: 'localhost',
        pool: { min: 0, max: 10 },
    },
}


/**
 * Options for resolving a config.
 */
export interface ResolveOptions {

    /** Config name to load (overrides env var and active config) */
    name?: string

    /** CLI flag overrides */
    flags?: ConfigInput
}


/**
 * Resolve the active config from all sources.
 *
 * Merges config from:
 * 1. Defaults
 * 2. Stored config (if name provided or active config exists)
 * 3. Environment variables (NOORM_*)
 * 4. CLI flags
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
 */
export function resolveConfig(
    state: StateProvider,
    options: ResolveOptions = {}
): Config | null {

    // 1. Determine which config to use
    const configName = options.name
        ?? getEnvConfigName()
        ?? state.getActiveConfigName()

    if (!configName) {

        // Check if we have enough env vars to run without a stored config
        const envConfig = getEnvConfig()
        if (envConfig.connection?.dialect && envConfig.connection?.database) {

            return resolveFromEnvOnly(envConfig, options.flags)
        }
        return null
    }

    // 2. Load stored config
    const stored = state.getConfig(configName)
    if (!stored) {

        throw new Error(`Config "${configName}" not found`)
    }

    // 3. Merge: defaults <- stored <- env <- flags
    // Clone DEFAULTS to avoid mutation
    const envConfig = getEnvConfig()
    const merged = merge(
        merge(
            merge(clone(DEFAULTS), stored),
            envConfig
        ),
        options.flags ?? {}
    )

    // 4. Validate and return with defaults applied
    return parseConfig(merged)
}


/**
 * Build a config purely from environment variables (CI mode).
 *
 * Useful when no stored config exists but env vars provide all needed values.
 */
function resolveFromEnvOnly(envConfig: ConfigInput, flags?: ConfigInput): Config {

    // Clone DEFAULTS to avoid mutation
    const merged = merge(merge(clone(DEFAULTS), envConfig), flags ?? {})

    // Generate a name if not provided
    if (!merged.name) {

        merged.name = '__env__'
    }

    return parseConfig(merged)
}
