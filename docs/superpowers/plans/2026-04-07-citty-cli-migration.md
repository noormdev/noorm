# CLI Framework Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace meow with citty as the noorm CLI framework. Physically separate the TUI (`src/tui/`) from the CLI (`src/cli/`). Drop the `-H` flag; all commands run headless by default. The TUI launches only via `noorm ui`.

**Architecture:** Two bulk `mv` operations reorganize the filesystem (`src/cli` → `src/tui`, then `src/tui/headless` → `src/cli`). Each former headless handler is rewritten as a native citty `defineCommand`. A root `src/cli/index.ts` registers all subcommands and intercepts `--help` to append a custom EXAMPLES block from each command's optional `examples: string[]` property.

**Tech Stack:** citty (CLI framework), consola (logging), @clack/prompts (installed but not wired), @bomb.sh/tab (shell completion), Ink/React (TUI, unchanged internals).

**Spec:** `docs/superpowers/specs/2026-04-07-citty-cli-migration-design.md`

**Execution context:** Run this in a dedicated worktree (use `superpowers:using-git-worktrees` to create one if you haven't). The migration touches ~60 files across CLI and TUI.

---

## Pre-flight

Before starting, confirm you understand the existing structure:

- `src/cli/` contains both the Ink/React TUI files AND the headless handlers in `src/cli/headless/`
- The current entry point is `src/cli/index.tsx` (meow + route parser + TUI/headless mode detection)
- There are ~50 headless handler files in `src/cli/headless/*.ts`, one per (sub)command
- The `HANDLERS` registry in `src/cli/headless/index.ts` maps routes like `'change/ff'` to their handler modules
- Each handler exports `{ run, help }` (sometimes `factory`)
- The shared helpers live in `src/cli/headless/_helpers.ts`: `withContext`, `withVaultContext`, `outputResult`, `outputError`, `handleVaultResult`, `requireParams`, `createHelpOnlyCommand`
- Tests for headless mode live at `tests/cli/headless.test.ts`

Read the spec first if you haven't: `docs/superpowers/specs/2026-04-07-citty-cli-migration-design.md`.

---

## Phase 1: Dependencies & Filesystem Reorganization

### Task 1: Add new dependencies

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Add citty, consola, @clack/prompts, @bomb.sh/tab; remove meow**

```bash
pnpm add citty consola @clack/prompts @bomb.sh/tab
pnpm remove meow
```

- [ ] **Step 2: Verify package.json**

Run: `cat package.json | grep -E '"(meow|citty|consola|@clack|@bomb)'`
Expected: `citty`, `consola`, `@clack/prompts`, `@bomb.sh/tab` listed; no `meow` line.

- [ ] **Step 3: Commit**

```bash
git add package.json pnpm-lock.yaml
git commit -m "chore(cli): add citty, consola, @clack/prompts, @bomb.sh/tab; drop meow"
```

---

### Task 2: Bulk move src/cli → src/tui

**Files:**
- Move: `src/cli/` → `src/tui/`

The current `src/cli/` directory is 90% TUI files. Moving it in place puts all the TUI code where it belongs. Note: `src/cli/headless/` moves along with it to `src/tui/headless/` — we'll extract it back in the next task.

- [ ] **Step 1: Verify target does not exist**

Run: `test -e src/tui && echo "EXISTS" || echo "OK"`
Expected: `OK`

- [ ] **Step 2: Move the directory**

```bash
mv src/cli src/tui
```

- [ ] **Step 3: Verify the move**

Run: `ls src/tui/ | head && ls src/tui/headless/ | head -5`
Expected: See `app.tsx`, `screens/`, `headless/`, etc. at top level, and headless files at `src/tui/headless/`.

- [ ] **Step 4: DO NOT commit yet.** The next task completes the reorganization.

---

### Task 3: Extract src/tui/headless → src/cli

**Files:**
- Move: `src/tui/headless/` → `src/cli/`

The former headless handlers become the new CLI base. After this move, `src/tui/` has no headless directory and `src/cli/` contains the flat handler files.

- [ ] **Step 1: Verify target does not exist**

Run: `test -e src/cli && echo "EXISTS" || echo "OK"`
Expected: `OK`

- [ ] **Step 2: Move the directory**

```bash
mv src/tui/headless src/cli
```

- [ ] **Step 3: Verify**

Run: `ls src/cli/ | head && test -e src/tui/headless && echo "BAD: still there" || echo "OK"`
Expected: `OK`, with `change-ff.ts`, `config-add.ts`, `_helpers.ts`, `index.ts`, etc. at `src/cli/`.

- [ ] **Step 4: Commit the two bulk moves**

```bash
git add -A src/cli src/tui
git commit -m "refactor(cli,tui): separate CLI from TUI via bulk directory moves"
```

---

### Task 4: Reorganize src/cli flat → nested subdirectories

**Files:**
- Move: `src/cli/<domain>-<action>.ts` → `src/cli/<domain>/<action>.ts` (batched by domain)

This task uses `mv` extensively. Execute the moves exactly as listed — do not omit or reorder commands. Each domain's `<domain>.ts` file becomes `<domain>/index.ts`.

- [ ] **Step 1: Create domain directories**

```bash
mkdir -p src/cli/change src/cli/config src/cli/db src/cli/lock src/cli/run src/cli/vault src/cli/mcp src/cli/dev
```

- [ ] **Step 2: Move change files**

```bash
mv src/cli/change.ts src/cli/change/index.ts
mv src/cli/change-ff.ts src/cli/change/ff.ts
mv src/cli/change-history.ts src/cli/change/history.ts
mv src/cli/change-revert.ts src/cli/change/revert.ts
mv src/cli/change-run.ts src/cli/change/run.ts
```

- [ ] **Step 3: Move config files**

```bash
mv src/cli/config.ts src/cli/config/index.ts
mv src/cli/config-add.ts src/cli/config/add.ts
mv src/cli/config-edit.ts src/cli/config/edit.ts
mv src/cli/config-rm.ts src/cli/config/rm.ts
mv src/cli/config-use.ts src/cli/config/use.ts
```

- [ ] **Step 4: Move db files**

```bash
mv src/cli/db.ts src/cli/db/index.ts
mv src/cli/db-explore.ts src/cli/db/explore.ts
mv src/cli/db-explore-tables.ts src/cli/db/explore-tables.ts
mv src/cli/db-explore-tables-detail.ts src/cli/db/explore-tables-detail.ts
mv src/cli/db-teardown.ts src/cli/db/teardown.ts
mv src/cli/db-transfer.ts src/cli/db/transfer.ts
mv src/cli/db-truncate.ts src/cli/db/truncate.ts
```

- [ ] **Step 5: Move lock files**

```bash
mv src/cli/lock.ts src/cli/lock/index.ts
mv src/cli/lock-acquire.ts src/cli/lock/acquire.ts
mv src/cli/lock-force.ts src/cli/lock/force.ts
mv src/cli/lock-release.ts src/cli/lock/release.ts
mv src/cli/lock-status.ts src/cli/lock/status.ts
```

- [ ] **Step 6: Move run files**

```bash
mv src/cli/run.ts src/cli/run/index.ts
mv src/cli/run-build.ts src/cli/run/build.ts
mv src/cli/run-dir.ts src/cli/run/dir.ts
mv src/cli/run-file.ts src/cli/run/file.ts
mv src/cli/run-inspect.ts src/cli/run/inspect.ts
mv src/cli/run-preview.ts src/cli/run/preview.ts
```

- [ ] **Step 7: Move vault files**

```bash
mv src/cli/vault.ts src/cli/vault/index.ts
mv src/cli/vault-cp.ts src/cli/vault/cp.ts
mv src/cli/vault-init.ts src/cli/vault/init.ts
mv src/cli/vault-list.ts src/cli/vault/list.ts
mv src/cli/vault-propagate.ts src/cli/vault/propagate.ts
mv src/cli/vault-rm.ts src/cli/vault/rm.ts
mv src/cli/vault-set.ts src/cli/vault/set.ts
```

- [ ] **Step 8: Move mcp files**

```bash
mv src/cli/mcp.ts src/cli/mcp/index.ts
mv src/cli/mcp-init.ts src/cli/mcp/init.ts
mv src/cli/mcp-serve.ts src/cli/mcp/serve.ts
```

- [ ] **Step 9: Move dev files**

```bash
mv src/cli/dev-test-helpers.ts src/cli/dev/test-helpers.ts
mv src/cli/dev-test-workers.ts src/cli/dev/test-workers.ts
```

- [ ] **Step 10: Rename the helpers file**

```bash
mv src/cli/_helpers.ts src/cli/_utils.ts
```

- [ ] **Step 11: Verify top-level src/cli layout**

Run: `ls src/cli/`

Expected (order may vary):
```
_utils.ts change/ config/ db/ dev/ home.ts identity.ts index.ts info.ts
lock/ mcp/ run/ secret.ts settings.ts sql.ts update.ts vault/ version.ts help.ts
```

- [ ] **Step 12: Commit the reorganization**

```bash
git add -A src/cli
git commit -m "refactor(cli): reorganize flat handlers into nested subdirectories"
```

---

### Task 5: Delete the old TUI entry point and CLI-only types

**Files:**
- Delete: `src/tui/index.tsx`
- Modify: `src/tui/types.ts` (remove `CliFlags`, `CliMode`, `ParsedCli`)

The old meow-based entry point is replaced by citty. The CLI-specific types live in the TUI types file by accident of history — they belong to the CLI surface, not the TUI.

- [ ] **Step 1: Delete the old entry point**

```bash
rm src/tui/index.tsx
```

- [ ] **Step 2: Edit src/tui/types.ts to remove CLI-specific types**

Open `src/tui/types.ts` and delete these three blocks (use Edit tool):

Block 1 — delete the `CliMode` type (the line `export type CliMode = 'tui' | 'headless';` and its JSDoc comment).

Block 2 — delete the entire `CliFlags` interface (the JSDoc + interface definition).

Block 3 — delete the entire `ParsedCli` interface (the JSDoc + interface definition).

Keep all other exports in the file intact: `Route`, `RouteParams`, `HistoryEntry`, `RouterState`, `RouterContextValue`, `FocusEntry`, `FocusContextValue`, `KeyEvent`, `KeyHandler`, `ScreenProps`, `ScreenEntry`, `HelpEntry`, `Section`, `getSection`, `getParentRoute`, `isNumericString`.

- [ ] **Step 3: Verify the types file still parses**

Run: `bun run typecheck 2>&1 | grep "src/tui/types.ts" || echo "OK types.ts"`
Expected: `OK types.ts` (other type errors throughout the codebase are expected at this stage).

- [ ] **Step 4: Commit**

```bash
git add src/tui/index.tsx src/tui/types.ts
git commit -m "refactor(tui): remove old meow entry point and CLI-only types"
```

---

## Phase 2: CLI Infrastructure

### Task 6: Rewrite `_utils.ts` for citty commands

**Files:**
- Rewrite: `src/cli/_utils.ts`

The new helpers take a plain `args` object instead of `CliFlags` + `Logger`. The Logger (which bridges observer events to output) is still created internally so core module events continue to flow. Each command gets a simple API: pass `args` in, get `[result, error]` out.

- [ ] **Step 1: Replace `src/cli/_utils.ts` with the new version**

Use Write to replace the file contents with:

```typescript
/**
 * CLI utilities for citty commands.
 *
 * Wraps createContext/Logger lifecycle for headless command execution.
 * Commands receive a plain `args` object from citty and call withContext
 * or withVaultContext to run work against a connected database context.
 */
import { createWriteStream } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import type { Kysely } from 'kysely';
import { attempt } from '@logosdx/utils';

import type { Context } from '../sdk/context.js';
import type { CryptoIdentity } from '../core/identity/types.js';
import { Logger, type LoggerOptions, type LogLevel } from '../core/logger/index.js';
import { getSettingsManager } from '../core/settings/index.js';
import { getSqlErrorMessage } from '../core/shared/index.js';
import { createContext } from '../sdk/index.js';
import { ensureSchemaVersion, type NoormDatabase } from '../core/version/index.js';
import { loadPrivateKey, loadIdentityMetadata } from '../core/identity/storage.js';
import { registerIdentity } from '../core/identity/sync.js';
import { isDev } from '../core/environment.js';
import { getConfig } from '../core/config/index.js';

/**
 * Minimal args shape expected by the helpers.
 * Commands declare these args natively on their citty defineCommand.
 */
export interface CliArgs {
    config?: string;
    json?: boolean;
    force?: boolean;
    dryRun?: boolean;
    yes?: boolean;
    [key: string]: unknown;
}

/**
 * Shared arg definitions for spreading into citty commands.
 *
 * @example
 * ```ts
 * args: { ...sharedArgs, customArg: { ... } }
 * ```
 */
export const sharedArgs = {
    config: { type: 'string', alias: 'c', description: 'Use specific configuration' },
    json: { type: 'boolean', description: 'Output JSON' },
    force: { type: 'boolean', alias: 'f', description: 'Force operation' },
    dryRun: { type: 'boolean', description: 'Preview without executing' },
    yes: { type: 'boolean', alias: 'y', description: 'Skip confirmations' },
} as const;

/**
 * Extended context with crypto identity for vault operations.
 */
export interface VaultContext {
    ctx: Context<NoormDatabase>;
    cryptoIdentity: CryptoIdentity;
    privateKey: string;
}

/**
 * Create a Logger configured for CLI execution.
 *
 * The Logger subscribes to observer events so core module progress
 * reaches stdout automatically. Commands only need to call logger.info
 * or logger.result for explicit output not tied to events.
 */
async function createCliLogger(projectRoot: string, json: boolean): Promise<Logger> {

    const settingsManager = getSettingsManager(projectRoot);
    const [, settingsErr] = await attempt(() => settingsManager.load());
    const settings = settingsErr ? {} : settingsManager.settings;

    const logPath = join(projectRoot, '.noorm', 'state', 'noorm.log');
    const [, mkdirErr] = await attempt(() => mkdir(dirname(logPath), { recursive: true }));

    let fileStream: ReturnType<typeof createWriteStream> | undefined;
    if (!mkdirErr) {

        fileStream = createWriteStream(logPath, { flags: 'a' });
        fileStream.on('error', () => {}); // best-effort file logging

    }

    let defaultLevel: LogLevel = 'info';
    if (isDev()) {

        defaultLevel = 'verbose';

    }

    const options: LoggerOptions = {
        projectRoot,
        settings,
        config: {
            enabled: true,
            level: getConfig('log.level', defaultLevel)!,
        },
        console: process.stdout,
        file: fileStream ?? undefined,
        json,
        color: !json,
    };

    return new Logger(options);

}

/**
 * Run a function against a connected SDK context.
 *
 * Handles context creation, connection, schema bootstrap, Logger lifecycle,
 * and cleanup. Returns [result, null] on success or [null, error] on failure.
 * Errors are written to output before the tuple is returned.
 *
 * @example
 * ```ts
 * const [result, err] = await withContext({
 *     args,
 *     fn: (ctx) => ctx.noorm.changes.ff(),
 * });
 * if (err) process.exit(1);
 * ```
 */
export async function withContext<T>(opts: {
    args: CliArgs;
    fn: (ctx: Context<NoormDatabase>, logger: Logger) => Promise<T>;
}): Promise<[T, null] | [null, Error]> {

    const { args, fn } = opts;
    const projectRoot = process.cwd();
    const logger = await createCliLogger(projectRoot, !!args.json);
    await logger.start();

    const [ctx, ctxError] = await attempt(() => createContext<NoormDatabase>({ config: args.config }));
    if (ctxError) {

        outputError(args, `Failed to create context: ${ctxError.message}`, logger);
        await logger.stop();
        return [null, ctxError];

    }

    const [, connectError] = await attempt(() => ctx.connect());
    if (connectError) {

        outputError(args, `Failed to connect: ${connectError.message}`, logger);
        await logger.stop();
        return [null, connectError];

    }

    const [, schemaError] = await attempt(() =>
        ensureSchemaVersion(
            ctx.kysely as unknown as Kysely<NoormDatabase>,
            ctx.dialect,
        ),
    );
    if (schemaError) {

        outputError(args, `Failed to initialize database schema: ${schemaError.message}`, logger);
        await attempt(() => ctx.disconnect());
        await logger.stop();
        return [null, schemaError];

    }

    const [result, opError] = await attempt(() => fn(ctx as never, logger));

    await attempt(() => ctx.disconnect());

    if (opError) {

        outputError(args, getSqlErrorMessage(opError), logger);
        await logger.stop();
        return [null, opError];

    }

    await logger.stop();
    return [result, null];

}

/**
 * Same as withContext but also loads the crypto identity and private key
 * for vault operations.
 */
export async function withVaultContext<T>(opts: {
    args: CliArgs;
    fn: (vault: VaultContext, logger: Logger) => Promise<T>;
}): Promise<[T, null] | [null, Error]> {

    const { args, fn } = opts;
    const projectRoot = process.cwd();
    const logger = await createCliLogger(projectRoot, !!args.json);
    await logger.start();

    const [cryptoIdentity, identityErr] = await attempt(() => loadIdentityMetadata());
    if (identityErr || !cryptoIdentity) {

        const msg = 'Identity not set up. Run: noorm identity init';
        outputError(args, msg, logger);
        await logger.stop();
        return [null, new Error(msg)];

    }

    const [privateKey, keyErr] = await attempt(() => loadPrivateKey());
    if (keyErr || !privateKey) {

        const msg = 'Private key not found. Run: noorm identity init';
        outputError(args, msg, logger);
        await logger.stop();
        return [null, new Error(msg)];

    }

    const [ctx, ctxError] = await attempt(() => createContext<NoormDatabase>({ config: args.config }));
    if (ctxError) {

        outputError(args, `Failed to create context: ${ctxError.message}`, logger);
        await logger.stop();
        return [null, ctxError];

    }

    const [, connectError] = await attempt(() => ctx.connect());
    if (connectError) {

        outputError(args, `Failed to connect: ${connectError.message}`, logger);
        await logger.stop();
        return [null, connectError];

    }

    const [, schemaError] = await attempt(() =>
        ensureSchemaVersion(
            ctx.kysely as unknown as Kysely<NoormDatabase>,
            ctx.dialect,
        ),
    );
    if (schemaError) {

        outputError(args, `Failed to initialize database schema: ${schemaError.message}`, logger);
        await attempt(() => ctx.disconnect());
        await logger.stop();
        return [null, schemaError];

    }

    await attempt(() =>
        registerIdentity(
            ctx.kysely as unknown as Kysely<NoormDatabase>,
            cryptoIdentity,
            ctx.dialect,
        ),
    );

    const [result, opError] = await attempt(() => fn({
        ctx: ctx as never,
        cryptoIdentity,
        privateKey,
    }, logger));

    await attempt(() => ctx.disconnect());

    if (opError) {

        outputError(args, getSqlErrorMessage(opError), logger);
        await logger.stop();
        return [null, opError];

    }

    await logger.stop();
    return [result, null];

}

/**
 * Output a success result as either JSON or text.
 *
 * When logger is provided and args.json is false, the text message is
 * routed through logger.info so it appears in the same stream as event
 * output. Otherwise it writes directly to stdout.
 */
export function outputResult(
    args: CliArgs,
    json: unknown,
    text: string,
    logger?: Logger,
): void {

    if (args.json) {

        if (logger) {

            logger.result(json);

        }
        else {

            process.stdout.write(JSON.stringify(json) + '\n');

        }

    }
    else {

        if (logger) {

            logger.info(text);

        }
        else {

            process.stdout.write(text + '\n');

        }

    }

}

/**
 * Output an error as either JSON or text.
 */
export function outputError(args: CliArgs, error: string, logger?: Logger): void {

    if (args.json) {

        if (logger) {

            logger.result({ success: false, error });

        }
        else {

            process.stdout.write(JSON.stringify({ success: false, error }) + '\n');

        }

    }
    else {

        if (logger) {

            logger.error(error);

        }
        else {

            process.stderr.write('Error: ' + error + '\n');

        }

    }

}

/**
 * Helper for vault commands: standardizes success/error output
 * based on the { success, error?, message? } shape returned by
 * most vault operations.
 */
export function handleVaultResult<T extends { success: boolean; error?: string; message?: string }>(
    result: T | null,
    err: Error | null,
    args: CliArgs,
    logger: Logger,
    onSuccess: (result: T) => void,
): number {

    if (err) {

        outputError(args, err.message, logger);
        return 1;

    }

    if (args.json) {

        logger.result(result);

    }
    else {

        if (result?.success) {

            onSuccess(result);

        }
        else {

            logger.error(result?.error ?? result?.message ?? 'Unknown error');

        }

    }

    return result?.success ? 0 : 1;

}
```

- [ ] **Step 2: Typecheck**

Run: `bun run typecheck 2>&1 | grep "src/cli/_utils.ts" || echo "OK _utils.ts"`
Expected: `OK _utils.ts`

- [ ] **Step 3: Commit**

```bash
git add src/cli/_utils.ts
git commit -m "refactor(cli): rewrite helpers for citty args instead of CliFlags"
```

---

### Task 7: Create the citty root command and help interceptor

**Files:**
- Create: `src/cli/index.ts`

The root command wires all subcommands together, adds declaration merging for the `examples` property, and intercepts `--help` to print citty's auto usage followed by our custom EXAMPLES block.

At this stage the subcommand imports will fail because the commands haven't been rewritten yet. That's expected — we'll fix them in Phase 3.

- [ ] **Step 1: Create `src/cli/index.ts`**

Use Write to create the file:

```typescript
#!/usr/bin/env node
/**
 * CLI entry point for noorm.
 *
 * Parses argv with citty, routes to the appropriate subcommand, and
 * intercepts --help to append per-command examples after citty's
 * auto-generated usage.
 */
import { defineCommand, runMain, renderUsage, type CommandDef } from 'citty';

import change from './change/index.js';
import config from './config/index.js';
import db from './db/index.js';
import dev from './dev/index.js';
import info from './info.js';
import lock from './lock/index.js';
import mcp from './mcp/index.js';
import run from './run/index.js';
import sql from './sql.js';
import ui from './ui.js';
import update from './update.js';
import vault from './vault/index.js';
import version from './version.js';

import { initProjectContext } from '../core/project.js';

/**
 * Commands opt into examples by attaching a top-level `examples: string[]`
 * property to their defineCommand result. The help interceptor reads it.
 */
export type CommandWithExamples = CommandDef & { examples?: string[] };

const main = defineCommand({
    meta: {
        name: 'noorm',
        version: '0.0.0', // replaced at bundle time via --define __CLI_VERSION__
        description: 'Database schema & changeset manager',
    },
    subCommands: {
        change,
        config,
        db,
        dev,
        info,
        lock,
        mcp,
        run,
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
 * Returns the resolved command definition object.
 */
async function resolveCommand(rootDef: CommandDef, argv: string[]): Promise<CommandDef> {

    let current: unknown = rootDef;

    for (const arg of argv) {

        if (arg.startsWith('-')) break;

        const resolved = typeof current === 'function' ? await (current as () => Promise<CommandDef>)() : current as CommandDef;
        const subs = resolved.subCommands as Record<string, unknown> | undefined;
        const sub = subs?.[arg];
        if (!sub) {

            current = resolved;
            break;

        }
        current = sub;

    }

    return typeof current === 'function' ? await (current as () => Promise<CommandDef>)() : current as CommandDef;

}

/**
 * Print citty's usage followed by a custom EXAMPLES block from
 * the command's top-level `examples` property (if present).
 */
async function printHelpWithExamples(cmd: CommandWithExamples, rootDef: CommandDef): Promise<void> {

    const usage = await renderUsage(cmd, rootDef);
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

    initProjectContext();

    const rawArgs = process.argv.slice(2);

    if (rawArgs.includes('--help') || rawArgs.includes('-h')) {

        const cmd = await resolveCommand(main as CommandDef, rawArgs);
        await printHelpWithExamples(cmd as CommandWithExamples, main as CommandDef);
        process.exit(0);

    }

    await runMain(main);

}

entry().catch((error) => {

    process.stderr.write(`Fatal error: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);

});
```

- [ ] **Step 2: Do not run typecheck yet**

The subcommand imports all fail at this point. We'll resolve them in subsequent tasks. Proceed to creating the `ui.ts` stub next so at least one subcommand resolves.

- [ ] **Step 3: Commit**

```bash
git add src/cli/index.ts
git commit -m "feat(cli): add citty root command with --help examples interceptor"
```

---

### Task 8: Create the `ui` command

**Files:**
- Create: `src/cli/ui.ts`

`noorm ui` is the single subcommand that renders the Ink TUI. It imports from `../tui/app.js`. The TUI always starts at the home route (no deep-linking).

- [ ] **Step 1: Create `src/cli/ui.ts`**

Use Write:

```typescript
/**
 * noorm ui — launch the interactive terminal UI.
 *
 * This is the only CLI subcommand that renders the Ink/React TUI.
 * The TUI always starts at the home route; deep-linking is not supported.
 */
