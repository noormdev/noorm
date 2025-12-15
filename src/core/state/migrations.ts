/**
 * State migration system.
 *
 * Handles upgrading state files when the schema changes between versions.
 * Each migration adds missing fields with sensible defaults.
 *
 * WHY: State schema evolves over time. This ensures users don't lose data
 * when upgrading noorm, and we can add new fields without breaking existing state.
 */
import type { State } from './types.js'
import { observer } from '../observer.js'


/**
 * Migrate state to current version.
 *
 * Ensures all required fields exist with defaults. Updates version stamp.
 *
 * @example
 * ```typescript
 * const migrated = migrateState(loadedState, packageVersion)
 * if (migrated.version !== loadedState.version) {
 *     await persist(migrated)
 * }
 * ```
 */
export function migrateState(state: unknown, currentVersion: string): State {

    if (typeof state !== 'object' || state === null) {

        throw new Error('Invalid state format: expected object')
    }

    const obj = state as Record<string, unknown>
    const previousVersion = obj['version'] as string | undefined

    // Build migrated state with defaults for missing fields
    const migrated: State = {
        version: currentVersion,
        activeConfig: (obj['activeConfig'] as string | null) ?? null,
        configs: (obj['configs'] as Record<string, unknown>) as State['configs'] ?? {},
        secrets: (obj['secrets'] as Record<string, Record<string, string>>) ?? {},
        globalSecrets: (obj['globalSecrets'] as Record<string, string>) ?? {},
    }

    if (previousVersion !== currentVersion) {

        observer.emit('state:migrated', {
            from: previousVersion ?? 'unknown',
            to: currentVersion,
        })
    }

    return migrated
}


/**
 * Check if state needs migration.
 */
export function needsMigration(state: unknown, currentVersion: string): boolean {

    if (typeof state !== 'object' || state === null) return true

    const obj = state as Record<string, unknown>

    // Version mismatch
    if (obj['version'] !== currentVersion) return true

    // Missing required fields
    if (!('globalSecrets' in obj)) return true

    return false
}
