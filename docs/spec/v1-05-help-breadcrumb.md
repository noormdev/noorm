# Spec: Fix `--help` usage line on nested subcommands

Ticket: `tickets/v1/05-help-usage-breadcrumb.md` (v1-blocker, docs-drift).
Finding: VR-cli-02, `research/v1-audit/v1-release/cli-contract.md`.


## Goal

`--help` output must be copy-pasteable. `src/cli/index.ts`'s `--help` interceptor (`printHelpWithExamples`) always calls citty's `renderUsage(cmd, rootDef)` with the absolute root command as "parent," regardless of how deep `cmd` is. `renderUsage` only concatenates exactly one level (`parentMeta.name + ' ' + cmdMeta.name`, `node_modules/citty/dist/index.mjs` `renderUsage`), so every subcommand nested two or more levels deep prints a USAGE line with the intermediate segments silently dropped. Root help additionally prints `noorm noorm` (cmd === parent === main). Roughly 80 of 97 CLI commands are nested two or more levels deep, so this is the common case.

Fix: thread the resolved parent chain through `resolveCommand` and build the full breadcrumb for `renderUsage`, without touching command definitions, flag names, or the EXAMPLES block behavior.


## Root cause (confirmed by reading citty source + live execution)

- `resolveCommand(rootDef, argv)` in `src/cli/index.ts` walks `argv` one positional token at a time, descending into `subCommands`, but only returns the final resolved `CommandDef` — it discards every intermediate command it walked through.
- `printHelpWithExamples(cmd, rootDef)` is always called with `main` (the absolute root) as the second argument, which citty's `renderUsage` treats as "parent" and concatenates as exactly one segment: `commandName = parentMeta.name + ' ' + cmdMeta.name`.
- Each command file's own `meta.name` is just its own leaf name (e.g. `src/cli/change/add.ts` → `meta.name: 'add'`), never a full path — so bypassing the intermediate levels always yields `noorm <leaf>` no matter how deep the real command is.
- For the root command itself (`noorm --help`, no subcommand token before the flag), `cmd === main` and `renderUsage` is still called with `rootDef === main` as parent, producing `noorm noorm`.


## Contract

`resolveCommand` returns both the resolved command and the ordered list of parent command names from root to (but not including) the resolved command:

    async function resolveCommand(rootDef: CommandDef, argv: string[]): Promise<{ cmd: CommandDef; parentNames: string[] }>

Accumulate `parentNames` by capturing each visited command's own `meta.name` (falling back to the matched argv token if `meta.name` is absent) *before* descending into its matched subcommand — mirroring the existing `typeof x === 'function' ? await x() : x` resolution idiom already used in this function for lazy command defs, applied the same way to `meta` (no new dependency, no exported citty helper needed — `resolveValue` is not exported by citty).

`printHelpWithExamples` builds a synthetic parent for citty's `renderUsage` from the joined breadcrumb, instead of always passing `rootDef`:

    const parent: CommandDef | undefined = parentNames.length > 0
        ? { meta: { name: parentNames.join(' ') } }
        : undefined;

- Nested command (`parentNames = ['noorm', 'change']`, `cmd.meta.name = 'add'`): `renderUsage` concatenates `'noorm change' + ' ' + 'add'` → `noorm change add`.
- Root command (`parentNames = []`): `parent` is `undefined`, so `renderUsage`'s `parentMeta.name` is falsy and `commandName` is just `cmdMeta.name` (`'noorm'`) — no more `noorm noorm`.
- Single-level command (`noorm change --help`, `parentNames = ['noorm']`): unchanged from today — was already correct by coincidence at depth 1.

The EXAMPLES block (`cmd.examples` appended after the usage line) is untouched — `printHelpWithExamples` still reads `cmd.examples` exactly as before; only the `renderUsage` parent argument changes.


## Checkpoints

| CP | Deliverable | Proof |
|----|-------------|-------|
| CP-1 | `resolveCommand` returns `{ cmd, parentNames }`, threading the full parent chain instead of discarding it; `printHelpWithExamples` builds the joined-breadcrumb synthetic parent and passes it to `renderUsage` | New/extended tests in `tests/cli/citty-help.test.ts` (or a sibling file), written red-first, asserting the exact `USAGE noorm <breadcrumb> <leaf>` line at 2-3 nesting depths (`change add`, `db explore tables`, `ci identity enroll`) plus root `--help` prints `noorm ...` and never `noorm noorm`. EXAMPLES block still present for a command that declares `examples` (`change ff --help` — do not regress the existing test). |


## Acceptance criteria (ticket, verbatim)

- `noorm change add --help` prints `noorm change add ...`; root `--help` prints `noorm ...` (not `noorm noorm`).
- Spot tests across 2–3 nesting depths.


## Evidence

- `src/cli/index.ts` `resolveCommand` — discards intermediate parents, returns only the leaf `CommandDef`
- `src/cli/index.ts` `printHelpWithExamples` — always receives `rootDef` (`main`) as citty's "parent" argument regardless of actual depth
- `src/cli/index.ts` `entry()` — `--help`/`-h` interception calls `resolveCommand(main, rawArgs)` then `printHelpWithExamples(cmd, main)`
- `node_modules/citty/dist/index.mjs` `renderUsage` — `commandName = parentMeta.name + ' ' + cmdMeta.name`; concatenates exactly one level
- Live-verified before fix: `change add --help` → `USAGE noorm add`; `db explore tables --help` → `USAGE noorm tables`; `ci identity enroll --help` → `USAGE noorm enroll`; root `--help` → header `(noorm noorm v0.0.0)`, `USAGE noorm noorm change|ci|...`; `change --help` (1-level) → already correct: `USAGE noorm change ...`


## Out of scope

- Flag-naming consistency (kebab-case vs camelCase args keys) — ticket 24 / VR-cli-07 territory.
- Any change to command definitions, `meta.name` values, or `examples` arrays in individual command files.
- citty itself (`node_modules/citty`) — read-only reference, not modified.
- `noorm <command> <command> --help` behavior for unknown/misresolved commands (unrelated failure mode, not touched by this fix).


## Test commands (scoped — per centralized-testing protocol)

- Unit (this task): `bun test tests/cli/citty-help.test.ts`
- `bun run typecheck` and `bun run lint`
- This test spawns `bun src/cli/index.ts ...` directly (source, not the built CLI) — no `bun run build` prerequisite for this specific test file.
- Full CI-equivalent group (test/cli files changed): `bun test --serial tests/cli` (central runner only, NOT run by this loop; needs `bun run build` first per CI, since other files in `tests/cli` do exercise the built CLI).


## Change log

- 2026-07-12 — initial spec (from ticket 05 + VR-cli-02).