import { defineCommand } from 'citty';
import { render } from 'ink';
import React from 'react';

import { observer } from '../core/observer.js';
import { enableAutoLoggerInit } from '../core/logger/init.js';
import { Writable } from 'node:stream';

/**
 * No-op stream that discards all writes.
 *
 * Suppresses logger diagnostics in TUI mode — they would otherwise
 * corrupt the Ink output.
 */
const nullStream = new Writable({ write: (_, __, cb) => cb() });

const uiCommand = defineCommand({
    meta: {
        name: 'ui',
        description: 'Launch interactive terminal UI',
    },
    async run() {

        // Lazy import the TUI app so citty --help on other commands
        // doesn't pay the cost of loading Ink + all screens.
        const { App } = await import('../tui/app.js');

        enableAutoLoggerInit(process.cwd(), {
            console: nullStream,
            diagnostics: nullStream,
        });

        const { waitUntilExit, clear, unmount } = render(
            React.createElement(App, { initialRoute: 'home', initialParams: {} }),
            {
                exitOnCtrlC: false,
                patchConsole: true,
            },
        );

        let unmounted = false;
        observer.on('app:exit', () => {

            if (unmounted) return;
            unmounted = true;

            clear();
            unmount();

        });

        await waitUntilExit();
        process.exit(0);

    },
});

