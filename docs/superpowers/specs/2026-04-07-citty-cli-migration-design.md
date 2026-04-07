# CLI Framework Migration: meow → citty


## Summary

Migrate the noorm CLI from `meow` + custom route parser to `citty` for argument parsing and subcommand routing. Separate the Ink/React TUI behind a dedicated `noorm ui` subcommand, fully decoupling the two surfaces. Drop the `-H`/`--headless` flag; all commands run headless by default.


## Motivation

The current CLI (`src/cli/index.tsx`) conflates three concerns in one file:

1. Argument parsing (via `meow`)
2. Custom route parsing (colon/slash/space notations)
3. Mode detection (TUI vs headless via TTY, CI env, flags)

This coupling makes commands hard to reason about. Each subcommand funnels through `RouteParams` and `CliFlags` — two indirection layers that exist only because the TUI and headless mode share the same entry point. The `HANDLERS` registry duplicates metadata citty would track natively (command tree, args, help text).

Citty provides native subcommand nesting, typed args, auto-generated help, and a clean plugin surface. Pairing it with `@bomb.sh/tab` gives us shell tab-completion for free. Moving the TUI behind `noorm ui` collapses the mode-detection logic entirely.


## Goals

- Replace `meow` with `citty` as the CLI framework
- Launch the Ink/React TUI only via `noorm ui`
- Remove `-H`/`--headless` and `-T`/`--tui` flags
- Remove custom route-string parsing (colon, slash, space notations)
- Physically separate TUI (`src/tui/`) from CLI (`src/cli/`)
- Add shell tab-completion via `@bomb.sh/tab`
- Preserve existing command behavior and output formats


## Non-Goals

- Changing any core business logic in `src/core/` or `src/sdk/`
- Changing the TUI's internal architecture (focus system, screens, routing, observer hooks)
- Introducing `@clack/prompts` into command flows (installed for future use, not wired in)
- Deep-linking into TUI screens via `noorm ui <route>`
- Preserving backward compatibility with colon/slash route notations
- Preserving the existing rich markdown help files


## Architecture

### Final Directory Structure

```
src/
├── cli/                        # Citty commands only
│   ├── index.ts                # Root defineCommand + --help interceptor
│   ├── _utils.ts               # withContext, withVaultContext, output helpers
│   ├── change/
│   │   ├── index.ts            # noorm change (parent)
│   │   ├── ff.ts               # noorm change ff
│   │   ├── run.ts              # noorm change run <name>
│   │   ├── revert.ts           # noorm change revert <name>
│   │   └── history.ts          # noorm change history
│   ├── config/
│   │   ├── index.ts
│   │   ├── add.ts
│   │   ├── edit.ts
│   │   ├── rm.ts
│   │   └── use.ts
│   ├── db/
│   │   ├── index.ts
│   │   ├── explore.ts
│   │   ├── teardown.ts
│   │   ├── transfer.ts
│   │   └── truncate.ts
│   ├── lock/
│   │   ├── index.ts
│   │   ├── acquire.ts
│   │   ├── force.ts
│   │   ├── release.ts
│   │   └── status.ts
│   ├── run/
│   │   ├── index.ts
│   │   ├── build.ts
│   │   ├── dir.ts
│   │   ├── file.ts
│   │   ├── inspect.ts
│   │   └── preview.ts
│   ├── vault/
│   │   ├── index.ts
│   │   ├── cp.ts
│   │   ├── init.ts
│   │   ├── list.ts
│   │   ├── propagate.ts
│   │   ├── rm.ts
│   │   └── set.ts
│   ├── mcp/
│   │   ├── index.ts
│   │   ├── init.ts
│   │   └── serve.ts
│   ├── dev/
│   │   ├── index.ts
│   │   ├── test-helpers.ts
│   │   └── test-workers.ts
│   ├── secret.ts               # noorm secret (placeholder)
│   ├── settings.ts             # noorm settings (placeholder)
│   ├── sql.ts                  # noorm sql <query>
│   ├── info.ts                 # noorm info
│   ├── init.ts                 # noorm init
│   ├── update.ts               # noorm update
│   ├── version.ts              # noorm version
│   └── ui.ts                   # noorm ui — launches TUI
│
├── tui/                        # Ink/React TUI, decoupled from CLI
│   ├── app.tsx
│   ├── app-context.tsx
│   ├── observer-context.ts
│   ├── router.tsx
│   ├── focus.tsx
│   ├── keyboard.tsx
│   ├── shutdown.tsx
│   ├── screens.tsx
│   ├── types.ts                # Route, RouteParams, ScreenProps (CLI types deleted)
│   ├── providers/
│   ├── screens/
│   ├── components/
│   ├── hooks/
│   └── utils/
```

The TUI has zero knowledge of citty, args parsing, or the CLI surface. The CLI imports from `../tui/` only in `src/cli/ui.ts`.


