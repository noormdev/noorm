/**
 * Configuration types.
 *
 * Configs define how noorm connects to databases and where to find
 * schema/changeset files. They support multiple environments,
 * environment variable overrides, and protected configs for production safety.
 */
import type { ConnectionConfig, Dialect } from '../connection/types.js'


/**
 * Full configuration object.
 *
 * @example
 * ```typescript
 * const config: Config = {
 *     name: 'dev',
 *     type: 'local',
 *     isTest: false,
 *     protected: false,
 *     connection: {
 *         dialect: 'postgres',
 *         host: 'localhost',
 *         port: 5432,
 *         database: 'myapp_dev',
 *         user: 'postgres',
 *         password: 'postgres',
 *     },
 *     paths: {
 *         schema: './schema',
 *         changesets: './changesets',
 *     },
 * }
 * ```
 */
export interface Config {

    name: string
    type: 'local' | 'remote'
    isTest: boolean
    protected: boolean

    connection: ConnectionConfig

    paths: {
        schema: string      // Relative to project root
        changesets: string  // Relative to project root
    }

    // Optional identity override
    identity?: string
}


/**
 * Partial config for updates or environment overrides.
 */
export interface ConfigInput {

    name?: string
    type?: 'local' | 'remote'
    isTest?: boolean
    protected?: boolean
    connection?: Partial<ConnectionConfig>
    paths?: Partial<Config['paths']>
    identity?: string
}


/**
 * Summary for config listings.
 */
export interface ConfigSummary {

    name: string
    type: 'local' | 'remote'
    isTest: boolean
    protected: boolean
    isActive: boolean
    dialect: Dialect
    database: string
}