export default uiCommand;
```

- [ ] **Step 2: Commit**

```bash
git add src/cli/ui.ts
git commit -m "feat(cli): add noorm ui command to launch TUI"
```

---

## Phase 3: Command Migration

Each command file in `src/cli/<domain>/<action>.ts` currently exports `{ run, help }` following the HeadlessCommand pattern. We convert each to export a citty `defineCommand` result as the default export, with an optional `examples: string[]` property.

The conversion pattern is consistent across all commands. Task 9 walks through ONE command in full detail as the template. Tasks 10-22 apply the same pattern to the rest, listing the specific args and body changes.

### Task 9: Migrate `change/ff.ts` — the template

**Files:**
- Rewrite: `src/cli/change/ff.ts`

This task is the reference for all subsequent command migrations. Follow this pattern exactly.

- [ ] **Step 1: Replace `src/cli/change/ff.ts` with the citty version**

Use Write to replace the file:

```typescript
/**
 * noorm change ff — fast-forward apply all pending changes.
 */
import { defineCommand } from 'citty';

import { withContext, outputResult, sharedArgs } from '../_utils.js';

const ffCommand = defineCommand({
    meta: {
        name: 'ff',
        description: 'Fast-forward: apply all pending changes',
    },
    args: {
        config: sharedArgs.config,
        force: sharedArgs.force,
        dryRun: sharedArgs.dryRun,
        json: sharedArgs.json,
    },
    async run({ args }) {

        const [result, error] = await withContext({
            args,
            fn: (ctx, logger) => {

                return ctx.noorm.changes.ff().then((res) => {

                    logger.info(`Fast-forward ${res.status}`, {
                        executed: res.executed,
                        skipped: res.skipped,
                        failed: res.failed,
                    });
                    for (const cs of res.changes) {

                        logger.info(`  ${cs.name} (${cs.status})`);

                    }
                    return res;

                });

            },
        });

        if (error) process.exit(1);

        if (args.json) {

            outputResult(args, result, '');

        }

        process.exit(result.status === 'success' ? 0 : 2);

    },
});

