/**
 * State Version Manager.
 *
 * Manages encrypted state file versions using JSON transformations.
 * The state version is independent of the CLI package version.
 *
 * WHY: Decoupling from package version means:
 * - State can remain stable across CLI updates
 * - Only migrate state when state schema actually changes
 * - Simpler version checking (compare numbers, not semver)
 */
import { observer } from '../../observer.js'
import {
    CURRENT_VERSIONS,
    MigrationError,
    VersionMismatchError,
    type LayerVersionStatus,
    type StateMigration,
} from '../types.js'

// Import migrations
import { v1 } from './migrations/v1.js'


/**
 * All state migrations in order.
 * Add new migrations here as they're created.
 */
const MIGRATIONS: StateMigration[] = [v1]


/**
 * Get state version from state object.
 * Returns 0 if no version field exists (pre-versioned state).
 *
 * @example
 * ```typescript
 * const version = getStateVersion(decryptedState)
 * // version = 2 (or 0 if not versioned)
 * ```
 */
export function getStateVersion(state: Record<string, unknown>): number {

    const version = state['schemaVersion']

    if (typeof version === 'number') return version
    return 0
}


/**
 * Check state version status.
 *
 * @example
 * ```typescript
 * const status = checkStateVersion(decryptedState)
 * if (status.needsMigration) {
 *     const migrated = migrateState(decryptedState)
 * }
 * ```
 */
export function checkStateVersion(
    state: Record<string, unknown>
): LayerVersionStatus {

    const current = getStateVersion(state)
    const expected = CURRENT_VERSIONS.state

    return {
        current,
        expected,
        needsMigration: current < expected,
        isNewer: current > expected,
    }
}


/**
 * Check if state needs migration.
 *
 * @example
 * ```typescript
 * if (needsStateMigration(decryptedState)) {
 *     const migrated = migrateState(decryptedState)
 *     await persistState(migrated)
 * }
 * ```
 */
export function needsStateMigration(state: Record<string, unknown>): boolean {

    const status = checkStateVersion(state)
    return status.needsMigration
}


/**
 * Migrate state from current version to latest.
 *
 * Transforms the state object through each pending migration.
 * Returns a new state object (does not mutate input).
 *
 * @throws VersionMismatchError if state is newer than CLI supports
 * @throws MigrationError if a migration fails
 *
 * @example
 * ```typescript
 * const migrated = migrateState(decryptedState)
 * await persistState(migrated)
 * ```
 */
export function migrateState(
    state: Record<string, unknown>
): Record<string, unknown> {

    const status = checkStateVersion(state)

    // State is newer than CLI supports
    if (status.isNewer) {

        observer.emit('version:mismatch', {
            layer: 'state',
            current: status.current,
            expected: status.expected,
        })

        throw new VersionMismatchError('state', status.current, status.expected)
    }

    // No migration needed
    if (!status.needsMigration) return state

    observer.emit('version:state:migrating', {
        from: status.current,
        to: CURRENT_VERSIONS.state,
    })

    // Run pending migrations
    const pendingMigrations = MIGRATIONS.filter(m => m.version > status.current)
    let migrated = { ...state }

    for (const migration of pendingMigrations) {

        try {

            migrated = migration.up(migrated)
        }
        catch (err) {

            throw new MigrationError('state', migration.version, err as Error)
        }
    }

    // Ensure schemaVersion is set to current
    migrated['schemaVersion'] = CURRENT_VERSIONS.state

    observer.emit('version:state:migrated', {
        from: status.current,
        to: CURRENT_VERSIONS.state,
    })

    return migrated
}


/**
 * Create empty state with current version.
 *
 * @example
 * ```typescript
 * const state = createEmptyVersionedState()
 * // { schemaVersion: 1, identity: null, ... }
 * ```
 */
export function createEmptyVersionedState(): Record<string, unknown> {

    return migrateState({})
}


/**
 * Ensure state is at current version.
 *
 * Returns migrated state if needed, original state if already current.
 *
 * @throws VersionMismatchError if state is newer than CLI supports
 * @throws MigrationError if a migration fails
 */
export function ensureStateVersion(
    state: Record<string, unknown>
): Record<string, unknown> {

    return migrateState(state)
}