### Migration Plan

The filesystem reorganization is two `mv` operations followed by in-place reorganization:

1. `mv src/cli src/tui` — the current `src/cli/` is 90% TUI files; they land in place
2. `mv src/tui/headless src/cli` — the former headless handlers become the new CLI base
3. Reorganize `src/cli/` from flat `domain-action.ts` files into nested `domain/action.ts` directories (via `mv`)
4. Delete `src/tui/index.tsx` (old meow entry point)
5. Delete CLI-specific types from `src/tui/types.ts`: `CliFlags`, `CliMode`, `ParsedCli`
6. Update import paths across both trees

This keeps filesystem churn low and preserves git blame for the files that don't change in content.


### Citty Command Pattern

Each command is a standalone file exporting a `defineCommand` result and an optional `examples` array. No `RouteParams`/`CliFlags` indirection — args are declared natively:

```typescript
// src/cli/change/ff.ts
import { defineCommand } from 'citty';
import { withContext, outputResult, outputError } from '../_utils.js';

const ffCommand = defineCommand({
    meta: {
        name: 'ff',
        description: 'Fast-forward: apply all pending changes',
    },
    args: {
        config: {
            type: 'string',
            alias: ['c'],
            description: 'Use specific configuration',
        },
        force: {
            type: 'boolean',
            alias: ['f'],
            description: 'Skip checksum validation',
        },
        dryRun: {
            type: 'boolean',
            description: 'Preview without executing',
        },
        json: {
            type: 'boolean',
            description: 'Output JSON',
        },
    },
    async run({ args }) {

        const [result, error] = await withContext({
            config: args.config,
            fn: (ctx) => ctx.noorm.changes.ff(),
        });

        if (error) {

            outputError(args, error.message);
            process.exit(1);

        }

        outputResult(args, result, `Fast-forward ${result.status}`);
        process.exit(result.status === 'success' ? 0 : 2);

    },
});

ffCommand.examples = [
    'noorm change ff',
    'noorm change ff -c prod',
    'noorm change ff --dry-run',
    'noorm change ff --force',
];

export default ffCommand;
```

Parent commands (`change/index.ts`) register their subcommands via `subCommands` and typically have no `run` handler:

```typescript
// src/cli/change/index.ts
import { defineCommand } from 'citty';
import ff from './ff.js';
import run from './run.js';
import revert from './revert.js';
import history from './history.js';

export default defineCommand({
    meta: { name: 'change', description: 'Manage schema changes' },
    subCommands: { ff, run, revert, history },
});
```


### Root Command with Help Interceptor

The root `src/cli/index.ts` is the binary entry point. It intercepts `--help`/`-h` to append per-command examples, then delegates to citty:

```typescript
// src/cli/index.ts
import { defineCommand, runMain, renderUsage } from 'citty';
import change from './change/index.js';
import config from './config/index.js';
import db from './db/index.js';
import lock from './lock/index.js';
import run from './run/index.js';
import vault from './vault/index.js';
import mcp from './mcp/index.js';
import dev from './dev/index.js';
import ui from './ui.js';
import sql from './sql.js';
import info from './info.js';
import init from './init.js';
import update from './update.js';
import version from './version.js';
import { version as noormVersion } from '../core/version/index.js';

const main = defineCommand({
    meta: {
        name: 'noorm',
        version: noormVersion,
        description: 'Database schema & changeset manager',
    },
    subCommands: {
        change,
        config,
        db,
        lock,
        run,
        vault,
        mcp,
        dev,
        ui,
        sql,
        info,
        init,
        update,
        version,
    },
});

/**
 * Resolve the target command by walking argv one positional at a time.
 */
async function resolveCommand(root: unknown, argv: string[]): Promise<unknown> {

    let current: unknown = root;

    for (const arg of argv) {

        if (arg.startsWith('-')) break;
        const resolved = typeof current === 'function' ? await current() : current;
        const sub = resolved?.subCommands?.[arg];
        if (!sub) break;
        current = sub;

    }

    return typeof current === 'function' ? await current() : current;

}

const rawArgs = process.argv.slice(2);

if (rawArgs.includes('--help') || rawArgs.includes('-h')) {

    const cmd = await resolveCommand(main, rawArgs);
    const usage = await renderUsage(cmd, main);
    process.stdout.write(usage + '\n');

    if (cmd?.examples?.length) {

        process.stdout.write('\nEXAMPLES\n\n');
        for (const ex of cmd.examples) {

            process.stdout.write('  ' + ex + '\n');

        }
        process.stdout.write('\n');

    }

    process.exit(0);

}

runMain(main);
```

The `examples` property is untyped in citty's definition, so we extend the `CommandDef` type with an optional `examples?: string[]` in a local declaration merging file.


### The `ui` Command