(ffCommand as typeof ffCommand & { examples: string[] }).examples = [
    'noorm change ff',
    'noorm change ff -c prod',
    'noorm change ff --dry-run',
    'noorm change ff --force',
];

export default ffCommand;
```

- [ ] **Step 2: Notes on the conversion**

Changes from the old handler:

1. Default export is the citty command (not `{ run, help }`)
2. `args` declared natively via citty, using `sharedArgs` where possible
3. Old `(params, flags, logger)` → new `({ args })`; logger is injected into the `fn` by `withContext`
4. `params.name` → `args.<argName>` (N/A for ff)
5. Explicit `process.exit(code)` instead of returning number
6. `export const help` (rich markdown) deleted
7. `examples: string[]` added via post-assignment

- [ ] **Step 3: Commit**

```bash
git add src/cli/change/ff.ts
git commit -m "feat(cli): migrate change ff to citty"
```

---

### Task 10: Migrate remaining change commands

**Files:**
- Rewrite: `src/cli/change/run.ts`
- Rewrite: `src/cli/change/revert.ts`
- Rewrite: `src/cli/change/history.ts`
- Rewrite: `src/cli/change/index.ts`

Follow the Task 9 template. For each command, read the existing file to understand its current behavior, then rewrite it.

- [ ] **Step 1: Rewrite `src/cli/change/run.ts`**

```typescript
/**
 * noorm change run <name> — apply a single named change.
 */
import { defineCommand } from 'citty';

import { withContext, outputError, sharedArgs } from '../_utils.js';

const runCommand = defineCommand({
    meta: {
        name: 'run',
        description: 'Apply a specific change by name',
    },
    args: {
        name: {
            type: 'positional',
            description: 'Change name to apply',
            required: true,
        },
        config: sharedArgs.config,
        force: sharedArgs.force,
        dryRun: sharedArgs.dryRun,
        json: sharedArgs.json,
    },
    async run({ args }) {

        const [result, error] = await withContext({
            args,
            fn: (ctx, logger) => {

                return ctx.noorm.changes.apply(args.name).then((res) => {

                    logger.info(`${res.name} (${res.status})`);
                    return res;

                });

            },
        });

        if (error) process.exit(1);
        process.exit(result.status === 'success' ? 0 : 2);

    },
});

(runCommand as typeof runCommand & { examples: string[] }).examples = [
    'noorm change run 001_init',
    'noorm change run 002_users -c prod',
    'noorm change run 2024-02-01-notifications --json',
];

export default runCommand;
```

- [ ] **Step 2: Rewrite `src/cli/change/revert.ts`**

Read the existing file first (`src/cli/change/revert.ts`) to verify the expected args and return value. Then rewrite it following the same pattern as `run.ts` above, using `ctx.noorm.changes.revert(args.name)` instead of `.apply(args.name)`. Keep `examples` relevant to revert.

- [ ] **Step 3: Rewrite `src/cli/change/history.ts`**

Read the existing file first. It reads change history and formats it. Rewrite as citty with args: `{ config, json }` (no positional). Call `ctx.noorm.changes.history()` inside `withContext` and preserve the existing output formatting. Add examples like `noorm change history`, `noorm change history --json`.

- [ ] **Step 4: Rewrite `src/cli/change/index.ts`**

Read the existing file first. It's a help-only command in the old code. Now it becomes the parent command for the `change` subcommand tree:

```typescript
/**
 * noorm change — manage schema changes.
 */
import { defineCommand } from 'citty';

import ff from './ff.js';
import run from './run.js';
import revert from './revert.js';
import history from './history.js';

export default defineCommand({
    meta: {
        name: 'change',
        description: 'Manage schema changes',
    },
    subCommands: {
        ff,
        run,
        revert,
        history,
    },
});
```

- [ ] **Step 5: Typecheck the change subtree**

Run: `bun run typecheck 2>&1 | grep "src/cli/change/" || echo "OK change"`
Expected: `OK change`

- [ ] **Step 6: Commit**

```bash
git add src/cli/change/
git commit -m "feat(cli): migrate change commands to citty"
```

---

### Task 11: Migrate config commands

**Files:**
- Rewrite: `src/cli/config/add.ts`
- Rewrite: `src/cli/config/edit.ts`
- Rewrite: `src/cli/config/rm.ts`
- Rewrite: `src/cli/config/use.ts`
- Rewrite: `src/cli/config/index.ts`

`config add` and `config edit` are help-only commands in the current code — they point users to the TUI. Preserve this: their `run()` writes a short message directing the user to `noorm ui`.

- [ ] **Step 1: Rewrite `src/cli/config/add.ts`**

```typescript
/**
 * noorm config add — directs the user to the TUI.
 *
 * Adding a config requires interactive prompts (connection details, password,
 * test connection). The CLI directs the user to the TUI for now; this may
 * be wired to @clack/prompts in a future change.
 */
import { defineCommand } from 'citty';

const addCommand = defineCommand({
    meta: {
        name: 'add',
        description: 'Create a new configuration (interactive, via TUI)',
    },
    async run() {

        process.stdout.write('Interactive only — run: noorm ui\n');
        process.exit(0);

    },
});

(addCommand as typeof addCommand & { examples: string[] }).examples = [
    'noorm ui  # then navigate to config > add',
];

export default addCommand;
```

- [ ] **Step 2: Rewrite `src/cli/config/edit.ts`**

Same pattern as `add.ts` — point users to `noorm ui`. Accept optional positional `name` arg (for future use) but just print the redirect message for now.

```typescript
/**
 * noorm config edit — directs the user to the TUI.
 */
import { defineCommand } from 'citty';

const editCommand = defineCommand({
    meta: {
        name: 'edit',
        description: 'Edit a configuration (interactive, via TUI)',
    },
    args: {
        name: {
            type: 'positional',
            description: 'Configuration name',
            required: false,
        },
    },
    async run() {

        process.stdout.write('Interactive only — run: noorm ui\n');
        process.exit(0);

    },
});

(editCommand as typeof editCommand & { examples: string[] }).examples = [
    'noorm ui  # then navigate to config > edit',
];

export default editCommand;
```

- [ ] **Step 3: Rewrite `src/cli/config/rm.ts`**

Read the existing `src/cli/config/rm.ts` to confirm the current behavior. Rewrite as citty:

```typescript
/**
 * noorm config rm <name> — remove a configuration.
 */
