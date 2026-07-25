# Spec — v1/49-54 field-reported CLI defects

Design: `docs/design/v1-49-54-cli-field-defects.md`
Issues: noormdev/noorm #49, #50, #51, #52, #53, #54
Branch: `v1/49-54-cli-field-bugs` off `next`

## Baseline

**Verify the way CI does — four separate `bun test` runs, never one whole-tree run.**
`.github/workflows/ci.yml` splits them deliberately: *"Split test runs to prevent
cross-contamination from mock.module."*

    bun test --serial $(find tests/utils tests/core tests/sdk -name '*.test.ts' | grep -v tests/core/transfer | sort | tr '\n' ' ')
    bun test --serial tests/core/transfer
    bun test --serial tests/cli
    bun test --serial tests/integration

A single `bun test --serial` over the whole tree reports ~18 failures on `next` that are
**not** product defects. `tests/cli/app-context.test.tsx:50` replaces the entire
`src/core/index.js` barrel via `mock.module`; any module first loaded during that window
permanently captures the stubbed `getStateManager`, and the `afterAll` restore cannot rebind
what another module already closed over. Every later file that reaches a real `StateManager`
then fails with `getAllSecrets is not a function` or `setConfig is not a function`. The
affected tests all pass in isolation. Do not chase them, and do not "fix" a product file to
satisfy one.

Preconditions for a meaningful run:

- `bun run build` first. CLI tests spawn `dist/cli/index.js`; without a build, 204 tests fail
  on `MODULE_NOT_FOUND` and the signal is worthless.
- All three test DBs up: postgres :15432, mysql :13306, mssql :11433 (`tests/sample.env`).
- The `noorm_test_dest` databases created and the postgres fixtures deployed, exactly as the
  CI workflow's setup steps do. Without them `tests/core/transfer` fails 8 tests on
  `relation "todo_items" does not exist` — an environment gap, not a regression.

Green means 0 failures across all four runs.

## Contract

| CP | Deliverable | Acceptance | Files |
|----|-------------|-----------|-------|
| 1 | Root-level flag placement | `noorm run build --dry-run` and `noorm config list --json` work. Any flag other than `-c`/`--cwd` placed before the subcommand is rejected, naming the correct form. `-c`/`--cwd` is the sole flag with a root-level meaning. Never exit 0 silently. | `src/cli/index.ts` |
| 2 | `run build` and `db teardown` honour `--dry-run` | `noorm run build --dry-run` and `noorm db teardown --dry-run` both execute zero statements and list what would run. | `src/cli/run/build.ts`, `src/cli/db/teardown.ts`, `src/sdk/types.ts`, `src/sdk/namespaces/run.ts`, `src/sdk/namespaces/db.ts` |
| 3 | `db create` / `db drop` honour `NOORM_CONNECTION_*` | With a persisted config active and env vars naming a different database, both target the env database. | `src/cli/db/create.ts`, `src/cli/db/drop.ts` |
| 4 | Results on stdout, diagnostics on stderr | `noorm change list` prints its table to stdout; empty set prints an explicit empty-state line. `noorm change history --json \| jq .` parses with no `tail -1`. | `src/core/logger/logger.ts`, `src/cli/_utils.ts`, `src/cli/change/list.ts`, `src/cli/change/history.ts`, `src/cli/lock/status.ts`, `src/cli/db/explore.ts` |
| 5 | Unresolved secret fails loudly | Rendering `$.secrets.MISSING` throws naming the key. `sqlQuote(undefined)` throws. `'undefined'` never reaches SQL. `KEY in $.secrets` still probes without throwing. | `src/core/template/context.ts`, `src/core/template/utils.ts` |
| 6 | Vault tier reaches `$.secrets` | A secret set only via `noorm vault set` resolves in a template. Precedence config-local > global-local > vault. No reachable vault degrades to the local tiers without throwing. | `src/sdk/namespaces/run.ts`, `src/sdk/namespaces/changes.ts`, `src/sdk/namespaces/templates.ts`, `src/cli/run/preview.ts`, `src/cli/run/inspect.ts`, `src/tui/utils/run-context.ts`, `src/tui/screens/run/RunInspectScreen.tsx` |
| 7 | `change add` scaffolds runnable stubs | `noorm change add x` then `noorm change run x` reports empty-SQL, not "change not found". | `src/core/change/scaffold.ts` |
| 8 | Docs state what the code does | No doc claims a command or form that does not exist. `noorm secret` has a CLI reference page. | `docs/dev/secrets.md`, `docs/headless.md`, `docs/cli/secret.md`, `docs/cli/run.md`, `docs/guide/changes/overview.md` |
| 9 | #54 — invariant + instrumentation | Build asserts each discovered file is unique and executes once. Duplicate `(operationId, filepath)` fails loudly instead of silently updating N rows. Connection target is logged. | `src/core/runner/runner.ts`, `src/core/runner/tracker.ts`, `src/core/connection/factory.ts` |
| 10 | `run build` honours checksums | A second build over unchanged files skips them. `--force` still re-runs. The docs at `docs/headless.md:636` and `docs/dev/runner.md:13` become true. | `src/core/runner/tracker.ts` |

