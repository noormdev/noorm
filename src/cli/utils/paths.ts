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

/**
 * Resolve the absolute changes directory from settings.
 *
 * Uses settings.paths.changes with fallback to 'changes'.
 *
 * @example
 * ```typescript
 * const dir = resolveChangesDir('/project', settings);
 * // '/project/changes' or '/project/custom-changes'
 * ```
 */
export function resolveChangesDir(projectRoot: string, settings: Settings | null): string {

    const changesPath = settings?.paths?.changes ?? 'changes';

    return join(projectRoot, changesPath);

}

/**
 * Resolve the absolute SQL directory from settings.
 *
 * Uses settings.paths.sql with fallback to 'sql'.
 *
 * @example
 * ```typescript
 * const dir = resolveSqlDir('/project', settings);
 * // '/project/sql' or '/project/custom-sql'
 * ```
 */
export function resolveSqlDir(projectRoot: string, settings: Settings | null): string {

    const sqlPath = settings?.paths?.sql ?? 'sql';

    return join(projectRoot, sqlPath);

}
