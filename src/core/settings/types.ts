/**
 * Settings Types
 *
 * Settings define project-wide build behavior and stage configuration.
 * Unlike encrypted configs (credentials), settings are version controlled
 * and shared across the team via .noorm/settings.yml
 */

/**
 * Secret type hints for CLI input handling.
 *
 * - string: Plain text input
 * - password: Masked input, no echo
 * - api_key: Masked input, validated format
 * - connection_string: Validated as URI
 */
export type SecretType = 'string' | 'password' | 'api_key' | 'connection_string';

/**
 * Required secret definition for a stage.
 *
 * @example
 * ```yaml
 * secrets:
 *     - key: DB_PASSWORD
 *       type: password
 *       description: Database password
 *       required: true
 * ```
 */
export interface StageSecret {
    /** Secret key name (e.g., DB_PASSWORD) */
    key: string;

    /** Type hint for CLI input handling */
    type: SecretType;

    /** Human-readable description shown in CLI prompts */
    description?: string;

    /** Whether the secret is required (default: true) */
    required?: boolean;
}

/**
 * Stage defaults that can be overridden when creating a config.
 *
 * These provide initial values. Some are enforceable constraints:
 * - protected: true - Cannot be overridden to false
 * - isTest: true - Cannot be overridden to false
 * - dialect - Cannot be changed after creation
 */
export interface StageDefaults {
    dialect?: 'postgres' | 'mysql' | 'sqlite' | 'mssql';
    host?: string;
    port?: number;
    database?: string;
    user?: string;
    password?: string;
    ssl?: boolean;
    isTest?: boolean;
    protected?: boolean;
}

/**
 * Stage definition - a preconfigured config template.
 *
 * Stages are team-defined config templates with defaults, constraints,
 * and required secrets. They're managed via version control.
 *
 * @example
 * ```yaml
 * stages:
 *     prod:
 *         description: Production database
 *         locked: true
 *         defaults:
 *             dialect: postgres
 *             protected: true
 *         secrets:
 *             - key: DB_PASSWORD
 *               type: password
 * ```
 */
export interface Stage {
    /** Human-readable description shown in CLI */
    description?: string;

    /** If true, configs linked to this stage cannot be deleted */
    locked?: boolean;

    /** Default values when creating config from this stage */
    defaults?: StageDefaults;

    /** Required secrets that must be set before config is usable */
    secrets?: StageSecret[];
}

/**
 * Conditions for rule matching.
 *
 * All conditions in a rule are AND'd together.
 * A rule matches when ALL specified conditions are true.
 */
export interface RuleMatch {
    /** Config name (exact match) */
    name?: string;

    /** Protected config flag */
    protected?: boolean;

    /** Test database flag */
    isTest?: boolean;

    /** Connection type */
    type?: 'local' | 'remote';
}

/**
 * Stage-based rule for conditional include/exclude.
 *
 * Rules control which files/folders are included or excluded
 * based on the active config's properties.
 *
 * @example
 * ```yaml
 * rules:
 *     - match:
 *           isTest: true
 *       include:
 *           - schema/seeds
 *     - match:
 *           protected: true
 *       exclude:
 *           - schema/dangerous
 * ```
 */
export interface Rule {
    /** User-friendly description (e.g., "test seeds", "prod config") */
    description?: string;

    /** Conditions that must all match */
    match: RuleMatch;

    /** Folders to include when rule matches */
    include?: string[];

    /** Folders to exclude when rule matches */
    exclude?: string[];
}

/**
 * Build configuration - controls file inclusion and execution order.
 */
export interface BuildConfig {
    /**
     * Folders to include, executed in this order.
     * First listed = first executed.
     */
    include?: string[];

    /** Folders to exclude from all builds */
    exclude?: string[];
}

/**
 * Path configuration - override default locations.
 */
export interface PathConfig {
    /** Path to schema files (relative to project root) */
    schema?: string;

    /** Path to changeset files (relative to project root) */
    changesets?: string;
}

/**
 * Strict mode configuration.
 *
 * When enabled, requires certain stages to exist before operations can run.
 */
export interface StrictConfig {
    /** Enable strict mode */
    enabled?: boolean;

    /** Required stage names that must have configs */
    stages?: string[];
}

/**
 * Logging configuration.
 */
export interface LoggingConfig {

    /** Enable file logging */
    enabled?: boolean;

    /** Minimum level to capture: silent, error, warn, info, verbose */
    level?: 'silent' | 'error' | 'warn' | 'info' | 'verbose';

    /** Log file path (relative to project root) */
    file?: string;

    /** Rotate log when size exceeded (e.g., '10mb') */
    maxSize?: string;

    /** Number of rotated files to keep */
    maxFiles?: number;

}

/**
 * Teardown configuration.
 *
 * Controls database reset and teardown behavior.
 *
 * @example
 * ```yaml
 * teardown:
 *     preserveTables:
 *         - AppSettings
 *         - UserRoles
 *     postScript: "schema/teardown/cleanup.sql"
 * ```
 */
export interface TeardownConfig {

    /** Tables to always preserve during truncate operations */
    preserveTables?: string[];

    /** SQL script to run after schema teardown (relative to project root) */
    postScript?: string;

}

/**
 * Complete settings configuration.
 *
 * Stored in .noorm/settings.yml and version controlled.
 */
export interface Settings {

    /** Build configuration */
    build?: BuildConfig;

    /** Path overrides */
    paths?: PathConfig;

    /** Stage-based rules for conditional include/exclude */
    rules?: Rule[];

    /** Preconfigured config templates */
    stages?: Record<string, Stage>;

    /** Strict mode requiring specific stages */
    strict?: StrictConfig;

    /** Logging configuration */
    logging?: LoggingConfig;

    /** Universal secrets required by ALL stages */
    secrets?: StageSecret[];

    /** Database teardown/reset configuration */
    teardown?: TeardownConfig;

}

/**
 * Rule evaluation result.
 */
export interface RuleEvaluationResult {
    /** Whether the rule matched */
    matched: boolean;

    /** Folders to include from this rule */
    include: string[];

    /** Folders to exclude from this rule */
    exclude: string[];
}

/**
 * Combined result of all rule evaluations for a config.
 */
export interface RulesEvaluationResult {
    /** All matched rules */
    matchedRules: Rule[];

    /** Combined folders to include */
    include: string[];

    /** Combined folders to exclude */
    exclude: string[];
}

/**
 * Config properties used for rule matching.
 * Subset of full Config used to evaluate rules.
 */
export interface ConfigForRuleMatch {
    name: string;
    type: 'local' | 'remote';
    isTest: boolean;
    protected: boolean;
}