## Checkpoint detail

### CP1 — root-level flag placement

`citty` forwards only `rawArgs.slice(subCommandArgIndex + 1)`
(`node_modules/citty/dist/index.mjs:217`), so a flag before the subcommand name is
discarded. The root command declares no `args` (`src/cli/index.ts:44-71`).

A flag goes on the command that uses it. `-c`/`--cwd` is the sole exception, handled by
`extractGlobalCwd` (`src/cli/index.ts`), which strips `-c <path>`/`--cwd <path>`/`--cwd=<path>`
from argv before dispatch — it must run before dispatch because it sets the working directory
everything else (project discovery, config resolution) resolves against, and `-c` already
means `--config` after the subcommand. `--dry-run`, `--json`, `--yes` are **not** hoisted;
they are per-subcommand, exactly like `--config` and `--force` already were.

Rule 1 of the design still applies: a flag that cannot be honoured is an error. Any flag
other than `-c`/`--cwd` seen before the subcommand exits non-zero with a message naming the
correct invocation. Silent acceptance is the defect this checkpoint fixes — do not replace
one silence with another.

Do not declare these flags at every command level; citty will not forward a parent's parsed
value to a child, so that approach adds declaration sites without fixing the drop.

### CP2 — dry-run

`sharedArgs.dryRun` exists (`src/cli/_utils.ts:52`). The core gate
(`src/core/runner/runner.ts:608`) already works and is exercised by `run file`, `run dir`,
`run files`, `run exec`, `change run`. Only the wiring is missing:

- `src/cli/run/build.ts:13-17` — `args` omits `dryRun`.
- `src/sdk/types.ts:82-88` — `BuildOptions` has no `dryRun` field.
- `src/sdk/namespaces/run.ts:199,219` — both hardcode `{ force: options?.force }`.
- `src/cli/db/teardown.ts:13-18` — same omission; `ctx.noorm.db.teardown()` takes no options
  at all, while `docs/guide/database/teardown.md:255` documents the flag.

Copy the working chain from `run file` (`src/cli/run/file.ts:20,30`). Add no new branch.

### CP3 — connection resolution

`src/cli/db/create.ts:46` and `src/cli/db/drop.ts:50` call
`stateManager.getConfig(configName)` — a raw record read (`src/core/state/manager.ts:349`)
with no env merge — then connect with the result.

Route both through `resolveConfig` (`src/core/config/resolver.ts:211`), which merges
`DEFAULTS <- stage <- stored <- env <- flags`. Introduce no new precedence logic; the merge
is already covered by `tests/core/config/resolver.test.ts:234-260`.

