/**
 * Change discovery + history status loader.
 *
 * Centralizes the repeated pattern of discovering changes from disk
 * and fetching their execution statuses from the database. Used by
 * nearly every change screen.
 *
 * @example
 * ```typescript
 * const { changes, statuses } = await loadChangesWithStatus(
 *     activeConfig, activeConfigName, settings, projectRoot,
 * );
 * ```
 */
import type { Kysely } from 'kysely';

import type { Config, Settings } from '../../core/index.js';
import type { Change, ChangeStatus, ChangeListItem } from '../../core/change/types.js';
import type { NoormDatabase } from '../../core/shared/index.js';
import type { Direction } from '../../core/shared/tables.js';

import { failureListItem, scanChanges } from '../../core/change/parser.js';
import type { ChangeParseFailure } from '../../core/change/parser.js';
import { isPendingChange } from '../../core/change/types.js';
import { ChangeHistory } from '../../core/change/history.js';
import { readRetiredChanges } from '../../core/change/retirement.js';
import { createConnection } from '../../core/connection/factory.js';
import { resolveChangesDir, resolveSqlDir } from './paths.js';

/**
 * Result from loadChangesWithStatus.
 */
export interface ChangesWithStatus {
    changes: Change[];
    statuses: Map<string, ChangeStatus>;
    retired: ReadonlySet<string>;

    /** Folders on disk that could not be parsed; they must not vanish from the views */
    failures: ChangeParseFailure[];
}

/**
 * Discover changes from disk and fetch their statuses from the database.
 *
 * Handles connection lifecycle internally — creates connection,
 * queries history, and destroys connection.
 *
 * @example
 * ```typescript
 * const { changes, statuses } = await loadChangesWithStatus(
 *     activeConfig, activeConfigName, settings, projectRoot,
 * );
 * const pending = changes.filter(c => !statuses.has(c.name));
 * ```
 */
export async function loadChangesWithStatus(
    activeConfig: Config,
    activeConfigName: string,
    settings: Settings | null,
    projectRoot: string,
    direction: Direction = 'change',
): Promise<ChangesWithStatus> {

    const retired = await readRetiredChanges(projectRoot);
    const { changes, failures } = await scanChanges(
        resolveChangesDir(projectRoot, settings),
        resolveSqlDir(projectRoot, settings),
        { retired, direction },
    );

    const conn = await createConnection(
        activeConfig.connection,
        activeConfigName,
    );
    const db = conn.db as Kysely<NoormDatabase>;

    const history = new ChangeHistory(db, activeConfigName, activeConfig.connection.dialect);
    const statuses = await history.getAllStatuses();

    await conn.destroy();

    return { changes, statuses, failures, retired };

}

/**
 * Build a list of pending changes (not applied or reverted), sorted oldest first.
 *
 * Used by ChangeFFScreen and ChangeNextScreen.
 */
export function buildPendingChangeList(
    changes: Change[],
    statuses: Map<string, ChangeStatus>,
    failures: ChangeParseFailure[] = [],
): ChangeListItem[] {

    const unreadable = failures
        .map((failure) => failureListItem(failure, statuses.get(failure.name)))
        .filter(isPendingChange);

    return changes
        .filter((cs) => {

            const status = statuses.get(cs.name);

            return !status || status.status === 'pending' || status.status === 'reverted';

        })
        .map((cs): ChangeListItem => ({
            name: cs.name,
            path: cs.path,
            date: cs.date,
            description: cs.description,
            status: 'pending' as const,
            appliedAt: null,
            appliedBy: null,
            revertedAt: null,
            errorMessage: null,
            isNew: true,
            orphaned: false,
            changeFiles: cs.changeFiles,
            revertFiles: cs.revertFiles,
        }))
        .concat(unreadable)
        .sort((a, b) => {

            const dateA = a.date?.getTime() ?? 0;
            const dateB = b.date?.getTime() ?? 0;

            return dateA - dateB;

        });

}

/**
 * Build a list of applied changes, sorted newest first (by applied date).
 *
 * Used by ChangeRewindScreen.
 */
export function buildAppliedChangeList(
    changes: Change[],
    statuses: Map<string, ChangeStatus>,
    failures: ChangeParseFailure[],
    retired: ReadonlySet<string>,
): ChangeListItem[] {

    return buildMergedChangeList(changes, statuses, failures, retired)
        .filter((cs) => !cs.orphaned && cs.status === 'success' && cs.appliedAt)
        .sort((a, b) => {

            const byDate = (b.appliedAt?.getTime() ?? 0) - (a.appliedAt?.getTime() ?? 0);

            return byDate || (b.appliedHistoryId ?? 0) - (a.appliedHistoryId ?? 0);

        });

}

/**
 * Build a merged list of all changes with their database status.
 *
 * Includes orphaned changes (in DB but not on disk). Sorted with
 * pending first, then by date descending.
 *
 * Used by ChangeListScreen.
 */
export function buildMergedChangeList(
    changes: Change[],
    statuses: Map<string, ChangeStatus>,
    failures: ChangeParseFailure[] = [],
    retired: ReadonlySet<string> = new Set<string>(),
): ChangeListItem[] {

    const merged: ChangeListItem[] = failures.map((failure) => failureListItem(failure, statuses.get(failure.name)));

    for (const cs of changes) {

        const dbStatus = statuses.get(cs.name);

        merged.push({
            name: cs.name,
            path: cs.path,
            date: cs.date,
            description: cs.description,
            changeFiles: cs.changeFiles,
            revertFiles: cs.revertFiles,
            hasChangelog: cs.hasChangelog,
            status: dbStatus?.status ?? 'pending',
            appliedHistoryId: dbStatus?.appliedHistoryId,
            appliedAt: dbStatus?.appliedAt ?? null,
            appliedBy: dbStatus?.appliedBy ?? null,
            revertedAt: dbStatus?.revertedAt ?? null,
            errorMessage: dbStatus?.errorMessage ?? null,
            isNew: !dbStatus,
            orphaned: false,
        });

    }

    // Add orphaned changes (in DB but not on disk)
    const diskNames = new Set(merged.map((item) => item.name));

    for (const name of new Set([...statuses.keys(), ...retired])) {

        if (!diskNames.has(name)) {

            const status = statuses.get(name);
            const isRetired = retired.has(name);

            merged.push({
                name,
                path: '',
                date: null,
                description: name,
                status: status?.status ?? 'pending',
                appliedAt: status?.appliedAt ?? null,
                appliedBy: status?.appliedBy ?? null,
                appliedHistoryId: status?.appliedHistoryId,
                revertedAt: status?.revertedAt ?? null,
                errorMessage: status?.errorMessage ?? null,
                isNew: !status,
                orphaned: !isRetired,
                ...(isRetired ? { retired: true } : {}),
            });

        }

    }

    merged.sort((a, b) => {

        if (a.status === 'pending' && b.status !== 'pending') return -1;
        if (b.status === 'pending' && a.status !== 'pending') return 1;

        const dateA = a.date?.getTime() ?? 0;
        const dateB = b.date?.getTime() ?? 0;

        return dateB - dateA;

    });

    return merged;

}
