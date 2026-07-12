#!/usr/bin/env node
/**
 * CLI entry point for noorm.
 *
 * Parses argv with citty, routes to the appropriate subcommand, and
 * intercepts --help to append per-command examples after citty's
 * auto-generated usage.
 */
import { existsSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

import tab from '@bomb.sh/tab/citty';
import { defineCommand, runMain, renderUsage, type CommandDef } from 'citty';

import change from './change/index.js';
import ci from './ci/index.js';
import config from './config/index.js';
import db from './db/index.js';
import dev from './dev/index.js';
import identity from './identity/index.js';
import info from './info.js';
import init from './init.js';
import lock from './lock/index.js';
import mcp from './mcp/index.js';
import run from './run/index.js';
import secret from './secret/index.js';
import settings from './settings/index.js';
import sql from './sql/index.js';
import ui from './ui.js';
import update from './update.js';
import vault from './vault/index.js';
import version from './version.js';

import { initProjectContext, setOriginalCwd } from '../core/project.js';
import { loadIdentityFromEnv } from '../core/identity/env.js';
import { setKeyOverride, setIdentityOverride } from '../core/identity/storage.js';

/**
 * Commands opt into examples by attaching a top-level `examples: string[]`
 * property to their defineCommand result. The help interceptor reads it.
 */
export type CommandWithExamples = CommandDef & { examples?: string[] };

const main = defineCommand({
    meta: {
        name: 'noorm',
        version: '0.0.0', // replaced at bundle time via --define __CLI_VERSION__
        description: 'Database schema & changeset manager. Global: -c, --cwd <path> runs the subcommand in <path> (must precede the subcommand, like git -C).',
    },
    subCommands: {
        change,
        ci,
        config,
        db,
        dev,
        identity,
        info,
        init,
        lock,
        mcp,
        run,
        secret,
        settings,
        sql,
        ui,
        update,
        vault,
        version,
    },
});

/**
 * Walk argv one positional at a time to find the target command.
 *
 * Stops at the first flag (token starting with `-`) or unknown subcommand.
 * Returns the resolved command definition plus the ordered chain of parent
 * command names (root to immediate parent) walked to reach it, so callers
 * can rebuild the full USAGE breadcrumb instead of citty's single-level one.
 */
async function resolveCommand(rootDef: CommandDef, argv: string[]): Promise<{ cmd: CommandDef; parentNames: string[] }> {

    let current: unknown = rootDef;
    const parentNames: string[] = [];

    for (const arg of argv) {

        if (arg.startsWith('-')) break;

        const resolved = typeof current === 'function' ? await (current as () => Promise<CommandDef>)() : current as CommandDef;
        const subs = resolved.subCommands as Record<string, unknown> | undefined;
        const sub = subs?.[arg];
        if (!sub) {

            current = resolved;
            break;

        }

        const meta = await (typeof resolved.meta === 'function' ? resolved.meta() : resolved.meta);
        parentNames.push(meta?.name ?? arg);
        current = sub;

    }

    const cmd = typeof current === 'function' ? await (current as () => Promise<CommandDef>)() : current as CommandDef;

    return { cmd, parentNames };

}

/**
 * Strip `-c <path>` / `--cwd <path>` / `--cwd=<path>` that appear before
 * the first subcommand. Mirrors `git -C <path>` semantics: the flag is only
 * recognized as global when it precedes the subcommand, so per-command
 * aliases (like `--config -c`) keep working after the subcommand token.
 *
 * Returns the resolved cwd (or null) plus argv with global flags removed.
 */
function extractGlobalCwd(argv: string[]): { cwd: string | null; rest: string[] } {

    const rest: string[] = [];
    let cwd: string | null = null;
    let seenSubcommand = false;
    let i = 0;

    while (i < argv.length) {

        const arg = argv[i]!;

        if (seenSubcommand) {

            rest.push(arg);
            i++;
            continue;

        }

        if (!arg.startsWith('-')) {

            seenSubcommand = true;
            rest.push(arg);
            i++;
            continue;

        }

        if (arg === '-c' || arg === '--cwd') {

            const next = argv[i + 1];
            cwd = next ?? null;
            i += 2;
            continue;

        }

        if (arg.startsWith('--cwd=')) {

            cwd = arg.slice('--cwd='.length);
            i++;
            continue;

        }

        rest.push(arg);
        i++;

    }

    return { cwd, rest };

}

/**
 * Heuristic match for SQL-looking tokens.
 *
 * The `noorm sql` parent command has subcommands (`query`, `history`,
 * `clear`, `repl`), so citty interprets `noorm sql "SELECT 1"` as a
 * subcommand named `SELECT 1` and prints "Unknown command". To preserve
 * the natural CLI experience documented for years, we rewrite
 * `['sql', '<sql-looking>']` to `['sql', 'query', '<sql-looking>']`
 * before handing off to citty.
 *
 * Only tokens starting with a common SQL verb (whitespace-tolerant,
 * case-insensitive) match — `sql query` and `sql history` remain
 * untouched. See `src/cli/sql/index.ts` for context.
 */
const SQL_VERBS = [
    'SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MERGE', 'WITH',
    'CREATE', 'DROP', 'ALTER', 'TRUNCATE', 'EXEC', 'EXECUTE',
    'CALL', 'SHOW', 'EXPLAIN', 'GRANT', 'REVOKE', 'COMMENT',
    'PRAGMA', 'VACUUM', 'ANALYZE', 'BEGIN', 'COMMIT', 'ROLLBACK',
    'SAVEPOINT', 'USE',
];

const SQL_VERB_RE = new RegExp(`^\\s*(${SQL_VERBS.join('|')})\\b`, 'i');

function rewriteBareSqlArgv(argv: string[]): string[] {

    const sqlIdx = argv.findIndex((a) => !a.startsWith('-'));

    if (sqlIdx === -1 || argv[sqlIdx] !== 'sql') {

        return argv;

    }

    // Find the next positional after `sql` (skip flags and their values
    // when they take an argument we can't disambiguate — but here we
    // only need to find any SQL-looking positional to know whether to
    // rewrite, since the explicit subcommands like `query`, `history`,
    // `repl`, `clear` will not match SQL_VERB_RE).
    const nextIdx = argv.findIndex((a, i) => i > sqlIdx && !a.startsWith('-'));

    if (nextIdx === -1) return argv;

    const candidate = argv[nextIdx]!;

    if (!SQL_VERB_RE.test(candidate)) return argv;

    // Insert `query` directly after `sql` so that any flags before the
    // SQL token (e.g. `--json`, `-c prod`) are bound to the `query`
    // subcommand's arg parser rather than the parent's (which no
    // longer declares them).
    const rewritten = [...argv];
    rewritten.splice(sqlIdx + 1, 0, 'query');

    return rewritten;

}

/**
 * Print citty's usage followed by a custom EXAMPLES block from
 * the command's top-level `examples` property (if present).
 *
 * citty's renderUsage only concatenates one level (`parent.meta.name + ' ' +
 * cmd.meta.name`), so a synthetic parent joining the full breadcrumb is
 * built here rather than always passing the absolute root command.
 */
async function printHelpWithExamples(cmd: CommandWithExamples, parentNames: string[]): Promise<void> {

    const parent: CommandDef | undefined = parentNames.length > 0
        ? { meta: { name: parentNames.join(' ') } }
        : undefined;

    const usage = await renderUsage(cmd, parent);
    process.stdout.write(usage + '\n');

    if (cmd.examples && cmd.examples.length > 0) {

        process.stdout.write('\nEXAMPLES\n\n');
        for (const ex of cmd.examples) {

            process.stdout.write('  ' + ex + '\n');

        }
        process.stdout.write('\n');

    }

}

/**
 * Entry point.
 *
 * 1. Discover project root and chdir into it
 * 2. Intercept --help before handing off to citty
 * 3. Delegate to runMain
 */
async function entry(): Promise<void> {

    const rawArgv = process.argv.slice(2);
    const { cwd: explicitCwd, rest: cleanArgv } = extractGlobalCwd(rawArgv);

    if (explicitCwd !== null) {

        const resolvedCwd = resolve(process.cwd(), explicitCwd);

        if (!existsSync(resolvedCwd) || !statSync(resolvedCwd).isDirectory()) {

            process.stderr.write(`Error: --cwd path is not a directory: ${resolvedCwd}\n`);
            process.exit(1);

        }

        setOriginalCwd(process.cwd());
        process.chdir(resolvedCwd);
        process.argv = [process.argv[0]!, process.argv[1]!, ...rewriteBareSqlArgv(cleanArgv)];

    }
    else {

        initProjectContext();
        const rewritten = rewriteBareSqlArgv(process.argv.slice(2));
        process.argv = [process.argv[0]!, process.argv[1]!, ...rewritten];

    }

    // Install env-based identity overrides at process startup so that
    // every downstream loadPrivateKey() / loadIdentityMetadata() call
    // returns the env values without touching ~/.noorm/. Validated by
    // tests/cli/env-bootstrap.test.ts.
    const envIdentity = loadIdentityFromEnv();

    if (envIdentity) {

        setKeyOverride(envIdentity.privateKey);
        setIdentityOverride(envIdentity.identity);

    }

    // Register shell completion as the `complete` subcommand on main.
    // The adapter walks main.subCommands to generate completions.
    await tab(main);

    const rawArgs = process.argv.slice(2);

    if (rawArgs.includes('--help') || rawArgs.includes('-h')) {

        const { cmd, parentNames } = await resolveCommand(main as CommandDef, rawArgs);
        await printHelpWithExamples(cmd as CommandWithExamples, parentNames);
        process.exit(0);

    }

    await runMain(main);

}

entry().catch((error) => {

    process.stderr.write(`Fatal error: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);

});
