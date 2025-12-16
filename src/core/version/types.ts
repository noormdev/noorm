/**
 * Version module types.
 *
 * Defines types for schema, state, and settings migrations.
 * Each layer has its own version number, independent of CLI package version.
 *
 * WHY: Decoupling version numbers allows us to:
 * - Keep state/settings stable while CLI evolves
 * - Only run migrations for what actually changed
 * - Gradually rollout changes across layers
 */
import type { Kysely } from 'kysely'


// ─────────────────────────────────────────────────────────────
// Version Numbers
// ─────────────────────────────────────────────────────────────

/**
 * Current version numbers for each layer.
 *
 * Increment these when adding new migrations.
 * These are independent of the package version.
 */
export const CURRENT_VERSIONS = Object.freeze({

    /** Database tracking tables schema version */
    schema: 1,

    /** State file (state.enc) schema version */
    state: 1,

    /** Settings file (settings.yml) schema version */
    settings: 1,
})


/**
 * Version layers tracked by the version module.
 */
export type VersionLayer = 'schema' | 'state' | 'settings'


// ─────────────────────────────────────────────────────────────
// Schema Migrations (Kysely)
// ─────────────────────────────────────────────────────────────

/**
 * Kysely migration for database schema changes.
 *
 * Uses Kysely's schema builder for dialect-agnostic DDL.
 * Do NOT write raw SQL - use db.schema methods.
 *
 * @example
 * ```typescript
 * export const v1: SchemaMigration = {
 *     version: 1,
 *     description: 'Create tracking tables',
 *     async up(db) {
 *         await db.schema
 *             .createTable('__noorm_version__')
 *             .addColumn('id', 'serial', col => col.primaryKey())
 *             .execute()
 *     },
 *     async down(db) {
 *         await db.schema.dropTable('__noorm_version__').execute()
 *     }
 * }
 * ```
 */
export interface SchemaMigration {

    /** Migration version number (1, 2, 3, ...) */
    version: number

    /** Human-readable description */
    description: string

    /** Apply the migration */
    up(db: Kysely<unknown>): Promise<void>

    /** Rollback the migration */
    down(db: Kysely<unknown>): Promise<void>
}


// ─────────────────────────────────────────────────────────────
// State Migrations (JSON)
// ─────────────────────────────────────────────────────────────

/**
 * State migration for transforming decrypted JSON state.
 *
 * Migrations add/remove/rename fields in the state object.
 * They should be idempotent - running twice produces same result.
 *
 * @example
 * ```typescript
 * export const v2: StateMigration = {
 *     version: 2,
 *     description: 'Add globalSecrets field',
 *     up(state) {
 *         return {
 *             ...state,
 *             globalSecrets: state['globalSecrets'] ?? {},
 *         }
 *     },
 *     down(state) {
 *         const { globalSecrets, ...rest } = state
 *         return rest
 *     }
 * }
 * ```
 */
export interface StateMigration {

    /** Migration version number (1, 2, 3, ...) */
    version: number

    /** Human-readable description */
    description: string

    /** Apply the migration (transform state forward) */
    up(state: Record<string, unknown>): Record<string, unknown>

    /** Rollback the migration (transform state backward) */
    down(state: Record<string, unknown>): Record<string, unknown>
}


// ─────────────────────────────────────────────────────────────
// Settings Migrations (YAML)
// ─────────────────────────────────────────────────────────────

/**
 * Settings migration for transforming parsed YAML settings.
 *
 * Migrations add/remove/rename fields in the settings object.
 * They should be idempotent - running twice produces same result.
 *
 * @example
 * ```typescript
 * export const v2: SettingsMigration = {
 *     version: 2,
 *     description: 'Add strict mode defaults',
 *     up(settings) {
 *         return {
 *             ...settings,
 *             strict: settings['strict'] ?? {
 *                 enabled: false,
 *                 stages: [],
 *             },
 *         }
 *     },
 *     down(settings) {
 *         const { strict, ...rest } = settings
 *         return rest
 *     }
 * }
 * ```
 */
export interface SettingsMigration {

    /** Migration version number (1, 2, 3, ...) */
    version: number

    /** Human-readable description */
    description: string

    /** Apply the migration (transform settings forward) */
    up(settings: Record<string, unknown>): Record<string, unknown>

    /** Rollback the migration (transform settings backward) */
    down(settings: Record<string, unknown>): Record<string, unknown>
}


// ─────────────────────────────────────────────────────────────
// Version Status
// ─────────────────────────────────────────────────────────────

/**
 * Version status for a single layer.
 */
export interface LayerVersionStatus {

    /** Current version in storage */
    current: number

    /** Expected version (what CLI needs) */
    expected: number

    /** Whether migration is needed */
    needsMigration: boolean

    /** Whether storage is newer than CLI (error case) */
    isNewer: boolean
}


/**
 * Combined version status for all layers.
 */
export interface VersionStatus {

    /** Database schema version status */
    schema: LayerVersionStatus

    /** State file version status */
    state: LayerVersionStatus

    /** Settings file version status */
    settings: LayerVersionStatus
}


// ─────────────────────────────────────────────────────────────
// Errors
// ─────────────────────────────────────────────────────────────

/**
 * Error thrown when storage version is newer than CLI supports.
 *
 * This happens when running an older CLI against data created
 * by a newer version. Solution: upgrade the CLI.
 */
export class VersionMismatchError extends Error {

    constructor(
        public readonly layer: VersionLayer,
        public readonly current: number,
        public readonly expected: number
    ) {

        super(
            `${layer} version ${current} is newer than CLI supports (${expected}). ` +
            `Please upgrade noorm.`
        )
        this.name = 'VersionMismatchError'
    }
}


/**
 * Error thrown when a migration fails.
 */
export class MigrationError extends Error {

    constructor(
        public readonly layer: VersionLayer,
        public readonly version: number,
        public override readonly cause: Error
    ) {

        super(`${layer} migration v${version} failed: ${cause.message}`)
        this.name = 'MigrationError'
    }
}