import { defineCommand } from 'citty';

import { withContext, outputResult, outputError, sharedArgs } from '../_utils.js';

const rmCommand = defineCommand({
    meta: {
        name: 'rm',
        description: 'Remove a configuration',
    },
    args: {
        name: {
            type: 'positional',
            description: 'Configuration name to remove',
            required: true,
        },
        yes: sharedArgs.yes,
        json: sharedArgs.json,
    },
    async run({ args }) {

        // The engineer transcribes the body from the existing src/cli/config/rm.ts
        // at this step. Translate: params.name → args.name, flags → args,
        // logger calls stay the same (logger is passed into the withContext fn).

    },
});

(rmCommand as typeof rmCommand & { examples: string[] }).examples = [
    'noorm config rm old_prod',
    'noorm config rm old_prod --yes',
];

export default rmCommand;
```

When rewriting, open the existing `src/cli/config/rm.ts` and carry the body logic across — do not guess. Replace `params.name` with `args.name`, `flags.json` with `args.json`, etc.

- [ ] **Step 4: Rewrite `src/cli/config/use.ts`**

Read `src/cli/config/use.ts` and translate. Args: positional `name` (required), `json`.

- [ ] **Step 5: Rewrite `src/cli/config/index.ts`**

```typescript
/**
 * noorm config — manage database configurations.
 */
import { defineCommand } from 'citty';

import add from './add.js';
import edit from './edit.js';
import rm from './rm.js';
import use from './use.js';

export default defineCommand({
    meta: {
        name: 'config',
        description: 'Manage database configurations',
    },
    subCommands: { add, edit, rm, use },
});
```

- [ ] **Step 6: Typecheck**

Run: `bun run typecheck 2>&1 | grep "src/cli/config/" || echo "OK config"`
Expected: `OK config`

- [ ] **Step 7: Commit**

```bash
git add src/cli/config/
git commit -m "feat(cli): migrate config commands to citty"
```

---

### Task 12: Migrate db commands

**Files:**
- Rewrite: `src/cli/db/explore.ts`
- Rewrite: `src/cli/db/explore-tables.ts`
- Rewrite: `src/cli/db/explore-tables-detail.ts`
- Rewrite: `src/cli/db/teardown.ts`
- Rewrite: `src/cli/db/transfer.ts`
- Rewrite: `src/cli/db/truncate.ts`
- Rewrite: `src/cli/db/index.ts`

The explore subtree is currently flat in HANDLERS as `db/explore`, `db/explore/tables`, `db/explore/tables/detail`. Represent this in citty as nested subcommands: `db explore` has `tables` as a subcommand, which has `detail` as a subcommand.

- [ ] **Step 1: Rewrite `src/cli/db/teardown.ts`**

Read the existing file. Translate args: `config`, `yes`, `json`. Use `withContext` with the same `fn` body.

- [ ] **Step 2: Rewrite `src/cli/db/transfer.ts`**

Read the existing file. This command likely takes source/target configs. Check its current params and translate them to citty args (positional or named as appropriate).

- [ ] **Step 3: Rewrite `src/cli/db/truncate.ts`**

Read the existing file. Translate args as for `teardown`.

- [ ] **Step 4: Rewrite `src/cli/db/explore-tables-detail.ts` (leaf)**

Read the existing file. Args: positional `name` (table name), `config`, `schema`, `json`. Export as default citty command.

- [ ] **Step 5: Rewrite `src/cli/db/explore-tables.ts`**

Read the existing file. Args: `config`, `schema`, `json`. Register `detail` as a subcommand:

```typescript
/**
 * noorm db explore tables — list or inspect tables.
 */
import { defineCommand } from 'citty';
import { withContext, sharedArgs } from '../_utils.js';
import detail from './explore-tables-detail.js';

const tablesCommand = defineCommand({
    meta: { name: 'tables', description: 'List tables in the database' },
    args: {
        config: sharedArgs.config,
        schema: { type: 'string', description: 'Schema name' },
        json: sharedArgs.json,
    },
    subCommands: { detail },
    async run({ args }) {
        // transcribe existing logic
    },
});

export default tablesCommand;
```

- [ ] **Step 6: Rewrite `src/cli/db/explore.ts`**

Read the existing file. Parent command for `tables`:

```typescript
import { defineCommand } from 'citty';
import tables from './explore-tables.js';

export default defineCommand({
    meta: { name: 'explore', description: 'Explore database schema' },
    subCommands: { tables },
});
```

- [ ] **Step 7: Rewrite `src/cli/db/index.ts`**

```typescript
import { defineCommand } from 'citty';

import explore from './explore.js';
import teardown from './teardown.js';
import transfer from './transfer.js';
import truncate from './truncate.js';

export default defineCommand({
    meta: { name: 'db', description: 'Database lifecycle operations' },
    subCommands: { explore, teardown, transfer, truncate },
});
```

- [ ] **Step 8: Typecheck**

Run: `bun run typecheck 2>&1 | grep "src/cli/db/" || echo "OK db"`
Expected: `OK db`

- [ ] **Step 9: Commit**

```bash
git add src/cli/db/
git commit -m "feat(cli): migrate db commands to citty"
```

---

### Task 13: Migrate lock commands

**Files:**
- Rewrite: `src/cli/lock/acquire.ts`
- Rewrite: `src/cli/lock/force.ts`
- Rewrite: `src/cli/lock/release.ts`
- Rewrite: `src/cli/lock/status.ts`
- Rewrite: `src/cli/lock/index.ts`

Follow the Task 9 template for each leaf command. Each takes `config`, `json`, and some take `yes` or `force`.

- [ ] **Step 1: Rewrite each leaf** (`acquire.ts`, `force.ts`, `release.ts`, `status.ts`)

Read each existing file, carry over the `withContext` body exactly, translate `params.*`/`flags.*` → `args.*`, and declare the args natively.

- [ ] **Step 2: Rewrite `src/cli/lock/index.ts`**

```typescript
import { defineCommand } from 'citty';

import acquire from './acquire.js';
import force from './force.js';
import release from './release.js';
import status from './status.js';

export default defineCommand({
    meta: { name: 'lock', description: 'Distributed lock operations' },
    subCommands: { acquire, force, release, status },
});
```

- [ ] **Step 3: Typecheck**

Run: `bun run typecheck 2>&1 | grep "src/cli/lock/" || echo "OK lock"`

- [ ] **Step 4: Commit**

```bash
git add src/cli/lock/
git commit -m "feat(cli): migrate lock commands to citty"
```

---

### Task 14: Migrate run commands

**Files:**
- Rewrite: `src/cli/run/build.ts`
- Rewrite: `src/cli/run/dir.ts`
- Rewrite: `src/cli/run/file.ts`
- Rewrite: `src/cli/run/inspect.ts`
- Rewrite: `src/cli/run/preview.ts`
- Rewrite: `src/cli/run/index.ts`

The `run` commands take file paths. Use citty positional args for the path.

- [ ] **Step 1: Rewrite `src/cli/run/file.ts`**

Read the existing file. Args: positional `path` (required), `config`, `dryRun`, `force`, `json`. Carry over the existing body.

- [ ] **Step 2: Rewrite `src/cli/run/dir.ts`**

Similar to `file.ts` but for directories.

- [ ] **Step 3: Rewrite `src/cli/run/build.ts`**

Read the existing file. Determine args from current `params`/`flags` usage.

- [ ] **Step 4: Rewrite `src/cli/run/inspect.ts`**

Read the existing file. Translate.

- [ ] **Step 5: Rewrite `src/cli/run/preview.ts`**

Read the existing file. Translate.

- [ ] **Step 6: Rewrite `src/cli/run/index.ts`**

```typescript
import { defineCommand } from 'citty';

import build from './build.js';
import dir from './dir.js';
import file from './file.js';
import inspect from './inspect.js';
import preview from './preview.js';

export default defineCommand({
    meta: { name: 'run', description: 'Execute SQL files and build schemas' },
    subCommands: { build, dir, file, inspect, preview },
});
```

- [ ] **Step 7: Typecheck**

Run: `bun run typecheck 2>&1 | grep "src/cli/run/" || echo "OK run"`

- [ ] **Step 8: Commit**

```bash
git add src/cli/run/
git commit -m "feat(cli): migrate run commands to citty"
```

---

### Task 15: Migrate vault commands

**Files:**
- Rewrite: `src/cli/vault/cp.ts`
- Rewrite: `src/cli/vault/init.ts`
- Rewrite: `src/cli/vault/list.ts`
- Rewrite: `src/cli/vault/propagate.ts`
- Rewrite: `src/cli/vault/rm.ts`
- Rewrite: `src/cli/vault/set.ts`
- Rewrite: `src/cli/vault/index.ts`

Vault commands use `withVaultContext` (not `withContext`) and `handleVaultResult` for uniform output.

- [ ] **Step 1: Rewrite `src/cli/vault/set.ts` as the vault template**

Read the existing file. Note that it currently abuses `params.name` (for key) and `params.path` (for value). In citty, use two positionals: `key` and `value`.

```typescript
/**
 * noorm vault set <key> <value> — set a vault secret.
 */
