/**
 * Environment variable configuration.
 *
 * All config properties can be overridden via NOORM_* environment variables.
 * This enables CI/CD workflows to configure noorm without stored config files.
 */
import { setDeep } from '@logosdx/utils'

import type { ConfigInput } from './types.js'
import { DialectSchema } from './schema.js'

/**
 * Environment variable to config path mappings.
 */
const ENV_MAP = {

    // Connection
    NOORM_DIALECT: 'connection.dialect',
    NOORM_HOST: 'connection.host',
    NOORM_PORT: 'connection.port',
    NOORM_DATABASE: 'connection.database',
    NOORM_USER: 'connection.user',
    NOORM_PASSWORD: 'connection.password',
    NOORM_SSL: 'connection.ssl',

    // Paths
    NOORM_SCHEMA_PATH: 'paths.schema',
    NOORM_CHANGESET_PATH: 'paths.changesets',

    // Behavior
    // Note: NOORM_CONFIG is handled separately by getEnvConfigName()
    // for config selection, not merged into config values
    NOORM_PROTECTED: 'protected',
    NOORM_IDENTITY: 'identity',

    // Not mapped to config (handled separately):
    // NOORM_YES: skip confirmations
    // NOORM_JSON: json output
} as const


const VALID_DIALECTS = ['postgres', 'mysql', 'sqlite', 'mssql'] as const


/**
 * Read config values from environment variables.
 *
 * Scans all NOORM_* environment variables and builds a ConfigInput
 * object with the appropriate nested structure.
 *
 * @example
 * ```typescript
 * // With NOORM_DIALECT=postgres and NOORM_HOST=db.example.com set:
 * const envConfig = getEnvConfig()
 * // { connection: { dialect: 'postgres', host: 'db.example.com' } }
 * ```
 */
export function getEnvConfig(): ConfigInput {

    const config: ConfigInput = {}

    for (const [envVar, path] of Object.entries(ENV_MAP)) {

        const value = process.env[envVar]
        if (value === undefined) continue

        setDeep(config, path, parseEnvValue(envVar, value) as never)
    }

    return config
}


/**
 * Get the active config name from environment.
 *
 * Returns the value of NOORM_CONFIG if set.
 */
export function getEnvConfigName(): string | undefined {

    return process.env['NOORM_CONFIG']
}


/**
 * Check if running in CI mode.
 *
 * Returns true if CI environment variable is set to '1' or 'true'.
 */
export function isCI(): boolean {

    const ci = process.env['CI']
    return ci === '1' || ci === 'true'
}


/**
 * Check if confirmations should be skipped.
 *
 * Returns true if NOORM_YES is set, enabling non-interactive mode.
 */
export function shouldSkipConfirmations(): boolean {

    const yes = process.env['NOORM_YES']
    return yes === '1' || yes === 'true'
}


/**
 * Check if output should be JSON.
 *
 * Returns true if NOORM_JSON is set, enabling headless/parseable output.
 */
export function shouldOutputJson(): boolean {

    const json = process.env['NOORM_JSON']
    return json === '1' || json === 'true'
}


// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

/**
 * Parse environment variable value with type coercion.
 */
function parseEnvValue(envVar: string, value: string): string | number | boolean {

    // Port is numeric
    if (envVar === 'NOORM_PORT') {

        const port = parseInt(value, 10)
        if (isNaN(port)) {

            throw new Error(`Invalid ${envVar}: must be a number`)
        }
        return port
    }

    // Booleans
    if (envVar === 'NOORM_SSL' || envVar === 'NOORM_PROTECTED') {

        return value === '1' || value === 'true'
    }

    // Dialect validation
    if (envVar === 'NOORM_DIALECT') {

        const result = DialectSchema.safeParse(value)
        if (!result.success) {

            throw new Error(`Invalid ${envVar}: must be one of ${VALID_DIALECTS.join(', ')}`)
        }
        return value
    }

    return value
}
