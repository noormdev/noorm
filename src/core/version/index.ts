/**
 * Version Module.
 *
 * Unified version management for schema, state, and settings.
 * Each layer has its own independent version number, separate from CLI package version.
 *
 * WHY: Independent versioning allows:
 * - Stable state/settings while CLI evolves
 * - Targeted migrations (only upgrade what changed)
 * - Gradual rollout of changes across layers
 *
 * @example
 * ```typescript
 * import { VersionManager } from './version'
 *
 * const version = new VersionManager({ projectRoot: process.cwd() })
 *
 * // Check all versions
 * const status = await version.check(db, state, settings)
 *
 * // Migrate as needed
 * await version.ensureCompatible(db, state, settings, cliVersion)
 * ```
 */
import type { Kysely } from 'kysely';

import {
    type VersionStatus,
} from './types.js';
import type { NoormDatabase } from '../shared/tables.js';
import type { Dialect } from '../connection/types.js';
import {
    checkSchemaVersion,
    migrateSchema,
} from './schema/index.js';
import { checkStateVersion, migrateState, getStateVersion } from './state/index.js';
import { checkSettingsVersion, migrateSettings, getSettingsVersion } from './settings/index.js';

// ─────────────────────────────────────────────────────────────
// Version Manager Class
// ─────────────────────────────────────────────────────────────

/**
 * Options for VersionManager.
 */
export interface VersionManagerOptions {
    /** Project root directory */
    projectRoot: string;
}

/**
 * Unified version manager.
 *
 * Coordinates version checking and migrations across all layers.
 *
 * @example
 * ```typescript
 * const manager = new VersionManager({ projectRoot: process.cwd() })
 *
 * // Check status
 * const status = await manager.check(db, state, settings)
 *
 * // Migrate everything
 * const migrated = await manager.ensureCompatible(db, state, settings, '1.0.0')
 * ```
 */
export class VersionManager {

    readonly #projectRoot: string;

    constructor(options: VersionManagerOptions) {

        this.#projectRoot = options.projectRoot;

    }

    /**
     * Check version status for all layers.
     *
     * Does not modify anything - just reports current state.
     */
    async check(
        db: Kysely<NoormDatabase>,
        state: Record<string, unknown>,
        settings: Record<string, unknown>,
    ): Promise<VersionStatus> {

        const schemaStatus = await checkSchemaVersion(db);
        const stateStatus = checkStateVersion(state);
        const settingsStatus = checkSettingsVersion(settings);

        return {
            schema: schemaStatus,
            state: stateStatus,
            settings: settingsStatus,
        };

    }

    /**
     * Ensure all layers are at current version.
     *
     * Runs migrations as needed. Schema is migrated in-place (database).
     * State and settings are returned as new objects.
     * All version numbers are recorded in the database.
     *
     * @throws VersionMismatchError if any layer is newer than CLI supports
     * @throws MigrationError if any migration fails
     */
    async ensureCompatible(
        db: Kysely<NoormDatabase>,
        dialect: Dialect,
        state: Record<string, unknown>,
        settings: Record<string, unknown>,
        cliVersion: string,
    ): Promise<{
        state: Record<string, unknown>;
        settings: Record<string, unknown>;
    }> {

        // Migrate state (returns new object)
        const migratedState = migrateState(state);

        // Migrate settings (returns new object)
        const migratedSettings = migrateSettings(settings);

        // Get migrated versions
        const stateVersion = getStateVersion(migratedState);
        const settingsVersion = getSettingsVersion(migratedSettings);

        // Migrate schema (in-place in database) with state/settings versions
        await migrateSchema(db, dialect, cliVersion, { stateVersion, settingsVersion });

        return {
            state: migratedState,
            settings: migratedSettings,
        };

    }

    /**
     * Check if any layer needs migration.
     */
    async needsMigration(
        db: Kysely<NoormDatabase>,
        state: Record<string, unknown>,
        settings: Record<string, unknown>,
    ): Promise<boolean> {

        const status = await this.check(db, state, settings);

        return (
            status.schema.needsMigration ||
            status.state.needsMigration ||
            status.settings.needsMigration
        );

    }

    /**
     * Check if any layer has version newer than CLI supports.
     */
    async hasNewerVersion(
        db: Kysely<NoormDatabase>,
        state: Record<string, unknown>,
        settings: Record<string, unknown>,
    ): Promise<boolean> {

        const status = await this.check(db, state, settings);

        return status.schema.isNewer || status.state.isNewer || status.settings.isNewer;

    }

    get projectRoot(): string {

        return this.#projectRoot;

    }

}

// ─────────────────────────────────────────────────────────────
// Singleton Instance
// ─────────────────────────────────────────────────────────────

let instance: VersionManager | null = null;

/**
 * Get the singleton VersionManager instance.
 *
 * @example
 * ```typescript
 * const manager = getVersionManager('/path/to/project')
 * const status = await manager.check(db, state, settings)
 * ```
 */
export function getVersionManager(projectRoot?: string): VersionManager {

    if (!instance) {

        instance = new VersionManager({
            projectRoot: projectRoot ?? process.cwd(),
        });

    }

    return instance;

}

/**
 * Reset the singleton instance.
 *
 * Useful for testing or when project root changes.
 */
export function resetVersionManager(): void {

    instance = null;

}

// ─────────────────────────────────────────────────────────────
// Re-exports
// ─────────────────────────────────────────────────────────────

// Types
export {
    CURRENT_VERSIONS,
    VersionMismatchError,
    MigrationError,
    type VersionLayer,
    type VersionStatus,
    type LayerVersionStatus,
    type SchemaMigration,
    type StateMigration,
    type SettingsMigration,
} from './types.js';

// Schema
export {
    checkSchemaVersion,
    migrateSchema,
    ensureSchemaVersion,
    bootstrapSchema,
    tablesExist,
    getSchemaVersion,
    updateVersionRecord,
    getLatestVersionRecord,
} from './schema/index.js';

export type { VersionRecordOptions } from './schema/index.js';

// Re-export shared table types
export { NOORM_TABLES } from '../shared/index.js';

export type {
    NoormTableName,
    NoormDatabase,
    NoormVersionTable,
    NoormChangeTable,
    NoormExecutionsTable,
    NoormLockTable,
    NoormIdentitiesTable,
    NoormVersion,
    NoormChange,
    NoormExecution,
    NoormLock,
    NoormIdentity,
    NewNoormVersion,
    NewNoormChange,
    NewNoormExecution,
    NewNoormLock,
    NewNoormIdentity,
    OperationStatus,
    ChangeType,
    Direction,
    ExecutionStatus,
    FileType,
} from '../shared/index.js';

// State
export {
    checkStateVersion,
    migrateState,
    ensureStateVersion,
    needsStateMigration,
    createEmptyVersionedState,
    getStateVersion,
} from './state/index.js';

// Settings
export {
    checkSettingsVersion,
    migrateSettings,
    ensureSettingsVersion,
    needsSettingsMigration,
    createEmptyVersionedSettings,
    getSettingsVersion,
} from './settings/index.js';