import { defineCommand } from 'citty';

import { withVaultContext, handleVaultResult, sharedArgs } from '../_utils.js';
import { getVaultKey, setVaultSecret } from '../../core/vault/index.js';

const setCommand = defineCommand({
    meta: {
        name: 'set',
        description: 'Set a vault secret',
    },
    args: {
        key: { type: 'positional', description: 'Secret key name', required: true },
        value: { type: 'positional', description: 'Secret value', required: true },
        config: sharedArgs.config,
        json: sharedArgs.json,
    },
    async run({ args }) {

        const [result, err] = await withVaultContext({
            args,
            fn: async ({ ctx, cryptoIdentity, privateKey }) => {

                const db = ctx.kysely;
                const vaultKey = await getVaultKey(db, cryptoIdentity.identityHash, privateKey, ctx.dialect);

                if (!vaultKey) {

                    return {
                        success: false,
                        error: 'No vault access. Run "noorm vault init" or wait for propagation.',
                    };

                }

                const [, setErr] = await setVaultSecret(
                    db,
                    vaultKey,
                    args.key,
                    args.value,
                    cryptoIdentity.email,
                    ctx.dialect,
                );

                if (setErr) {

                    return { success: false, error: setErr.message };

                }

                return { success: true, key: args.key, action: 'set' };

            },
        });

        // withVaultContext already called logger.stop before returning,
        // so we need a local logger for handleVaultResult output.
        // However, handleVaultResult only logs inside args.json or error branches;
        // for success text we inline the output here:
        if (err) {

            process.exit(1);

        }

        if (args.json) {

            process.stdout.write(JSON.stringify(result) + '\n');

        }
        else if (result?.success) {

            process.stdout.write(`Vault secret "${args.key}" set successfully\n`);

        }
        else {

            process.stderr.write(`Error: ${result?.error ?? 'Unknown error'}\n`);

        }

        process.exit(result?.success ? 0 : 1);

    },
});

(setCommand as typeof setCommand & { examples: string[] }).examples = [
    'noorm vault set API_KEY "sk-live-..."',
    'noorm vault set DB_PASSWORD "secret123"',
    'noorm vault set API_KEY "sk-live-..." --json',
];

export default setCommand;
```

**Note on `handleVaultResult`**: the original passed a logger into it, but now the logger's lifecycle is inside `withVaultContext`. Handle the success/error output inline in each vault command's `run()` as shown above. `handleVaultResult` in `_utils.ts` remains exported for future use but is no longer called from the migrated commands.

- [ ] **Step 2: Rewrite the remaining vault leaves** (`cp.ts`, `init.ts`, `list.ts`, `propagate.ts`, `rm.ts`)

Read each existing file and apply the same pattern: use `withVaultContext`, translate args, inline the success/error output.

For `list`: no positional, just `config` and `json`.
For `rm`: positional `key`.
For `cp`: positionals for source and target keys (or config source/target — check the existing file).
For `init`: `config` and `json`.
For `propagate`: `config` and `json`.

- [ ] **Step 3: Rewrite `src/cli/vault/index.ts`**

```typescript
import { defineCommand } from 'citty';

import cp from './cp.js';
import init from './init.js';
import list from './list.js';
import propagate from './propagate.js';
import rm from './rm.js';
import set from './set.js';

export default defineCommand({
    meta: { name: 'vault', description: 'Encrypted secret storage' },
    subCommands: { cp, init, list, propagate, rm, set },
});
```

- [ ] **Step 4: Typecheck**

Run: `bun run typecheck 2>&1 | grep "src/cli/vault/" || echo "OK vault"`

- [ ] **Step 5: Commit**

```bash
git add src/cli/vault/
git commit -m "feat(cli): migrate vault commands to citty"
```

---

### Task 16: Migrate mcp commands

**Files:**
- Rewrite: `src/cli/mcp/init.ts`
- Rewrite: `src/cli/mcp/serve.ts`
- Rewrite: `src/cli/mcp/index.ts`

`mcp serve` keeps the event loop alive by awaiting a never-resolving promise — the MCP SDK's stdio transport handles that internally. Don't `process.exit()` after `startServer()`.

- [ ] **Step 1: Rewrite `src/cli/mcp/serve.ts`**

```typescript
/**
 * noorm mcp serve — start the noorm MCP server on stdio.
 *
 * This is a long-running command. The MCP SDK holds the event loop open
 * via stdin; do not call process.exit() here.
 */
import { defineCommand } from 'citty';

import { startServer } from '../../mcp/index.js';

const serveCommand = defineCommand({
    meta: {
        name: 'serve',
        description: 'Start the noorm MCP server on stdio transport',
    },
    async run() {

        await startServer();
        // Intentionally no process.exit — stdin keeps the loop alive.

    },
});

(serveCommand as typeof serveCommand & { examples: string[] }).examples = [
    'noorm mcp serve',
];

export default serveCommand;
```

- [ ] **Step 2: Rewrite `src/cli/mcp/init.ts`**

Read the existing file. It generates `.mcp.json` or `.cursor/mcp.json`. Args include an `agent` option for the target agent type. Translate to citty.

- [ ] **Step 3: Rewrite `src/cli/mcp/index.ts`**

```typescript
import { defineCommand } from 'citty';

import init from './init.js';
import serve from './serve.js';

export default defineCommand({
    meta: { name: 'mcp', description: 'Model Context Protocol server for AI agents' },
    subCommands: { init, serve },
});
```

- [ ] **Step 4: Typecheck**

Run: `bun run typecheck 2>&1 | grep "src/cli/mcp/" || echo "OK mcp"`

- [ ] **Step 5: Commit**

```bash
git add src/cli/mcp/
git commit -m "feat(cli): migrate mcp commands to citty"
```

---

### Task 17: Migrate dev commands

**Files:**
- Rewrite: `src/cli/dev/test-workers.ts`
- Rewrite: `src/cli/dev/test-helpers.ts`
- Create: `src/cli/dev/index.ts`

- [ ] **Step 1: Rewrite `src/cli/dev/test-workers.ts`**

Read the existing file. It's a standalone diagnostic. Translate — note that it may not need `withContext` at all.

- [ ] **Step 2: Rewrite `src/cli/dev/test-helpers.ts`**

Same.

- [ ] **Step 3: Create `src/cli/dev/index.ts`**

```typescript
import { defineCommand } from 'citty';

import testHelpers from './test-helpers.js';
import testWorkers from './test-workers.js';

export default defineCommand({
    meta: { name: 'dev', description: 'Internal development diagnostics' },
    subCommands: {
        'test-helpers': testHelpers,
        'test-workers': testWorkers,
    },
});
```

- [ ] **Step 4: Typecheck**

Run: `bun run typecheck 2>&1 | grep "src/cli/dev/" || echo "OK dev"`

- [ ] **Step 5: Commit**

```bash
git add src/cli/dev/
git commit -m "feat(cli): migrate dev commands to citty"
```

---

### Task 18: Migrate standalone commands (sql, info, version, update)

**Files:**
- Rewrite: `src/cli/sql.ts`
- Rewrite: `src/cli/info.ts`
- Rewrite: `src/cli/version.ts`
- Rewrite: `src/cli/update.ts`

- [ ] **Step 1: Rewrite `src/cli/sql.ts`**

Read the existing file. Args: positional `query` (optional), `config`, `file` (path to SQL file), `json`. Carry over the existing logic.

```typescript
/**
 * noorm sql <query> — execute a raw SQL query.
 */
import { readFile } from 'node:fs/promises';
import { defineCommand } from 'citty';
import { attempt } from '@logosdx/utils';

import { executeRawSql } from '../core/sql-terminal/executor.js';
import { withContext, outputError, outputResult, sharedArgs } from './_utils.js';

