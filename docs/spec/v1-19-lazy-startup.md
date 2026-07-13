# Spec: Lazy CLI startup — defer Ink/React and the command tree

Ticket: `tickets/v1/19-lazy-cli-startup.md` (pre-v1, effort M).
Findings: QL-perf-01, QL-perf-02, `research/v1-audit/quality-lenses/startup-cost.md`.

**Stacked branch.** Base is `v1/05-help-breadcrumb` @ `dda8187` (NOT master) — ticket 05
reworked `resolveCommand()` in `src/cli/index.ts` (parent-chain threading for the
`--help` breadcrumb) in the same file this spec modifies. This branch stacks on 05 to
avoid a conflict and build on its `resolveCommand()`. Worktree:
`.worktrees/v1-19-lazy-startup` on branch `v1/19-lazy-startup`. Diff review is scoped
to this branch's delta on top of 05's HEAD (`dda8187`), not the full history.


## Goal

Headless/CI invocations (`noorm --version`, `noorm change list`, `noorm db explore`,
etc.) pay the Ink/React TUI's import bill even though they never touch the TUI.
Root causes (both confirmed in `research/v1-audit/quality-lenses/startup-cost.md`):

- **QL-perf-02** (root cause): `src/cli/index.ts` statically imports all 18 command
  modules and passes them as already-resolved values in `subCommands`. `await
  tab(main)` then runs unconditionally on every invocation, recursively resolving
  every subcommand in the tree (via `@bomb.sh/tab`'s completion-metadata walker) even
  when the invocation isn't a completion request.
- **QL-perf-01**: `src/cli/ui.ts:10-11` and `src/cli/sql/repl.ts:15-16` import `ink`
  and `react` at module top level, despite a comment claiming laziness (only the
  `App` component is behind a real dynamic `import()`). Because `ui.ts` and
  `sql/repl.ts` (via `sql/index.ts`) are statically imported from `index.ts`, Ink +
  React (+ yoga-layout, ansi-escapes, cli-cursor) load unconditionally on every
  invocation — measured ~75-85% of the 0.13-0.14s warm `--version` cost.

Both land together: QL-perf-02 makes command modules lazy so most invocations never
touch `ui.ts`/`sql/repl.ts` at all; QL-perf-01 additionally defers `ink`/`react`
*within* those two files so that even resolving their module (e.g. for `noorm ui
--help`, or `noorm --help`'s root command listing, both of which do load the module
to read its `meta`) doesn't pay the Ink/React cost — only actually calling `run()`
does.


## Contract

### 1. Lazy command thunks (`src/cli/index.ts`, QL-perf-02)

Replace the 18 static top-of-file imports (`change` through `version`) with dynamic
thunks directly in the `subCommands` object literal:

    subCommands: {
        change: () => import('./change/index.js').then((m) => m.default),
        ci: () => import('./ci/index.js').then((m) => m.default),
        // ...same pattern for the remaining 16, same order as today
    },

This is exactly the `Resolvable<CommandDef>` shape (`() => Promise<T>`) citty's own
`runCommand`/`resolveSubCommand`/`_findSubCommand` already resolve via
`resolveValue()` (`node_modules/citty/dist/index.mjs`) — confirmed: `_findSubCommand`
resolves only the *matched* subcommand by name, never the whole tree, so citty's own
dispatch path already only loads what's invoked. `resolveCommand()` (this file,
enhanced by ticket 05) also already handles the thunk shape (`typeof current ===
'function' ? await (current as () => Promise<CommandDef>)() : ...`) — no change
needed there.

### 2. Gate `await tab(main)` behind actual completion requests (QL-perf-02)

`@bomb.sh/tab`'s adapter (`node_modules/@bomb.sh/tab/dist/citty.mjs`) recursively
walks the *entire* `subCommands` tree to build shell-completion metadata, forcing
every thunk in the tree to resolve — the thing (1) exists to avoid. Only run it when
the invocation is actually a completion request:

    const rawArgs = process.argv.slice(2);

    if (rawArgs[0] === 'complete') {

        await tab(main);

    }

Move this check before the existing `--help`/`-h` interception, replacing the
current unconditional `await tab(main);` call. Consolidate with the existing
`const rawArgs = process.argv.slice(2);` declared just below it today — one
declaration, not two.

**Preserve help-listing behavior.** `tab(main)` is also what registers `main
.subCommands.complete` (`f?f.complete=p:s.subCommands={complete:p}` in the adapter) —
today it runs unconditionally, so `complete` always appears in `noorm --help`'s and
bare `noorm`'s COMMANDS listing (verified live: both currently list `complete
  Generate shell completion scripts`). Gating `tab(main)` on `rawArgs[0] ===
'complete'` alone would silently drop `complete` from every help listing that isn't
itself a completion request — a help-output regression, not just an import-structure
change. Add a lightweight always-present stub entry to `main.subCommands.complete`
with the exact same meta the adapter itself uses (`meta.description: 'Generate shell
completion scripts'`, verified in `node_modules/@bomb.sh/tab/dist/citty.mjs`), so it
shows in every usage listing at zero resolution cost (no thunk, no dynamic import).
When `rawArgs[0] === 'complete'`, the real `tab(main)` call overwrites this stub with
the fully-functional implementation before `runMain` dispatches to it — same object
reference (`main.subCommands`), so the overwrite is safe regardless of ordering
relative to the `--help` check.

