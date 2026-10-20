/**
 * Path resolution utilities for CLI screens.
 *
 * Centralizes the settings-based path resolution pattern used
 * across change, run, and other screens.
 *
 * @example
 * ```typescript
 * const changesDir = resolveChangesDir(projectRoot, settings);
 * const sqlDir = resolveSqlDir(projectRoot, settings);
 * ```
 */
import { join } from 'path';

import type { Settings } from '../../core/settings/types.js';
import { DEFAULT_CHANGES_PATH, DEFAULT_SQL_PATH } from '../../core/settings/defaults.js';

/**
 * Resolve the absolute changes directory from settings.
 *
 * Uses settings.paths.changes with fallback to DEFAULT_CHANGES_PATH.
 *
 * @example
 * ```typescript
 * const dir = resolveChangesDir('/project', settings);
 * // '/project/db/changes' or '/project/custom-changes'
 * ```
 */
export function resolveChangesDir(projectRoot: string, settings: Settings | null): string {

    const changesPath = settings?.paths?.changes ?? DEFAULT_CHANGES_PATH;

    return join(projectRoot, changesPath);

}

/**
 * Resolve the absolute SQL directory from settings.
 *
 * Uses settings.paths.sql with fallback to DEFAULT_SQL_PATH.
 *
 * @example
 * ```typescript
 * const dir = resolveSqlDir('/project', settings);
 * // '/project/db/sql' or '/project/custom-sql'
 * ```
 */
export function resolveSqlDir(projectRoot: string, settings: Settings | null): string {

    const sqlPath = settings?.paths?.sql ?? DEFAULT_SQL_PATH;

    return join(projectRoot, sqlPath);

}