`noorm ui` is the only subcommand that renders the TUI:

```typescript
// src/cli/ui.ts
import { defineCommand } from 'citty';
import { render } from 'ink';
import React from 'react';
import { App } from '../tui/app.js';

export default defineCommand({
    meta: {
        name: 'ui',
        description: 'Launch interactive terminal UI',
    },
    async run() {

        const { waitUntilExit } = render(React.createElement(App));
        await waitUntilExit();

    },
});
```

The `App` component always starts at the home route. No deep-linking.


### `_utils.ts` Helpers

The current `_helpers.ts` takes `flags: CliFlags` and `logger: Logger`. The new `_utils.ts` takes a plain args object with a narrow interface (only the fields each helper needs) and uses `consola` for output:

```typescript
// src/cli/_utils.ts
import { consola } from 'consola';
import type { Kysely } from 'kysely';
import { attempt } from '@logosdx/utils';
import { createContext } from '../sdk/index.js';
import { ensureSchemaVersion, type NoormDatabase } from '../core/version/index.js';
import type { Context } from '../sdk/context.js';

export interface ContextOpts<T> {
    config?: string;
    json?: boolean;
    fn: (ctx: Context<NoormDatabase>) => Promise<T>;
}

export async function withContext<T>(opts: ContextOpts<T>): Promise<[T, null] | [null, Error]> {
    // adapted from _helpers.ts, same shape
}

export function outputResult(
    args: { json?: boolean },
    json: unknown,
    text: string,
): void {

    if (args.json) {

        process.stdout.write(JSON.stringify(json) + '\n');

    }
    else {

        consola.info(text);

    }

}

export function outputError(args: { json?: boolean }, error: string): void {

    if (args.json) {

        process.stdout.write(JSON.stringify({ success: false, error }) + '\n');

    }
    else {

        consola.error(error);

    }

}
```


### Global Flags vs Per-Command Flags

The old CLI had global flags (`--config`, `--json`, `--force`, `--dry-run`, `--yes`) applied to every command. Citty does not support global flags that propagate to subcommands — each command declares its own args.

We'll define shared arg objects in `_utils.ts` and spread them into each command that needs them:

```typescript
// src/cli/_utils.ts
export const sharedArgs = {
    config: { type: 'string', alias: ['c'], description: 'Use specific configuration' },
    json: { type: 'boolean', description: 'Output JSON' },
    force: { type: 'boolean', alias: ['f'], description: 'Force operation' },
    dryRun: { type: 'boolean', description: 'Preview without executing' },
    yes: { type: 'boolean', alias: ['y'], description: 'Skip confirmations' },
} as const;
```

Commands opt in to whichever subset they support.


### MCP Serve — No Special Casing

Currently `mcp serve` is hardcoded to always run headless and keep the event loop alive. With all commands headless by default, it's just a normal citty command whose `run()` awaits a promise that never resolves (the MCP server stays alive on stdio).


### Tab Completion

Install `@bomb.sh/tab` and wire the citty adapter in `src/cli/index.ts`:

```typescript
// src/cli/index.ts (addition)
import tab from '@bomb.sh/tab/citty';

const completion = await tab(main);
// completion.commands is a Map keyed by subcommand name — customize dynamic
// handlers here for options like --config that should autocomplete config names
```

The adapter reads the `main` command tree and registers a `complete` subcommand on it. Users run `noorm complete <shell>` to print a shell completion script, then source that output into their shell config. The `complete` command is added by the adapter itself — we don't write our own file for it.

Dynamic completions (e.g., listing config names at `noorm config use <TAB>`) are optional follow-up work and not part of this migration.


### Binary Entry Point

`packages/cli/noorm.js` remains the Node.js shim that execs the compiled Bun binary. The binary's entry point changes from `src/cli/index.tsx` to `src/cli/index.ts`. The Bun compile command in `scripts/build-binary.mjs` needs its `--root` and entry arguments updated.


## What Gets Deleted

- `meow` dependency
- The old meow entry point (currently `src/cli/index.tsx`) — replaced by `src/cli/index.ts`
- CLI-specific types in `src/tui/types.ts`: `CliFlags`, `CliMode`, `ParsedCli` interfaces
- The old headless helpers (currently `src/cli/headless/_helpers.ts`) — contents migrated to `src/cli/_utils.ts`
- `HeadlessCommand` type, `RouteHandler` type, `HANDLERS` registry
- `parseRouteFromInput()`, `shouldRunHeadless()` functions
- `-H`/`--headless` and `-T`/`--tui` flag definitions
- All `export const help` rich markdown strings in each command file
- `src/core/help-formatter.ts` (`formatHelp()`) — no longer needed
- The `help` command handler (currently `src/cli/headless/help.ts`) — citty handles `--help` natively


## What Gets Added

**Dependencies (new):**

