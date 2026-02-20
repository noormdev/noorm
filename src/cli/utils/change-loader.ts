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

import { discoverChanges } from '../../core/change/parser.js';
import { ChangeHistory } from '../../core/change/history.js';
import { createConnection } from '../../core/connection/factory.js';
import { resolveChangesDir, resolveSqlDir } from './paths.js';

/**
 * Result from loadChangesWithStatus.
 */
export interface ChangesWithStatus {
    changes: Change[];
    statuses: Map<string, ChangeStatus>;
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
): Promise<ChangesWithStatus> {

    const changes = await discoverChanges(
        resolveChangesDir(projectRoot, settings),
        resolveSqlDir(projectRoot, settings),
    );

    const conn = await createConnection(
        activeConfig.connection,
        activeConfigName,
    );
    const db = conn.db as Kysely<NoormDatabase>;

    const history = new ChangeHistory(db, activeConfigName);
    const statuses = await history.getAllStatuses();

    await conn.destroy();

    return { changes, statuses };

}

/**
 * Build a list of pending changes (not applied or reverted), sorted oldest first.
 *
 * Used by ChangeFFScreen and ChangeNextScreen.
 */
export function buildPendingChangeList(
    changes: Change[],
    statuses: Map<string, ChangeStatus>,
): ChangeListItem[] {

    return changes
        .filter((cs) => {

            const status = statuses.get(cs.name);

            return !status || status.status === 'pending' || status.status === 'reverted';

        })
        .map((cs) => ({
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
): ChangeListItem[] {

    return changes
        .filter((cs) => {

            const status = statuses.get(cs.name);

            return status?.status === 'success';

        })
        .map((cs) => {

            const status = statuses.get(cs.name)!;

            return {
                name: cs.name,
                path: cs.path,
                date: cs.date,
                description: cs.description,
                status: 'success' as const,
                appliedAt: status.appliedAt,
                appliedBy: status.appliedBy,
                revertedAt: null,
                errorMessage: null,
                isNew: false,
                orphaned: false,
                changeFiles: cs.changeFiles,
                revertFiles: cs.revertFiles,
            };

        })
        .sort((a, b) => {

            const dateA = a.appliedAt?.getTime() ?? 0;
            const dateB = b.appliedAt?.getTime() ?? 0;

            return dateB - dateA;

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
): ChangeListItem[] {

    const merged: ChangeListItem[] = [];

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
            appliedAt: dbStatus?.appliedAt ?? null,
            appliedBy: dbStatus?.appliedBy ?? null,
            revertedAt: dbStatus?.revertedAt ?? null,
            errorMessage: dbStatus?.errorMessage ?? null,
            isNew: !dbStatus,
            orphaned: false,
        });

    }

    // Add orphaned changes (in DB but not on disk)
    const diskNames: Record<string, true> = {};

    for (const cs of changes) {

        diskNames[cs.name] = true;

    }

    for (const [name, status] of statuses) {

        if (!diskNames[name]) {

            merged.push({
                name,
                path: '',
                date: null,
                description: name,
                status: status.status,
                appliedAt: status.appliedAt,
                appliedBy: status.appliedBy,
                revertedAt: status.revertedAt,
                errorMessage: status.errorMessage,
                isNew: false,
                orphaned: true,
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
