/**
 * State migration system.
 *
 * Handles upgrading state files when the schema changes between versions.
 * Each migration adds missing fields with sensible defaults.
 *
 * WHY: State schema evolves over time. This ensures users don't lose data
 * when upgrading noorm, and we can add new fields without breaking existing state.
 */
import type { State } from './types.js';
import type { KnownUser } from '../identity/types.js';
import { observer } from '../observer.js';

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

        throw new Error('Invalid state format: expected object');

    }

    const obj = state as Record<string, unknown>;
    const previousVersion = obj['version'] as string | undefined;

    // schemaVersion is owned by the schema-version migration (core/version/state),
    // which runs before this function and stamps it onto the input record;
    // carry it through rather than dropping it as an unrecognized field.
    // Falls back to 0 (unversioned) for callers that skip that stage.
    const schemaVersion = typeof obj['schemaVersion'] === 'number' ? obj['schemaVersion'] : 0;

    // `identity` is the one field deliberately dropped rather than carried:
    // it moved to ~/.noorm/ and pre-move state files hold key material in
    // it, so re-persisting it would keep a private key in state.enc forever.
    const { identity: _legacyIdentity, ...carried } = obj;

    // Everything else unknown is carried through. Rebuilding from a fixed
    // allowlist made an older binary silently destroy any top-level field a
    // newer one had added, and the truncated object was persisted straight
    // back — so the loss was permanent the first time a downgrade ran.
    const migrated: State = {
        ...carried,
        version: currentVersion,
        schemaVersion,
        knownUsers: (obj['knownUsers'] as Record<string, KnownUser>) ?? {},
        activeConfig: (obj['activeConfig'] as string | null) ?? null,
        configs: (obj['configs'] as Record<string, unknown> as State['configs']) ?? {},
        secrets: (obj['secrets'] as Record<string, Record<string, string>>) ?? {},
        globalSecrets: (obj['globalSecrets'] as Record<string, string>) ?? {},
    };

    if (previousVersion !== currentVersion) {

        observer.emit('state:migrated', {
            from: previousVersion ?? 'unknown',
            to: currentVersion,
        });

    }

    return migrated;

}

/**
 * Check if state needs migration.
 */
export function needsMigration(state: unknown, currentVersion: string): boolean {

    if (typeof state !== 'object' || state === null) return true;

    const obj = state as Record<string, unknown>;

    // Version mismatch
    if (obj['version'] !== currentVersion) return true;

    // Missing required fields (add new fields here as they're added).
    // Only fields `migrateState` actually writes belong here — a field it
    // never writes makes this predicate permanently true, turning every
    // load into a full re-encrypt and rewrite of state.enc.
    if (!('globalSecrets' in obj)) return true;
    if (!('knownUsers' in obj)) return true;

    return false;

}
