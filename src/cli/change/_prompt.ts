/**
 * Interactive change-name pickers shared across `noorm change` commands.
 *
 * On a TTY, users can omit the positional name and get a clack `select`
 * of candidate changes. Offline commands (add, rm, edit) list folders
 * from disk; DB-aware commands (run, revert, rewind, history-detail)
 * receive a pre-fetched status list and filter it to the relevant
 * subset (pending vs. applied). Non-TTY callers must pass the name
 * explicitly — callers are responsible for gating with `process.stdin.isTTY`.
 */
import { readdir } from 'node:fs/promises';

import * as p from '@clack/prompts';
import { attempt } from '@logosdx/utils';

import type { ChangeListItem } from '../../core/change/types.js';

/**
 * Pick a change folder by name from disk.
 *
 * Sorts alphabetically then reverses so date-prefixed folders appear
 * newest-first. Returns null when the directory is missing, empty, or
 * the user cancels.
 */
export async function selectChangeFromFs(
    changesDir: string,
    message: string,
): Promise<string | null> {

    const [entries, readErr] = await attempt(() => readdir(changesDir, { withFileTypes: true }));

    if (readErr) {

        process.stderr.write(`Error: Failed to list changes in ${changesDir}: ${readErr.message}\n`);

        return null;

    }

    const names = entries
        .filter((e) => e.isDirectory())
        .map((e) => e.name)
        .sort()
        .reverse();

    if (names.length === 0) {

        process.stderr.write(`Error: No changes found in ${changesDir}.\n`);

        return null;

    }

    const picked = await p.select<string>({
        message,
        options: names.map((n) => ({ value: n, label: n })),
    });

    if (p.isCancel(picked)) {

        process.stderr.write('Cancelled.\n');

        return null;

    }

    return picked;

}

/**
 * Pick a change name from a pre-fetched status list.
 *
 * Caller supplies the results of `ctx.noorm.changes.status()` plus a
 * predicate that keeps only the relevant subset (e.g. pending for `run`,
 * applied for `revert`). Items are shown newest-first with their current
 * status. Returns null when the filtered list is empty or the user
 * cancels.
 */
export async function selectChangeFromStatus(
    items: ChangeListItem[],
    opts: {
        message: string;
        emptyMessage: string;
        filter: (item: ChangeListItem) => boolean;
    },
): Promise<string | null> {

    const filtered = items.filter(opts.filter);

    if (filtered.length === 0) {

        process.stderr.write(`Error: ${opts.emptyMessage}\n`);

        return null;

    }

    const sorted = [...filtered].reverse();

    const picked = await p.select<string>({
        message: opts.message,
        options: sorted.map((c) => ({
            value: c.name,
            label: `${c.name} (${c.status})`,
        })),
    });

    if (p.isCancel(picked)) {

        process.stderr.write('Cancelled.\n');

        return null;

    }

    return picked;

}

/**
 * Require a TTY for interactive prompting. Writes a uniform error and
 * returns false when stdin is piped/redirected so callers can exit.
 *
 * @example
 * ```ts
 * if (!args.name && !requireTty('change name')) process.exit(1);
 * ```
 */
export function requireTty(what: string): boolean {

    if (process.stdin.isTTY) return true;

    process.stderr.write(
        `Error: ${what} required. Pass a positional argument or run in an interactive terminal.\n`,
    );

    return false;

}