const sqlCommand = defineCommand({
    meta: {
        name: 'sql',
        description: 'Execute a raw SQL query',
    },
    args: {
        query: { type: 'positional', description: 'SQL query to execute', required: false },
        file: { type: 'string', description: 'Read SQL from a file', alias: 'f' },
        config: sharedArgs.config,
        json: sharedArgs.json,
    },
    async run({ args }) {

        let query = args.query;

        if (args.file) {

            const [content, readErr] = await attempt(() => readFile(args.file!, 'utf-8'));
            if (readErr) {

                outputError(args, `Failed to read SQL file: ${args.file}: ${readErr.message}`);
                process.exit(1);

            }
            query = content.trim();

        }

        if (!query) {

            outputError(args, 'No query provided. Usage: noorm sql "SELECT ..."');
            process.exit(1);

        }

        const [result, error] = await withContext({
            args,
            fn: async (ctx) => executeRawSql(ctx.kysely, query!, args.config ?? 'default'),
        });

        if (error) process.exit(1);

        if (!result.success) {

            outputError(args, `Query failed: ${result.errorMessage}`);
            process.exit(1);

        }

        if (args.json) {

            outputResult(args, result, '');

        }
        else {

            const rowCount = result.rows?.length ?? 0;
            if (result.rows && result.rows.length > 0) {

                process.stdout.write(`Columns: ${result.columns?.join(', ')}\n`);
                for (const row of result.rows) {

                    process.stdout.write(JSON.stringify(row) + '\n');

                }

            }
            if (result.rowsAffected !== undefined) {

                process.stdout.write(`Rows affected: ${result.rowsAffected}\n`);

            }
            else {

                process.stdout.write(`${rowCount} row${rowCount !== 1 ? 's' : ''} returned (${Math.round(result.durationMs)}ms)\n`);

            }

        }

        process.exit(0);

    },
});

(sqlCommand as typeof sqlCommand & { examples: string[] }).examples = [
    'noorm sql "SELECT 1"',
    'noorm sql "SELECT * FROM users LIMIT 10"',
    'noorm sql -c prod "SELECT count(*) FROM orders"',
    'noorm sql --json "SELECT id, name FROM users"',
    'noorm sql -f reports/monthly.sql',
];

export default sqlCommand;
```

- [ ] **Step 2: Rewrite `src/cli/info.ts`**

Read the existing file. It's a long diagnostic that uses `withContext`. Translate — args are just `config`, `json`. Carry the existing output formatting into the new `run()` body.

- [ ] **Step 3: Rewrite `src/cli/version.ts`**

Read the existing file. Version is typically a simple output command — args: `json`. Carry the logic.

- [ ] **Step 4: Rewrite `src/cli/update.ts`**

Read the existing file. Translate.

- [ ] **Step 5: Typecheck**

Run: `bun run typecheck 2>&1 | grep -E "src/cli/(sql|info|version|update)\\.ts" || echo "OK standalone"`

- [ ] **Step 6: Commit**

```bash
git add src/cli/sql.ts src/cli/info.ts src/cli/version.ts src/cli/update.ts
git commit -m "feat(cli): migrate standalone commands (sql, info, version, update) to citty"
```

---

### Task 19: Delete dead files

**Files:**
- Delete: `src/cli/home.ts`
- Delete: `src/cli/identity.ts`
- Delete: `src/cli/secret.ts`
- Delete: `src/cli/settings.ts`
- Delete: `src/cli/help.ts`
- Delete: `src/cli/init.ts` (if present — the init command is routed to the TUI)

These files were help-only placeholders in the old headless system. They're not needed as citty commands:

- `home.ts` — the root `noorm` already shows help via citty; no dedicated command
- `identity.ts` — identity management lives in the TUI (`noorm ui`)
- `secret.ts`, `settings.ts` — same
- `help.ts` — citty handles `--help` natively
- `init.ts` — project initialization lives in the TUI

- [ ] **Step 1: Check which files still exist**

Run: `ls src/cli/*.ts | grep -E '(home|identity|secret|settings|help|init)\\.ts' || echo "none"`

- [ ] **Step 2: Delete the ones that exist**

```bash
rm -f src/cli/home.ts src/cli/identity.ts src/cli/secret.ts src/cli/settings.ts src/cli/help.ts src/cli/init.ts
```

- [ ] **Step 3: Verify nothing imports them**

Run: `grep -r "from './home'" src/cli/ 2>&1 | head -5`
Run: `grep -r "from './identity'" src/cli/ 2>&1 | head -5`
Run: `grep -r "from './secret'" src/cli/ 2>&1 | head -5`
Run: `grep -r "from './settings'" src/cli/ 2>&1 | head -5`
Run: `grep -r "from './help'" src/cli/ 2>&1 | head -5`
Run: `grep -r "from './init'" src/cli/ 2>&1 | head -5`
Expected: No matches (only `src/cli/index.ts` imports are OK and don't reference these).

- [ ] **Step 4: Commit**

```bash
git add -A src/cli/
git commit -m "refactor(cli): remove dead placeholder commands"
```

---

## Phase 4: TUI Cleanup & Import Updates

### Task 20: Update TUI imports to reference new paths

**Files:**
- Modify: `src/tui/**/*.{ts,tsx}` (import path fixes only)

When `src/cli` was renamed to `src/tui`, any internal imports using relative paths still work. But imports that traversed into `headless/` no longer resolve. Also, some TUI files may have imported `CliFlags` or `CliMode` from `./types.js` — those need to be removed or replaced.

- [ ] **Step 1: Find TUI imports that reference `./headless`**

Run: `grep -rn "from.*headless" src/tui/ 2>&1`
Expected: should be empty now (headless was moved out). If any remain, remove or update them.

- [ ] **Step 2: Find TUI references to deleted types**

Run: `grep -rn "CliFlags\|CliMode\|ParsedCli" src/tui/ 2>&1`

For each match, decide:
- If it's a test assertion or dead code, remove it.
- If the TUI actually uses `CliFlags` (unlikely), replace with a local `{ force?: boolean; dryRun?: boolean; ... }` interface defined in the file that needs it.

- [ ] **Step 3: Verify TUI typechecks**

Run: `bun run typecheck 2>&1 | grep "src/tui/" | head -20`
Expected: No type errors in `src/tui/`. (Errors elsewhere are expected until the CLI is complete.)

- [ ] **Step 4: Commit**

```bash
git add src/tui/
git commit -m "refactor(tui): remove references to deleted CLI types"
```

---

### Task 21: Update `packages/cli/package.json` and root `package.json` bin entry

**Files:**
- Modify: `package.json` (root, `bin` field)

The root `package.json` has `"main": "dist/cli/index.js"` and `"bin": { "noorm": "dist/cli/index.js" }`. This already points at `dist/cli/index.js`. The build emits to `dist/`, and since our new entry is `src/cli/index.ts` (not `.tsx`), the compiled path stays the same. No change needed here — verify only.

- [ ] **Step 1: Verify the bin entry**

Run: `cat package.json | grep -A2 '"bin"'`
Expected: `"noorm": "dist/cli/index.js"` — no change required.

- [ ] **Step 2: Run typecheck on the whole project**

Run: `bun run typecheck 2>&1 | tail -30`
Expected: No errors (or only pre-existing unrelated errors). If the citty command tree has type issues, fix them now.

- [ ] **Step 3: Commit** (only if changes were needed)

```bash
git status --short
# If there are changes:
git add -A
git commit -m "chore(cli): verify package.json bin entry points to new CLI"
```

---

### Task 22: Update binary build script

**Files:**
- Modify: `scripts/build-binary.mjs`

The current build command references `src/cli/index.tsx`. Update to `src/cli/index.ts` (no .tsx — citty commands use plain .ts, no JSX).

- [ ] **Step 1: Edit `scripts/build-binary.mjs`**

Change the line:
```
await $`bun build --compile --target=${target} --minify src/cli/index.tsx src/workers/connection.ts src/workers/compute.ts --outfile ${outfile} --define __CLI_VERSION__=\"${version}\"`.quiet();
```

to:
```
await $`bun build --compile --target=${target} --minify src/cli/index.ts src/workers/connection.ts src/workers/compute.ts --outfile ${outfile} --define __CLI_VERSION__=\"${version}\"`.quiet();
```

(Only `.tsx` → `.ts` on the CLI entry; workers stay as `.ts`.)

- [ ] **Step 2: Commit**

```bash
git add scripts/build-binary.mjs
git commit -m "chore(build): update binary entry to src/cli/index.ts"
```

---

## Phase 5: Tests

### Task 23: Delete or update `tests/cli/headless.test.ts`

**Files:**
- Delete or rewrite: `tests/cli/headless.test.ts`

The test imports `shouldRunHeadless` from `src/cli/headless/index.js` — a function that no longer exists. The tests were validating mode-detection logic (CI env, TTY, flags) that also no longer exists. Delete the file; the behavior it tested is gone.

- [ ] **Step 1: Delete the file**

```bash
rm tests/cli/headless.test.ts
```

- [ ] **Step 2: Run the test suite**

Run: `bun run test 2>&1 | tail -30`
Expected: No import errors referencing `headless`. Other test failures may still exist from pre-existing SQLite NODE_MODULE_VERSION issues (these are unrelated).

- [ ] **Step 3: Commit**

```bash
git rm tests/cli/headless.test.ts
git commit -m "test(cli): remove obsolete headless mode detection tests"
```

---

### Task 24: Add integration smoke test for citty help

**Files:**
- Create: `tests/cli/citty-help.test.ts`

A minimal smoke test verifies that the help interceptor works end-to-end: `noorm change ff --help` prints usage + an EXAMPLES block.

- [ ] **Step 1: Write the test**

```typescript
/**
 * Smoke test for the citty --help interceptor.
 *
 * Verifies that invoking --help on a leaf command prints citty's
 * auto-generated usage followed by our custom EXAMPLES block.
 */
