/**
 * Three-way reconciliation of concurrent state writes.
 *
 * Every mutation is `load -> change in memory -> rewrite the whole file`,
 * so a writer that loaded before another writer committed would overwrite
 * that commit wholesale. Serializing writes alone does not fix it: the
 * second writer still holds a stale snapshot. Reconciling our changes
 * against what is actually on disk does.
 *
 * The comparison is three-way on purpose. Two-way (ours vs theirs) cannot
 * tell "we never touched this key" from "we deleted this key", so it either
 * loses deletes or resurrects them.
 */
import { equals } from '@logosdx/utils';
import type { State } from './types.js';

/** Fields with dedicated reconciliation rules below. */
const KNOWN_FIELDS = new Set([
    'version',
    'schemaVersion',
    'knownUsers',
    'activeConfig',
    'configs',
    'secrets',
    'globalSecrets',
]);

/**
 * Reconcile one flat map: our edits win where we actually edited, their
 * edits survive everywhere else, and a key we removed stays removed.
 */
function mergeMap<T>(
    baseline: Record<string, T>,
    ours: Record<string, T>,
    theirs: Record<string, T>,
): Record<string, T> {

    const merged: Record<string, T> = { ...theirs };

    for (const [key, value] of Object.entries(ours)) {

        if (!equals(value, baseline[key])) {

            merged[key] = value;

        }

    }

    for (const key of Object.keys(baseline)) {

        if (!(key in ours)) {

            delete merged[key];

        }

    }

    return merged;

}

/**
 * Reconcile the two-level secrets map.
 *
 * The outer level is config name and the inner level is secret key. A flat
 * merge of the outer level would drop a sibling secret set concurrently on
 * the same config, which is precisely the reported failure: ten parallel
 * `secret set` calls against one config leaving five secrets.
 */
function mergeSecrets(
    baseline: Record<string, Record<string, string>>,
    ours: Record<string, Record<string, string>>,
    theirs: Record<string, Record<string, string>>,
): Record<string, Record<string, string>> {

    const merged: Record<string, Record<string, string>> = {};
    const names = new Set([...Object.keys(ours), ...Object.keys(theirs)]);

    for (const name of names) {

        const inOurs = name in ours;
        const inTheirs = name in theirs;
        const inBaseline = name in baseline;

        // Present on one side only: it was either added by that side or
        // removed by the other. The baseline says which.
        if (inOurs && !inTheirs) {

            if (!inBaseline) merged[name] = ours[name]!;
            continue;

        }

        if (!inOurs && inTheirs) {

            if (!inBaseline) merged[name] = theirs[name]!;
            continue;

        }

        merged[name] = mergeMap(baseline[name] ?? {}, ours[name]!, theirs[name]!);

    }

    return merged;

}

/**
 * Reconcile our in-memory state against the state currently on disk,
 * using the snapshot we originally loaded to tell our changes apart from
 * theirs.
 *
 * @example
 * ```typescript
 * // Another process wrote state.enc after we loaded it.
 * const reconciled = mergeState(loadedSnapshot, inMemoryState, onDiskState);
 * ```
 */
export function mergeState(baseline: State, ours: State, theirs: State): State {

    const baselineFields = baseline as unknown as Record<string, unknown>;
    const ourFields = ours as unknown as Record<string, unknown>;
    const merged: Record<string, unknown> = { ...theirs };

    // Top-level fields written by a newer build that this one does not
    // model get the same rule as any other value we may or may not have
    // touched.
    for (const [key, value] of Object.entries(ourFields)) {

        if (KNOWN_FIELDS.has(key)) continue;

        if (!equals(value, baselineFields[key])) {

            merged[key] = value;

        }

    }

    for (const key of Object.keys(baselineFields)) {

        if (KNOWN_FIELDS.has(key)) continue;

        if (!(key in ourFields)) {

            delete merged[key];

        }

    }

    return {
        ...merged,
        version: ours.version,

        // Never step a schema version backwards: the higher number has
        // already had its migrations applied to the data.
        schemaVersion: Math.max(ours.schemaVersion, theirs.schemaVersion),

        activeConfig: ours.activeConfig !== baseline.activeConfig
            ? ours.activeConfig
            : theirs.activeConfig,

        configs: mergeMap(baseline.configs, ours.configs, theirs.configs),
        secrets: mergeSecrets(baseline.secrets, ours.secrets, theirs.secrets),
        globalSecrets: mergeMap(baseline.globalSecrets, ours.globalSecrets, theirs.globalSecrets),
        knownUsers: mergeMap(baseline.knownUsers, ours.knownUsers, theirs.knownUsers),
    } as State;

}