### 3. Defer Ink/React inside `ui.ts` and `sql/repl.ts` (QL-perf-01)

In both files, move `import { render } from 'ink';` and `import React from 'react';`
from module top level into the `run()` function body as dynamic imports, same pattern
already used one line below for the `App` component:

    async run() {

        const [{ render }, { default: React }, { App }] = await Promise.all([
            import('ink'),
            import('react'),
            import('../tui/app.js'), // '../../tui/app.js' in repl.ts
        ]);

        // ...rest of run() unchanged, using the destructured render/React/App
    },

(Exact destructuring/ordering is an implementation choice — the requirement is that
`ink` and `react` are not statically imported at module top level in either file.)
Update the file-header comment in `ui.ts` (currently claims laziness that isn't true)
to match reality once this lands.


## Checkpoints

| CP | Deliverable | Proof |
|----|-------------|-------|
| CP-1 | `src/cli/index.ts` subCommands are lazy thunks; `complete` stub added; `tab(main)` gated behind `rawArgs[0] === 'complete'`; `ui.ts` and `sql/repl.ts` defer `ink`/`react` into `run()` | New test file (see below) proves headless static import graph never reaches `ink`, `react`, or `src/tui/**`, and that `ui.ts`/`sql/repl.ts` don't statically import `ink`/`react` themselves. Existing `tests/cli/citty-help.test.ts` and `tests/cli/sql-repl.test.ts` still green (no command-behavior change). Manual verification: `noorm --help`, bare `noorm`, and `noorm complete zsh` still list/produce `complete` identically to before. |

Single checkpoint — the two findings are tightly coupled (the test can't pass with
only one landed) and the total diff is small (3 source files + 1 new test file).


## New test: static import-graph check

`tests/cli/lazy-startup.test.ts`. Uses the `typescript` package (already a
devDependency) to parse each file's **top-level** `ImportDeclaration` /
`ExportDeclaration` (re-export) statements via `ts.createSourceFile` — deliberately
NOT a regex over source text, so dynamic `import()` call expressions (which live
inside statement bodies, not as top-level import/export declarations) are structurally
excluded from the walk rather than pattern-matched around.

Algorithm:

1. `extractStaticSpecifiers(filePath): string[]` — parse the file, collect the
   `.text` of every top-level `ts.ImportDeclaration.moduleSpecifier` and
   `ts.ExportDeclaration.moduleSpecifier` (only when present, i.e. `export {x} from
   'y'` / `export * from 'y'`, not local `export function ...`).
2. `resolveRelative(fromFile, specifier): string` — for specifiers starting with `.`
   or `..`: strip the trailing `.js`, resolve against `fromFile`'s directory, then
   probe `<resolved>.ts` then `<resolved>.tsx` (matches this repo's NodeNext
   convention — source imports use `.js` extensions that map to `.ts`/`.tsx` files).
   Throw if neither exists (signals a resolver bug, not a real failure mode for this
   codebase's own source).
3. `staticReachable(rootFile): { files: Set<absPath>, bareSpecifiers: Set<string> }`
   — BFS/DFS from `rootFile` following only resolved relative edges; bare specifiers
   (not starting with `.`, `/`, or `node:`) are recorded but not recursed into (no
   need to walk into `node_modules`).

Test cases:

- `describe('cli: lazy startup - static import graph')`
  - `it('headless entry point never statically reaches ink, react, or the tui')` —
    `staticReachable('src/cli/index.ts')`; assert `bareSpecifiers` has neither `ink`
    nor `react`; assert no path in `files` starts with `<repoRoot>/src/tui/`.
  - `it('ui.ts does not statically import ink or react')` —
    `extractStaticSpecifiers('src/cli/ui.ts')` does not include `ink`/`react`.
  - `it('sql/repl.ts does not statically import ink or react')` — same, for
    `src/cli/sql/repl.ts`.

This test fails today (pre-fix) for the right reason: `index.ts` statically imports
`ui.ts` and `sql/index.ts` → `repl.ts`, both of which statically import `ink`/`react`
at module top level.


## Acceptance criteria (ticket, verbatim)

- `time noorm --version` before/after recorded in the PR; headless commands import
  no ink/react (assert via module-graph check or a test that fails if `src/tui` is
  reachable from a headless command's static import chain).
- Tab completion still works.

**Measurement protocol** (mirrors the evidence file's methodology): build the CLI
bundle (`bun run build:packages`, tsup → `packages/cli/dist/index.js`, the same
artifact CI and the evidence file both measure), discard one cold run, then time 5
warm runs of `node packages/cli/dist/index.js --version`. Record before (this spec's
baseline, captured pre-implementation) and after (post-fix) in the implementation
log below.

**Baseline (pre-fix, captured on this branch before CP-1)**:
`node packages/cli/dist/index.js --version` — 5 warm runs: 0.14s, 0.14s, 0.14s,
0.14s, 0.14s (consistent with evidence's 0.13-0.14s).


## Out of scope

- Command behavior, flags, or help *content* changes — only where/when modules load.
  The one deliberate exception is the `complete` stub (§2), which exists specifically
  to keep help *content* byte-identical, not to change it.
- `resolveCommand()`'s parent-chain logic (ticket 05) — already thunk-aware, untouched.
- Converting `src/core/connection/factory.ts`'s dialect-driver dynamic imports — already
  correctly lazy (evidence's own positive-precedent example), not touched.
- `packages/cli/scripts/postinstall.js` / binary release pipeline — unrelated surface.
- Any dependency other than `ink`/`react`/`src/tui/**` (e.g. `kysely`, `yaml`, `zod`) —
  named as a "secondary contributor" in the evidence but not written up as its own
  finding; not in scope here either. It will shrink somewhat as a side effect of the
  lazy-thunk conversion (per-command modules only load when invoked) but is not
  independently measured or asserted on.


## Test commands (scoped — per centralized-testing protocol)

- Unit (this task): `bun test tests/cli/lazy-startup.test.ts`
- Regression spot-check (existing tests touching the same files):
  `bun test tests/cli/citty-help.test.ts tests/cli/sql-repl.test.ts`
- `bun run typecheck` and `bun run lint`
- `bun run build:packages` (tsup) — needed to produce `packages/cli/dist/index.js`
  for the `time noorm --version` measurement; `bun run build` (`tsc`, typecheck-only)
  also run per standard protocol.
- CI group (files changed are under `tests/cli/` and `src/cli/`): group 3
  (`bun test --serial tests/cli`) — central runner only, NOT run by this loop.


## Change log

- 2026-07-12 — initial spec (from ticket 19 + QL-perf-01/QL-perf-02).


## Implementation log

### shipped (unit-green locally; central CI-group verification n/a per centralized-testing) — 2026-07-12

Built across 1 iteration of /subagent-implementation (reviewer PASS, 0 findings).
Stacked on v1/05-help-breadcrumb @ dda8187. Commits (chronological):

- `5470f65` — spec
- `d35d3d9` — CP-1: lazy command thunks in src/cli/index.ts (18 static imports -> Resolvable thunks) + always-present zero-cost complete stub + tab(main) gated behind rawArgs[0]==='complete'; ink/react moved into run() of ui.ts and sql/repl.ts as dynamic imports; new tests/cli/lazy-startup.test.ts (AST static-import-graph check), red-first

**Startup measurement** (tsup bundle `node packages/cli/dist/index.js --version`, warm, macOS arm64, Node v24.13.0; discard 1 cold run then 5 warm):

- Before: 0.14, 0.14, 0.14, 0.14, 0.14 s; index.js 619316 bytes, ~2.87MB total static-reachable JS.
- After: 0.04, 0.03, 0.03, 0.03, 0.03 s; index.js 42902 bytes; the 1.2MB React/Ink chunk (chunk containing `react-reconciler`) is no longer statically imported by index.js — it loads only via the dynamically-imported TUI app/build chunks.
- ~4x faster warm startup (~78% reduction), matching the evidence file's 75-85% Ink/React-attributable prediction.

**Acceptance criteria met:**

- Headless `--version` imports no ink/react: proven three ways — source-level AST test (green), built-bundle chunk analysis (React chunk not in index.js's static graph), and the timing delta.
- Tab completion still works: `noorm complete zsh` prints a real `#compdef noorm` script; an actual completion request (`noorm complete --`) resolves the full command tree and lists all commands (the gated `tab(main)` still walks the whole tree when the invocation IS a completion request). Both verified from the built bundle.
- Ticket 05 help/breadcrumb preserved: `noorm change --help` still prints the `noorm change` breadcrumb + EXAMPLES block; `--help` and bare `noorm` still list `complete  Generate shell completion scripts`.

**Out-of-scope work performed during this build:**

- none

**Unforeseens — surprises that emerged during implementation:**

- Naively gating `tab(main)` on `rawArgs[0] === 'complete'` would have silently dropped the `complete` entry from every non-completion `--help`/usage listing (a help-content regression), because `@bomb.sh/tab` is what registers `main.subCommands.complete`. Resolved by adding a zero-cost `completeStub` (defineCommand with meta byte-matching the adapter's own) that the real `tab(main)` overwrites in place on an actual completion request. This subtlety was anticipated in the spec's Contract section before implementation.

**Deferred items still open:**

- Signals refresh deferred. `atomic signals stale` returns exit 1 (stale) on this branch, but the staleness is from the two new files (spec + test) — not a domain/module structural change. Committing a `docs/wiki/` refresh on this stacked feature branch would conflict with the same refresh across the ~15 sibling v1 worktrees at merge time. Refresh once at the post-integration point instead.
- FOLLOWUPS ledger: empty (reviewer returned 0 findings across all severities).