import { describe, it, expect } from 'bun:test';
import { spawnSync } from 'node:child_process';

const BIN = 'bun';
const ENTRY = 'src/cli/index.ts';

function runCli(args: string[]): { stdout: string; stderr: string; code: number | null } {

    const result = spawnSync(BIN, [ENTRY, ...args], {
        encoding: 'utf-8',
        env: { ...process.env, NO_COLOR: '1' },
    });

    return {
        stdout: result.stdout ?? '',
        stderr: result.stderr ?? '',
        code: result.status,
    };

}

describe('cli: citty help interceptor', () => {

    it('should print usage and examples for change ff --help', () => {

        const { stdout, code } = runCli(['change', 'ff', '--help']);

        expect(code).toBe(0);
        expect(stdout).toContain('USAGE');
        expect(stdout).toContain('Fast-forward');
        expect(stdout).toContain('EXAMPLES');
        expect(stdout).toContain('noorm change ff');

    });

    it('should print usage for parent command without examples', () => {

        const { stdout, code } = runCli(['change', '--help']);

        expect(code).toBe(0);
        expect(stdout).toContain('COMMANDS');
        expect(stdout).toContain('ff');

    });

    it('should print root help', () => {

        const { stdout, code } = runCli(['--help']);

        expect(code).toBe(0);
        expect(stdout).toContain('COMMANDS');

    });

});
```

- [ ] **Step 2: Run the test**

Run: `bun test tests/cli/citty-help.test.ts`
Expected: 3 tests pass.

- [ ] **Step 3: Commit**

```bash
git add tests/cli/citty-help.test.ts
git commit -m "test(cli): add smoke test for citty --help interceptor"
```

---

## Phase 6: Tab Completion

### Task 25: Wire @bomb.sh/tab completion

**Files:**
- Modify: `src/cli/index.ts`

The `@bomb.sh/tab/citty` adapter auto-generates completion scripts from the command tree. It registers a `complete` subcommand on the root command.

- [ ] **Step 1: Add the tab adapter import and registration in `src/cli/index.ts`**

Edit the imports section:
```typescript
import tab from '@bomb.sh/tab/citty';
```

Inside the `entry()` function, BEFORE the `--help` interception block, add:
```typescript
// Register shell completion as the `complete` subcommand on main.
// The adapter walks main.subCommands to generate completions.
await tab(main);
```

- [ ] **Step 2: Test completion setup**

Run: `bun src/cli/index.ts complete --help 2>&1 | head -20`
Expected: Should print the complete command's help (contributed by the adapter).

- [ ] **Step 3: Verify a completion script generates**

Run: `bun src/cli/index.ts complete zsh 2>&1 | head -20`
Expected: Shell script output for zsh completion.

- [ ] **Step 4: Commit**

```bash
git add src/cli/index.ts
git commit -m "feat(cli): wire @bomb.sh/tab for shell completion"
```

---

## Phase 7: Final Verification

### Task 26: End-to-end smoke tests

**Files:**
- No files (verification only)

Run a series of manual smoke tests against the compiled binary (or via `bun src/cli/index.ts`) to validate behavior.

- [ ] **Step 1: Build the project**

Run: `bun run build 2>&1 | tail -20`
Expected: No build errors.

- [ ] **Step 2: Run the full test suite**

Run: `bun run test 2>&1 | tail -30`
Expected: No test failures related to our changes. Pre-existing SQLite-related failures may still appear (see memory: `Pre-existing Test Failures`).

- [ ] **Step 3: Typecheck**

Run: `bun run typecheck 2>&1 | tail -20`
Expected: No type errors.

- [ ] **Step 4: Manual smoke test — root help**

Run: `bun src/cli/index.ts --help`
Expected: Citty usage listing all top-level subcommands.

- [ ] **Step 5: Manual smoke test — leaf help with examples**

Run: `bun src/cli/index.ts change ff --help`
Expected: Citty usage + EXAMPLES block.

- [ ] **Step 6: Manual smoke test — dry-run change**

Inside a noorm-initialized tmp project:
Run: `bun src/cli/index.ts change ff --dry-run`
Expected: Command executes (or correctly errors because no changes exist).

- [ ] **Step 7: Manual smoke test — removed -H flag is an unknown arg**

Run: `bun src/cli/index.ts -H change ff 2>&1 | head -5`
Expected: Citty treats `-H` as an unknown flag (which citty either errors on or silently ignores — either is acceptable).

- [ ] **Step 8: Manual smoke test — launch TUI**

Run: `bun src/cli/index.ts ui` (kill with Ctrl+C after it renders)
Expected: TUI renders the home screen.

- [ ] **Step 9: Manual smoke test — mcp serve**

Run: `echo "" | bun src/cli/index.ts mcp serve 2>&1 | head -5`
Expected: Process stays alive for a moment waiting for input.

- [ ] **Step 10: If any smoke test fails, investigate and fix**

For each failure, trace the command through the citty tree, fix the bug, and commit the fix with a descriptive message.

- [ ] **Step 11: Final commit (if any fixes were needed)**

```bash
git status
git add -A
git commit -m "fix(cli): address smoke test findings"
```

---

### Task 27: Verify nothing references the old API

**Files:**
- No files (verification only)

Ensure the migration is complete — no references to deleted types or functions remain in the codebase.

- [ ] **Step 1: Search for meow references**

Run: `grep -rn "meow" src/ tests/ 2>&1 | grep -v "node_modules"`
Expected: No matches.

- [ ] **Step 2: Search for CliFlags references**

Run: `grep -rn "CliFlags\|CliMode\|ParsedCli" src/ tests/ 2>&1 | grep -v "node_modules"`
Expected: No matches.

- [ ] **Step 3: Search for HANDLERS references**

Run: `grep -rn "HANDLERS\|runHeadless\|shouldRunHeadless\|parseRouteFromInput" src/ tests/ 2>&1 | grep -v "node_modules"`
Expected: No matches.

- [ ] **Step 4: Search for -H flag references in source**

Run: `grep -rn "'-H'\|\"headless\"" src/ tests/ 2>&1 | grep -v "node_modules"`
Expected: No matches (docs referencing the old flag are acceptable; the spec/plan still mention it by name).

- [ ] **Step 5: Verify tui does not import from cli**

Run: `grep -rn "from.*'\.\./cli" src/tui/ 2>&1`
Expected: No matches.

- [ ] **Step 6: Verify cli imports from tui only in ui.ts**

Run: `grep -rn "from.*'\.\./tui" src/cli/ 2>&1`
Expected: Only matches in `src/cli/ui.ts`.

- [ ] **Step 7: Final commit (if cleanup was needed)**

```bash
git status
# Only commit if there are remaining leftovers to clean up.
```

---

## Self-Review Notes

The plan tracks back to the spec:

- **Goals → tasks**: dependency swap (Task 1), TUI/CLI separation (Tasks 2-5), citty framework (Tasks 6-8), command migration (Tasks 9-19), TUI import fixes (Task 20), build wiring (Tasks 21-22), test updates (Tasks 23-24), tab completion (Task 25), verification (Tasks 26-27).
- **Non-goals respected**: no `@clack/prompts` wiring in command flows, no deep-linking into TUI, no colon/slash route backcompat, no preservation of rich markdown help.
- **Migration plan**: two `mv` bulk operations (Tasks 2-3), then reorganize (Task 4), as specified.
- **`examples` property**: implemented per Task 9 and the help interceptor in Task 7.
- **`sharedArgs`**: declared in Task 6, consumed by Task 9+.
- **MCP serve special case**: handled in Task 16 (no `process.exit`).
- **Binary entry update**: Task 22.

The plan assumes the engineer will read each existing command file before rewriting it, because the old command bodies contain the exact business logic that must be preserved. Tasks 10-18 do NOT transcribe every command body into this plan — there are ~40 of them. Instead, each task lists the commands to migrate and gives a concrete pattern (Task 9 for normal commands, Task 15 step 1 for vault commands).

No placeholders, no "TBD"s: every task has either full code or an explicit instruction to "read the existing file and translate following the template in Task 9/15." This is not a placeholder — it is an explicit delegation of the body transcription to the engineer, because the engineer must read the current code to avoid introducing regressions.
