/**
 * Configuration types.
 *
 * Configs define how noorm connects to databases and where to find
 * SQL/change files. They support multiple environments,
 * environment variable overrides, and protected configs for production safety.
 */
import type { ConnectionConfig, Dialect } from '../connection/types.js';
import type { LogLevel } from '../logger/types.js';

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
 *         sql: './sql',
 *         changes: './changes',
 *     },
 * }
 * ```
 */
export interface Config {
    name: string;
    type: 'local' | 'remote';
    isTest: boolean;
    protected: boolean;

    connection: ConnectionConfig;

    paths: {
        sql: string; // Relative to project root
        changes: string; // Relative to project root
    };

    // Optional identity override
    identity?: string;
}

/**
 * Partial config for updates or environment overrides.
 */
export interface ConfigInput {
    name?: string;
    type?: 'local' | 'remote';
    isTest?: boolean;
    protected?: boolean;
    connection?: Partial<ConnectionConfig>;
    paths?: Partial<Config['paths']>;
    identity?: string;
    log: {
        level: LogLevel;
    }
}

/**
 * Summary for config listings.
 */
export interface ConfigSummary {
    name: string;
    type: 'local' | 'remote';
    isTest: boolean;
    protected: boolean;
    isActive: boolean;
    dialect: Dialect;
    database: string;
}

// ─────────────────────────────────────────────────────────────
// Stage Types (for settings.yml integration)
// ─────────────────────────────────────────────────────────────

/**
 * Secret type hints for UI display.
 */
export type SecretType = 'string' | 'password' | 'api_key' | 'connection_string';

/**
 * Required secret definition from a stage.
 */
export interface StageSecret {
    key: string;
    type: SecretType;
    description?: string;
    required?: boolean; // Default: true
}

/**
 * Stage definition from settings.yml.
 *
 * Stages define preconfigured configs with defaults and constraints.
 *
 * @example
 * ```yaml
 * stages:
 *   prod:
 *     description: Production database
 *     locked: true
 *     defaults:
 *       dialect: postgres
 *       protected: true
 *     secrets:
 *       - key: DB_PASSWORD
 *         type: password
 * ```
 */
export interface Stage {
    description?: string;
    locked?: boolean; // Cannot delete config if true
    defaults?: ConfigInput;
    secrets?: StageSecret[];
}

/**
 * Result of checking config completeness.
 */
export interface CompletenessCheck {
    /** Whether the config is complete and usable */
    complete: boolean;

    /** Missing required secrets */
    missingSecrets: string[];

    /** Stage constraint violations */
    violations: string[];
}
