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

import { initProjectContext, setOriginalCwd } from '../core/project.js';
import { loadIdentityFromEnv } from '../core/identity/env.js';
import { setKeyOverride, setIdentityOverride } from '../core/identity/storage.js';

/**
 * Commands opt into examples by attaching a top-level `examples: string[]`
 * property to their defineCommand result. The help interceptor reads it.
 */
export type CommandWithExamples = CommandDef & { examples?: string[] };

/**
 * Zero-cost stand-in for the `complete` subcommand that `@bomb.sh/tab`
 * would otherwise register by walking the entire `subCommands` tree
 * (forcing every lazy thunk below to resolve on every invocation, the
 * exact cost this file exists to avoid). Same meta the adapter itself
 * uses, so `noorm --help` / bare `noorm` list `complete` identically to
 * before. Overwritten in place by the real `tab(main)` call below when
 * the invocation actually is a completion request.
 */
const completeStub = defineCommand({
    meta: {
        name: 'complete',
        description: 'Generate shell completion scripts',
    },
    run() {},
});

declare const __CLI_VERSION__: string;

const main = defineCommand({
    meta: {
        name: 'noorm',
        version: typeof __CLI_VERSION__ !== 'undefined' ? __CLI_VERSION__ : '0.0.0-dev',
        description: 'Database schema & changeset manager. Global: -c, --cwd <path> runs the subcommand in <path> (must precede the subcommand, like git -C).',
    },
    subCommands: {
        change: () => import('./change/index.js').then((m) => m.default),
        ci: () => import('./ci/index.js').then((m) => m.default),
        config: () => import('./config/index.js').then((m) => m.default),
        db: () => import('./db/index.js').then((m) => m.default),
        dev: () => import('./dev/index.js').then((m) => m.default),
        identity: () => import('./identity/index.js').then((m) => m.default),
        info: () => import('./info.js').then((m) => m.default),
        init: () => import('./init.js').then((m) => m.default),
        lock: () => import('./lock/index.js').then((m) => m.default),
        mcp: () => import('./mcp/index.js').then((m) => m.default),
        run: () => import('./run/index.js').then((m) => m.default),
        secret: () => import('./secret/index.js').then((m) => m.default),
        settings: () => import('./settings/index.js').then((m) => m.default),
        sql: () => import('./sql/index.js').then((m) => m.default),
        ui: () => import('./ui.js').then((m) => m.default),
        update: () => import('./update.js').then((m) => m.default),
        vault: () => import('./vault/index.js').then((m) => m.default),
        version: () => import('./version.js').then((m) => m.default),
        complete: completeStub,
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
 * `--help`/`-h`/`--version`/`-v` are already recognized at any position:
 * `entry()` scans for `--help`/`-h` directly (below) and citty's own
 * `runMain` handles a bare `--version`/`-v` before ever reaching
 * `runCommand`. They must pass through `extractGlobalCwd` untouched
 * rather than trip its "unrecognized flag" error.
 */
const BUILTIN_ROOT_FLAGS = new Set(['--help', '-h', '--version', '-v']);

/**
 * Strip `-c <path>` / `--cwd <path>` / `--cwd=<path>` from the argv that
 * precedes the subcommand name — the sole flag with a genuine root-level
 * meaning. Every other flag belongs on the command that uses it and is
 * rejected outright if it appears before the subcommand, for two reasons:
 *
 * 1. `--cwd` is consumed before dispatch: it sets the working directory
 *    everything else (project discovery, config resolution) resolves
 *    against, so it is the CLI's own flag rather than any subcommand's.
 * 2. `-c` already means `--config` after the subcommand (see the
 *    "`--config` / `-c` overload" note in docs/cli/flags.md). Hoisting
 *    any other flag to the root doesn't hit that collision, but it does
 *    reintroduce the asymmetry this function used to have with
 *    `--config`/`--force` — which were never hoisted — for no reason
 *    beyond "why not". A flag goes on the command that uses it.
 *
 * citty forwards only `rawArgs.slice(subCommandArgIndex + 1)` to the
 * resolved subcommand (`node_modules/citty/dist/index.mjs:217`), so any
 * flag before that index is silently dropped before a leaf command's own
 * arg parser ever sees it. Mirrors `git -C <path>` semantics: `--cwd` is
 * only recognized as global when it precedes the subcommand, so a
 * per-command flag of the same short name (`--config -c`) keeps working
 * untouched once seen after it.
 *
 * Any other flag-looking token seen before the subcommand can't be
 * honoured for the same reason an unrecognised flag couldn't — silently
 * forwarding it would be the defect this function exists to avoid — so
 * it is reported as an error instead of being dropped.
 */
function extractGlobalCwd(argv: string[]): { cwd: string | null; rest: string[]; error: null } | { cwd: null; rest: null; error: string } {

    const rest: string[] = [];
    let cwd: string | null = null;
    let seenSubcommand = false;
    let i = 0;

    while (i < argv.length) {

        const arg = argv[i]!;

        if (seenSubcommand || BUILTIN_ROOT_FLAGS.has(arg)) {

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

        return {
            cwd: null,
            rest: null,
            error: `Unrecognized flag '${arg}' before the subcommand — noorm can't forward it there. `
                + 'The only root-level flag is -c/--cwd <path>; every other flag goes on the command that uses it. '
                + `Move '${arg}' after the subcommand instead, e.g. noorm <command> ... ${arg}.`,
        };

    }

    return { cwd, rest, error: null };

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
    const parsedCwd = extractGlobalCwd(rawArgv);

    if (parsedCwd.error !== null) {

        process.stderr.write(`Error: ${parsedCwd.error}\n`);
        process.exit(1);

    }

    const { cwd: explicitCwd, rest: cleanArgv } = parsedCwd;

    if (explicitCwd !== null) {

        const resolvedCwd = resolve(process.cwd(), explicitCwd);

        if (!existsSync(resolvedCwd) || !statSync(resolvedCwd).isDirectory()) {

            process.stderr.write(`Error: --cwd path is not a directory: ${resolvedCwd}\n`);
            process.exit(1);

        }

        setOriginalCwd(process.cwd());
        process.chdir(resolvedCwd);

    }
    else {

        initProjectContext();

    }

    // Both branches funnel through the same reassignment. `cleanArgv` is
    // rawArgv with only the -c/--cwd tokens (if any) removed, so this is
    // a no-op rewrite when --cwd was absent — using it unconditionally
    // keeps one code path instead of two that must stay in sync.
    process.argv = [process.argv[0]!, process.argv[1]!, ...rewriteBareSqlArgv(cleanArgv)];

    // Install env-based identity overrides at process startup so that
    // every downstream loadPrivateKey() / loadIdentityMetadata() call
    // returns the env values without touching ~/.noorm/. Validated by
    // tests/cli/env-bootstrap.test.ts.
    const envIdentity = loadIdentityFromEnv();

    if (envIdentity) {

        setKeyOverride(envIdentity.privateKey);
        setIdentityOverride(envIdentity.identity);

    }

    const rawArgs = process.argv.slice(2);

    // Only walk the entire subCommands tree (resolving every lazy thunk
    // above) when the invocation is actually a completion request. The
    // always-present completeStub above keeps `complete` listed in every
    // other help/usage output at zero resolution cost; tab(main) replaces
    // it in place (same main.subCommands object reference) before runMain
    // dispatches to it.
    if (rawArgs[0] === 'complete') {

        await tab(main);

    }

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
