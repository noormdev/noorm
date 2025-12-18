/**
 * Environment variable configuration.
 *
 * All config properties can be overridden via NOORM_* environment variables.
 * Uses makeNestedConfig to automatically transform flat env vars into nested
 * config objects matching the ConfigInput structure.
 *
 * @example
 * ```bash
 * # Connection settings
 * NOORM_CONNECTION_DIALECT=postgres
 * NOORM_CONNECTION_HOST=localhost
 * NOORM_CONNECTION_PORT=5432
 * NOORM_CONNECTION_DATABASE=myapp
 * NOORM_CONNECTION_USER=admin
 * NOORM_CONNECTION_PASSWORD=secret
 * NOORM_CONNECTION_SSL=true
 * NOORM_CONNECTION_POOL_MIN=2
 * NOORM_CONNECTION_POOL_MAX=20
 *
 * # Path settings
 * NOORM_PATHS_SCHEMA=./db/schema
 * NOORM_PATHS_CHANGESETS=./db/changesets
 *
 * # Top-level settings
 * NOORM_NAME=prod
 * NOORM_PROTECTED=true
 * NOORM_IDENTITY=deploy-bot
 * NOORM_isTest=false
 * NOORM_TYPE=remote
 * ```
 *
 * This enables CI/CD workflows to configure noorm without stored config files.
 * Just set the env vars and noorm works.
 */
import { makeNestedConfig } from '@logosdx/utils'

import type { ConfigInput } from './types.js'
import { DialectSchema } from './schema.js'


/**
 * Meta env vars that control CLI behavior, not config values.
 * These are excluded from makeNestedConfig processing.
 */
const META_ENV_VARS = new Set([
    'NOORM_CONFIG',  // Config selection
    'NOORM_YES',     // Skip confirmations
    'NOORM_JSON',    // JSON output mode
])


const VALID_DIALECTS = ['postgres', 'mysql', 'sqlite', 'mssql'] as const


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

    const { allConfigs } = makeNestedConfig<ConfigInput>(
        process.env as Record<string, string>,
        {
            filter: (key) => key.startsWith('NOORM_') && !META_ENV_VARS.has(key),
            stripPrefix: 'NOORM_',
            forceAllCapToLower: true,
            skipConversion: (key) => key.toLowerCase().includes('password'),
        }
    )

    const config = allConfigs()

    // Validate dialect if provided
    if (config.connection?.dialect) {

        const result = DialectSchema.safeParse(config.connection.dialect)
        if (!result.success) {

            throw new Error(
                `Invalid NOORM_CONNECTION_DIALECT: must be one of ${VALID_DIALECTS.join(', ')}`
            )
        }
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