These two commands are the complete set — every other connecting command already reaches
`resolveConfig` via `withContext`/`createContext`. Commands that read a stored config by
name for a non-connection purpose (`db transfer` destination, `vault cp`, `config *`) are
correct as-is and must not be changed.

### CP4 — output streams

`Logger` holds two writers (`src/core/logger/logger.ts:143`): `console` → stdout,
`diagnostics` → stderr. `#writeConsole` (`:497-543`) currently routes `--json` NDJSON to
stdout and human text to stderr. Both are backwards.

Required behaviour, in both modes:

- A command's **result** goes to stdout.
- The logger's **event stream** goes to stderr.

So `noorm change history --json` writes exactly one parseable JSON document to stdout.

`change list` (`:30-46`, `:57-61`) and `change history` (`:32-43`, `:54-58`) call
`outputResult` only under `if (args.json)`. Build the text and call `outputResult`
unconditionally, matching `src/cli/config/list.ts:40,59-63`, which already does this right.

An empty result set prints an explicit empty-state line — issue #52's core complaint is that
a CI step cannot distinguish "no changesets" from "no output".

`src/cli/lock/status.ts:25-41` and `src/cli/db/explore.ts:29-45` carry the same defect and
are in scope.

### CP5 — secrets fail loudly

Two independent silences turn a missing secret into valid SQL:

- `src/core/template/context.ts:70` — `secrets: options.secrets ?? {}` is a plain object, so
  a missing key reads as `undefined`.
- `src/core/template/utils.ts:85-95` — `sqlQuote` guards `null` but not `undefined`;
  `String(undefined)` → `"undefined"` → `'undefined'`.

Make `$.secrets` a Proxy whose `get` throws on an unknown key, naming the key and the tiers
searched. Make `sqlQuote` throw on `undefined` — defence in depth, since any other path
reaching it with `undefined` is equally a bug.

A `has` trap must keep `'KEY' in $.secrets` working, and `Object.keys`, spread, and
`JSON.stringify` of the context must not throw. `$.secrets.KEY ?? fallback` does **not**
survive and is not meant to: `??` evaluates its left operand, which is the throwing read.
Optional probing is written `KEY in $.secrets ? $.secrets.KEY : default`. Requiring the
explicit guard is the point — `?? default` silently accepts a missing secret, which is the
coercion that produced `'undefined'` in the first place.

The error message names only tiers that actually feed `$.secrets`. That is **config-local
only**: every render-path caller populates it from `stateManager.getAllSecrets(configName)`
(`src/core/state/manager.ts:479`), and global-local secrets live in a separate
`$.globalSecrets` context property that is never merged in. Do not name global-local or
vault. Add a test asserting the message does not overclaim.

### CP6 — connect the vault tier

`resolveSecret` and `buildSecretsContext` (`src/core/vault/resolve.ts:45,149`) implement the
documented three-tier precedence. `docs/dev/vault.md:169` names `buildSecretsContext()` as
*the* template-render path. Neither has a production caller — verified by grep; the only
hits are docstrings, `docs/`, and `packages/*/CHANGELOG.md`.

The render path instead calls `stateManager.getAllSecrets(configName)`
(`src/core/state/manager.ts:479`) — config-local only. **Vault secrets reach no template,
for any identity.** The field report's "silently yielded nothing for this identity"
understates it.

Replace `getAllSecrets` with `buildSecretsContext` at the render-context builders.
`buildSecretsContext` is async and the current builders are sync — notably
`RunNamespace.#createRunContext` (`src/sdk/namespaces/run.ts:247-259`). The callers are
already async; make the builders async and await.

Call sites: `src/sdk/namespaces/run.ts:255`, `src/sdk/namespaces/changes.ts:461`,
`src/sdk/namespaces/templates.ts:47`, `src/cli/run/preview.ts:60`,
`src/cli/run/inspect.ts:100`, `src/tui/utils/run-context.ts:62`,
`src/tui/screens/run/RunInspectScreen.tsx:362,427`.

