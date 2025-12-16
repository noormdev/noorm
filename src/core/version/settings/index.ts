/**
 * Settings Version Manager.
 *
 * Manages settings.yml file versions using YAML transformations.
 * The settings version is independent of the CLI package version.
 *
 * WHY: Decoupling from package version means:
 * - Settings can remain stable across CLI updates
 * - Only migrate settings when settings schema actually changes
 * - Simpler version checking (compare numbers, not semver)
 */
import { observer } from '../../observer.js'
import {
    CURRENT_VERSIONS,
    MigrationError,
    VersionMismatchError,
    type LayerVersionStatus,
    type SettingsMigration,
} from '../types.js'

// Import migrations
import { v1 } from './migrations/v1.js'


/**
 * All settings migrations in order.
 * Add new migrations here as they're created.
 */
const MIGRATIONS: SettingsMigration[] = [v1]


/**
 * Get settings version from settings object.
 * Returns 0 if no version field exists (pre-versioned settings).
 *
 * @example
 * ```typescript
 * const version = getSettingsVersion(parsedSettings)
 * // version = 2 (or 0 if not versioned)
 * ```
 */
export function getSettingsVersion(settings: Record<string, unknown>): number {

    const version = settings['schemaVersion']

    if (typeof version === 'number') return version
    return 0
}


/**
 * Check settings version status.
 *
 * @example
 * ```typescript
 * const status = checkSettingsVersion(parsedSettings)
 * if (status.needsMigration) {
 *     const migrated = migrateSettings(parsedSettings)
 * }
 * ```
 */
export function checkSettingsVersion(
    settings: Record<string, unknown>
): LayerVersionStatus {

    const current = getSettingsVersion(settings)
    const expected = CURRENT_VERSIONS.settings

    return {
        current,
        expected,
        needsMigration: current < expected,
        isNewer: current > expected,
    }
}


/**
 * Check if settings needs migration.
 *
 * @example
 * ```typescript
 * if (needsSettingsMigration(parsedSettings)) {
 *     const migrated = migrateSettings(parsedSettings)
 *     await persistSettings(migrated)
 * }
 * ```
 */
export function needsSettingsMigration(settings: Record<string, unknown>): boolean {

    const status = checkSettingsVersion(settings)
    return status.needsMigration
}


/**
 * Migrate settings from current version to latest.
 *
 * Transforms the settings object through each pending migration.
 * Returns a new settings object (does not mutate input).
 *
 * @throws VersionMismatchError if settings is newer than CLI supports
 * @throws MigrationError if a migration fails
 *
 * @example
 * ```typescript
 * const migrated = migrateSettings(parsedSettings)
 * await persistSettings(migrated)
 * ```
 */
export function migrateSettings(
    settings: Record<string, unknown>
): Record<string, unknown> {

    const status = checkSettingsVersion(settings)

    // Settings is newer than CLI supports
    if (status.isNewer) {

        observer.emit('version:mismatch', {
            layer: 'settings',
            current: status.current,
            expected: status.expected,
        })

        throw new VersionMismatchError('settings', status.current, status.expected)
    }

    // No migration needed
    if (!status.needsMigration) return settings

    observer.emit('version:settings:migrating', {
        from: status.current,
        to: CURRENT_VERSIONS.settings,
    })

    // Run pending migrations
    const pendingMigrations = MIGRATIONS.filter(m => m.version > status.current)
    let migrated = { ...settings }

    for (const migration of pendingMigrations) {

        try {

            migrated = migration.up(migrated)
        }
        catch (err) {

            throw new MigrationError('settings', migration.version, err as Error)
        }
    }

    // Ensure schemaVersion is set to current
    migrated['schemaVersion'] = CURRENT_VERSIONS.settings

    observer.emit('version:settings:migrated', {
        from: status.current,
        to: CURRENT_VERSIONS.settings,
    })

    return migrated
}


/**
 * Create empty settings with current version.
 *
 * @example
 * ```typescript
 * const settings = createEmptyVersionedSettings()
 * // { schemaVersion: 1 }
 * ```
 */
export function createEmptyVersionedSettings(): Record<string, unknown> {

    return migrateSettings({})
}


/**
 * Ensure settings is at current version.
 *
 * Returns migrated settings if needed, original settings if already current.
 *
 * @throws VersionMismatchError if settings is newer than CLI supports
 * @throws MigrationError if a migration fails
 */
export function ensureSettingsVersion(
    settings: Record<string, unknown>
): Record<string, unknown> {

    return migrateSettings(settings)
}