- `citty`
- `consola`
- `@clack/prompts` (installed, not wired in)
- `@bomb.sh/tab`

**Dependencies (removed):**

- `meow`

**New files:**

- `src/cli/index.ts` (root command + help interceptor)
- `src/cli/_utils.ts` (shared helpers, shared args)
- `src/cli/ui.ts`
- `src/cli/complete.ts`
- `src/cli/<domain>/index.ts` files for each subcommand group
- Domain subdirectories as listed above


## Data Flow

### Current Flow (Headless)

```
noorm -H change ff
  → meow parses args
  → parseRouteFromInput() → route: 'change/ff', params: {}
  → shouldRunHeadless() → true
  → HANDLERS['change/ff'].run(params, flags, logger)
  → withContext({ flags, logger, fn })
  → ctx.noorm.changes.ff()
  → logger.info(...) or logger.result(...)
  → process.exit(code)
```

### New Flow

```
noorm change ff
  → citty.runMain(main) parses argv
  → Walks subCommands: main → change → ff
  → ff.run({ args: { config?, force, dryRun, json } })
  → withContext({ config: args.config, fn })
  → ctx.noorm.changes.ff()
  → outputResult(args, result, text) or outputError(args, msg)
  → process.exit(code)
```

Zero indirection between citty's parsed args and the command's logic.

### TUI Flow

```
noorm ui
  → citty.runMain(main) parses argv
  → Walks to ui command
  → ui.run() imports ../tui/app.js
  → render(<App />)
  → waitUntilExit()
```


## Error Handling

Commands use the existing `@logosdx/utils` `attempt()` pattern for all async operations (per project typescript rules). The `_utils.ts` helpers return `[value, error]` tuples; commands check for errors, call `outputError()`, and exit with a non-zero code.

Citty's `runMain` catches uncaught errors and prints usage, which is acceptable for truly unexpected failures. Commands that need custom error formatting handle it themselves before `process.exit`.


## Testing Strategy

### Unit Tests

- `src/cli/_utils.ts`: test `withContext`, `withVaultContext`, `outputResult`, `outputError` with mocked `createContext`. Assert correct exit codes, output shape (text vs JSON), and disconnect is always called.
- `src/cli/index.ts` help interceptor: test `resolveCommand()` walks argv correctly for nested subcommands, leaf commands, and unknown commands. Test examples block renders when `examples` is present and is omitted otherwise.

### Integration Tests

- End-to-end CLI invocations via child_process: `noorm change ff --dry-run -c test`, `noorm config use test`, `noorm --help`, `noorm change --help`, `noorm change ff --help`. Assert exit codes and stdout/stderr match expected output.
- `noorm ui` launches without error (smoke test — don't assert rendering output, just that it doesn't crash on startup).

### Manual Verification

- `noorm <any command> --help` shows citty's auto-generated usage with an optional EXAMPLES block
- Tab completion setup: `noorm complete zsh > ~/.zsh/noorm-completion && source it`
- `noorm -H change ff` fails with "unknown flag" (since -H is gone) — this is expected
- `noorm change:ff` fails (colon notation gone)
- CI detection: `CI=1 noorm change ff` works without special handling (there is no mode to detect)


## Open Questions

None. All decisions confirmed during brainstorming:

- Space-separated subcommands only, no colon/slash compatibility
- `noorm ui` always starts at home, no deep-linking
- Rich markdown help files are dropped in favor of citty's auto-help + optional `examples` arrays
- `@clack/prompts` installed but not wired into commands yet
- Subdirectories (`change/ff.ts`), not flat (`change-ff.ts`)


## Migration Risk

**High surface area:** ~50 command files touched. Risk of subtle behavioral changes (exit codes, output formatting, JSON schemas).

**Mitigation:** Preserve command logic byte-for-byte where possible. Only change the surrounding wrapper (argparse → citty, RouteParams → args). Integration tests catch output regressions.

**Bun single-binary gotcha:** The compiled Bun binary resolves entry paths in unusual ways (see CLAUDE.md → "Bun Single Binary Worker Gotcha"). The new entry `src/cli/index.ts` must be tested as a compiled binary, not just in dev mode.


## Success Criteria

- `noorm` with no args shows top-level `--help` (via citty)
- `noorm <command> --help` shows usage + optional EXAMPLES block
- `noorm ui` launches the TUI
- All current headless commands work with new command paths (e.g., `noorm change ff` instead of `noorm -H change ff`)
- `noorm mcp serve` stays alive and handles JSON-RPC on stdio
- Shell tab-completion works in zsh/bash after setup
- No references to `meow`, `CliFlags`, `HANDLERS`, `parseRouteFromInput`, or `-H` in the codebase
- `src/tui/` has no imports from `src/cli/`
- `src/cli/` imports from `src/tui/` only in `ui.ts`
- Bun single-binary compile succeeds and the binary launches correctly