The inspect/preview surfaces must resolve the same tiers as the apply path. A preview that
shows different secrets than the apply uses is the same class of silent divergence this
whole spec exists to remove.

The counting sites (`src/cli/run/inspect.ts:163,220`) report a secret count; keep them
consistent with whatever the render path now resolves.

`src/tui/screens/config/ConfigExportScreen.tsx:152` exports the config-local store
deliberately and is **out of scope** — do not change it.

If the React screens make the async change genuinely invasive, stop and report rather than
leaving the apply path and the inspect path disagreeing.

### CP7 — `change add` stubs

`createChange` (`src/core/change/scaffold.ts:88-149`) creates the dated directory, empty
`change/` and `revert/` subdirectories, and `changelog.md`. Both directories stay empty.

The resulting changeset is worse than inert. `parseChange` throws `ChangeValidationError`
when both folders are empty (`src/core/change/parser.ts:115-121`); `#loadChange`
(`src/core/change/manager.ts:605-630`) catches it, finds no DB history, and re-throws
`ChangeNotFoundError` (`:624`). The user is told the change does not exist, when it does.

Scaffold `change/001_<slug>.sql` and `revert/001_<slug>.sql` containing a comment naming
what belongs in each. Match the loader's expectations exactly:
`SEQUENCE_REGEX = /^(\d{3})_(.+)$/` (`src/core/change/parser.ts:49`), extensions from
`SQL_EXTENSIONS` (`:40`), ordering by `localeCompare` on filename (`:434`).

A stub containing only comments must still surface as an actionable message, not as a
success. `executeChange` already rejects template-only/empty content
(`src/core/change/executor.ts:148-157`) — verify the stub lands on that path and reads
clearly.

Update `tests/core/change/scaffold.test.ts:51-65`, which currently asserts
`changeFiles`/`revertFiles` start empty.

### CP8 — docs

Each item below is a statement that is false today.

- `docs/dev/secrets.md:113` and `:151-153` — claim there is no headless `noorm secret set`
  and direct users to `noorm vault set` for config-scoped local secrets.
  `src/cli/secret/set.ts:12-65` is fully headless (positional `key`/`value`, no TTY gate),
  and `docs/guide/environments/secrets.md:27-40` documents it correctly. The dev doc
  contradicts both the code and its own user guide. This is the misdirection named in #50.
- `docs/headless.md:885` — says `change add` creates `change.sql` and `revert.sql`. It
  creates `change/` and `revert/` *directories*. After CP7, document the stub files.
- `docs/headless.md:55,641` — documents `--dry-run` before the subcommand. `--dry-run` is
  per-subcommand only; correct after CP1 to the leaf-placed form.
- `docs/cli/` has no `secret.md`, while `noorm vault` has both a dev and a guide page.
  Add one covering `secret set|list|rm`, cross-linked to the vault page, stating plainly
  which tier is which — the tier confusion is what cost the reporter the time.
