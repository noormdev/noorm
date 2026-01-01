/**
 * CLI Help System.
 *
 * Provides command-specific help text loaded from files.
 * Uses hierarchical fallback to find the most specific help available.
 *
 * @example
 * ```typescript
 * const help = await getHelp('db/explore/tables/detail')
 * // Tries in order:
 * // 1. help/db-explore-tables-detail.txt
 * // 2. help/db-explore-tables.txt
 * // 3. help/db-explore.txt
 * // 4. help/db.txt
 * // Returns first found, or null
 * ```
 */
import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { attempt } from '@logosdx/utils';

// ─────────────────────────────────────────────────────────────
// Help File Registry
// ─────────────────────────────────────────────────────────────

/**
 * Map of routes to their help file paths (relative to help/ directory).
 *
 * Not all routes need entries - the lookup uses hierarchical fallback.
 * Only add entries for routes that have dedicated help content.
 */
const HELP_REGISTRY: Record<string, string> = {
    // Top-level commands
    'home': 'home.txt',
    'config': 'config.txt',
    'change': 'change.txt',
    'run': 'run.txt',
    'db': 'db.txt',
    'lock': 'lock.txt',
    'settings': 'settings.txt',
    'secret': 'secret.txt',
    'identity': 'identity.txt',

    // Config subcommands
    'config/add': 'config-add.txt',
    'config/edit': 'config-edit.txt',
    'config/use': 'config-use.txt',
    'config/rm': 'config-rm.txt',

    // Change subcommands
    'change/ff': 'change-ff.txt',
    'change/run': 'change-run.txt',
    'change/revert': 'change-revert.txt',
    'change/history': 'change-history.txt',

    // Run subcommands
    'run/build': 'run-build.txt',
    'run/file': 'run-file.txt',
    'run/dir': 'run-dir.txt',

    // DB subcommands
    'db/explore': 'db-explore.txt',
    'db/explore/tables': 'db-explore-tables.txt',
    'db/explore/tables/detail': 'db-explore-tables-detail.txt',
    'db/truncate': 'db-truncate.txt',
    'db/teardown': 'db-teardown.txt',

    // Lock subcommands
    'lock/status': 'lock-status.txt',
    'lock/acquire': 'lock-acquire.txt',
    'lock/release': 'lock-release.txt',
};

// ─────────────────────────────────────────────────────────────
// Help Resolution
// ─────────────────────────────────────────────────────────────

/**
 * Get the help directory path.
 */
function getHelpDir(): string {

    const __dirname = dirname(fileURLToPath(import.meta.url));

    // In dist/cli/help.js, help files are at ../../help/
    return join(__dirname, '..', '..', 'help');

}

/**
 * Find the help file path for a route using hierarchical fallback.
 *
 * Tries the full route first, then progressively shorter prefixes.
 *
 * @example
 * findHelpFile('db/explore/tables/detail/users')
 * // Tries: db/explore/tables/detail/users
 * //        db/explore/tables/detail
 * //        db/explore/tables
 * //        db/explore
 * //        db
 */
function findHelpFile(route: string): string | null {

    const segments = route.split('/');

    // Try from most specific to least specific
    for (let i = segments.length; i > 0; i--) {

        const prefix = segments.slice(0, i).join('/');
        const helpFile = HELP_REGISTRY[prefix];

        if (helpFile) {

            return helpFile;

        }

    }

    return null;

}

/**
 * Load help text for a route.
 *
 * Uses hierarchical fallback to find the most specific help available.
 * Returns null if no help is found.
 */
export async function getHelp(route: string): Promise<string | null> {

    const helpFile = findHelpFile(route);

    if (!helpFile) {

        return null;

    }

    const helpPath = join(getHelpDir(), helpFile);
    const [content, err] = await attempt(() => readFile(helpPath, 'utf-8'));

    if (err) {

        return null;

    }

    return content;

}

/**
 * Get the matched route for help lookup.
 *
 * Useful for showing which help was actually loaded.
 */
export function getHelpMatch(route: string): string | null {

    const segments = route.split('/');

    for (let i = segments.length; i > 0; i--) {

        const prefix = segments.slice(0, i).join('/');

        if (HELP_REGISTRY[prefix]) {

            return prefix;

        }

    }

    return null;

}

/**
 * List all available help topics.
 */
export function listHelpTopics(): string[] {

    return Object.keys(HELP_REGISTRY).sort();

}