- `docs/guide/changes/overview.md:91-102` attributes changeset scaffolding to the TUI wizard
  and never names `noorm change add`. Document the CLI command and the on-disk layout it
  produces, including the `NNN_` convention and multi-file ordering (#53's explicit ask).

Prose follows the `atomic-writing` skill. Do not invent behaviour — every statement must be
checked against the code as it stands after CP1-CP7.

### CP9 — #54: double execution ruled out

**Finding: no double-execution mechanism exists.** Verified at every layer.

- Kysely never retries a query — `MssqlConnection.executeQuery` calls `execSql` once
  (`node_modules/kysely/dist/cjs/dialect/mssql/mssql-driver.js:130`).
- tedious never resubmits a `Request`; its only retry
  (`node_modules/tedious/lib/connection.js:2320`) is reached solely from the LOGIN7 catch
  block, before any request is sent.
- No connection reset on release — `src/core/connection/dialects/mssql.ts:133-149` sets
  neither `resetConnectionsOnRelease` nor `tedious.resetConnectionOnRelease`, and `reset`
  never replays a prior batch regardless.
- Discovery cannot duplicate: one dirent per push (`src/core/runner/runner.ts:1355-1393`),
  and `filterFilesByPaths` is `Array.prototype.filter` (`src/core/shared/files.ts:61`).
- The execution loop is sequential `for` + `await` with no retry wrapper (`:700-742`).
- The v1/17 per-file retry landed in `src/core/change/executor.ts`, which `runner.ts` does
  not import.

Do not implement a fix for double execution. Deliver the invariants that make any
recurrence self-diagnosing, and the real defect CP10 names.

1. Assert discovery uniqueness before execution — `files.length === new Set(files).size` —
   and fail loudly naming duplicates. Uniqueness is currently emergent, not enforced. Also
   assert `results.length === files.length` after the loop.
2. `updateFileExecution()` (`src/core/runner/tracker.ts:497-518`) uses
   `WHERE change_id = ? AND filepath = ?` and tolerates any row count. Fail when
   `numUpdatedRows !== 1`, not merely when `=== 0`. **Why:** more than one match is exactly
   what would mask an upstream duplicate from `needsRun`.
3. `needsRun()`'s DB-error path (`:131-141`) returns `needsRun: true, reason: 'new'` on a
   failed SELECT. Distinguish "no record" from "could not read"; a transient error must not
   read as a new file.
4. On file failure, report prior successful executions of that filepath — one extra SELECT
   on the failure path only. This is the single line that would have answered #54 on sight.
5. Emit the resolved connection target on every connecting command. `connection:open`
   currently carries `{configName, dialect}` only (`src/core/connection/factory.ts:182`);
   add host, port, and database. This permanently removes the "which database was I
   actually talking to" ambiguity that #51 creates.

Add a regression test asserting a build executes each discovered file exactly once.

### CP10 — `run build` never skips anything

The defect #54 actually surfaced. Higher severity than any of the six filed issues, present
since the initial release, and contradicted by two shipped doc pages.

`executeFiles` inserts a `pending` execution row for every discovered file *before* the loop
(`src/core/runner/runner.ts:677` → `src/core/runner/tracker.ts:443-482`). `needsRun` then
selects the newest row for that filepath by `executions.id desc`
(`src/core/runner/tracker.ts:126`) — which is always the pending row this very run just
inserted — and `:163-167` returns `{ needsRun: true, reason: 'new' }` for `pending`.

**Checksum-based skipping is structurally unreachable for `run build`, `run dir`, and
`run files`.** `run file` is unaffected: `executeSingleFile` inserts after execution
(`runner.ts:1087`).

Already known in-repo and never filed — `tests/cli/run/build.test.ts:147` calls it
"a latent runner bug" in a comment.

Both shipped docs promise the opposite:

- `docs/headless.md:636` — "Uses checksums to skip unchanged files."
- `docs/dev/runner.md:13` — "Files that haven't changed are skipped."

Consequence, and the reason #54 looked like double execution: every `run build` re-executes
every file, so a second build against a populated database is *guaranteed* to fail at the
first non-idempotent DDL statement. For the reporter's schema that is `CREATE TYPE mls_id` —
the first statement of the second phase, exactly as reported.

Fix: exclude the current operation's own rows from the `needsRun` lookup — `change_id <>
operationId`, or `executions.id <` the first id inserted by this run.

**Do not "scope `needsRun` to the current operation".** An earlier draft of this spec said
that; it is backwards and would cement the defect while appearing to fix it. The pending row
that must be ignored *is* the current operation's.

Acceptance: a second `run build` over unchanged files skips them and reports them as
skipped; `--force` still re-runs everything; a changed file still re-runs. Verify against a
live database, not only a mock — the defect lives in a SQL query's ordering.

This changes behaviour that some tests may silently depend on. If a previously-passing test
breaks because it assumed files always re-run, that is a real finding: report it rather than
weakening the fix.

## Test requirements

TDD: failing test first, then implementation. Every checkpoint needs a test that fails for
the reported reason before the fix.

- CP1 — a flag works after the subcommand; the same flag placed before the subcommand exits
  non-zero naming the correct form. `-c`/`--cwd` is the exception and still works before the
  subcommand.
- CP2 — dry-run build against a live DB creates zero objects; sibling non-dry-run creates them.
- CP3 — env vars + a different active config; assert the env database is targeted.
- CP4 — capture stdout and stderr separately. Assert result on stdout, empty-state line
  present, and `--json` stdout parses as a single JSON document.
- CP5 — missing key throws naming the key; `?? fallback` and `in` still work;
  `sqlQuote(undefined)` throws.
- CP6 — a vault-only secret resolves in a template; precedence order holds.
- CP7 — `change add` then `change run` gives the empty-SQL message, not "change not found".
- CP9 — a build executes each file exactly once; a duplicated input fails loudly.

Integration tests requiring MSSQL use `TEST_MSSQL_*` from `tests/sample.env` (port 11433).

## Non-goals

- Changing the `change/` + `revert/` directory convention (#53 rules it out).
- Redesigning vault identity or key distribution. CP6 connects the existing resolver.
- Fixing the `mock.module` barrel leak in `tests/cli/app-context.test.tsx`. It is
  pre-existing, CI already works around it by splitting runs, and a correct fix is test
  architecture work rather than part of six CLI defects. Worth its own issue.
- The `max-len` lint error at `tests/sdk/destructive-ops.test.ts:75` (203 chars). Present on
  `next`, untouched by this branch.
- `src/tui/screens/config/ConfigExportScreen.tsx` — exports the local store by design.

## Change log

- 2026-07-25 — initial spec from the six issues + six investigation traces and one
  empirical CLI probe confirming the flag-position drop. CP9 pending strategist RCA.
- 2026-07-25 — CP9 rewritten after RCA. Double execution ruled out at every layer
  (kysely, tedious, tarn, discovery, filter, loop). **Corrected a defect in the previous
  CP9 body:** it directed scoping `needsRun` *to* the current operation, which is backwards
  and would have cemented the bug. Added CP10 for the dead skip path — the defect #54
  actually surfaced, and the reason a second build fails on the first non-idempotent DDL.
- 2026-07-25 — Baseline section rewritten. It previously recorded "3649 pass / 52 skip /
  18 fail" from a single whole-tree run and called the 18 test-double gaps. Both were wrong:
  CI never runs the tree in one process, and the failures are `mock.module` barrel
  contamination from `tests/cli/app-context.test.tsx`. Under CI's four-run split the branch
  is 3719 pass / 52 skip / 0 fail.
- 2026-07-25 — CP5 corrected on two counts, both found during implementation.
  The body claimed `$.secrets.KEY ?? fallback` would keep working; it cannot, because `??`
  evaluates the throwing read. Optional probing is the `in` guard, and that is the intended
  contract rather than a concession. The body also contradicted CP6 on which tiers feed
  `$.secrets` — it is config-local only.
- 2026-07-25 — CP1 reversed. `--dry-run`, `--json`, `--yes` are no longer hoisted to any
  position; only `-c`/`--cwd` is a root-level flag, and every other flag — including these
  three — is per-subcommand and errors before the subcommand, matching `--config`/`--force`.
  **Superseded:** CP1 previously hoisted `--dry-run`/`--json`/`--yes` out of `rawArgs` before
  citty dispatch (the design doc's D1) so they worked in either position. That created an
  asymmetry with `--config`/`--force`, which were never hoisted, for no reason beyond
  convenience. The standard is now uniform: a flag goes on the command that uses it.
