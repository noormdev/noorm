# v1/49-54 — field-reported CLI defects

Six issues filed 2026-07-25 against `noormdev/noorm` from one production MSSQL migration
(~155 files, 9 phase directories, hand-rolled zsh deploy script → noorm).

One reporting effort, six symptoms. The traces show they are not six independent bugs:
four of them are the same structural failure wearing different clothes — **a contract is
documented, the plumbing to honour it is absent, and the absence is silent.**

## The shared shape

| # | Documented contract | What the code does | How it fails |
|---|---|---|---|
| 49 | `--dry-run` previews without executing | `run build` never declares the flag | silent — flag ignored, build runs |
| 50 | secrets resolve across three tiers | the three-tier resolver has zero callers | silent — renders `'undefined'` |
| 51 | env vars outrank stored config | `db create` reads stored config raw | silent — wrong database created |
| 52 | `--json` anywhere, text otherwise | text goes to stderr; `--json` dropped if leading | silent — empty stdout, exit 0 |

Every one exits 0. That is the through-line worth fixing, not just the four instances.
A flag that is ignored must never be indistinguishable from a flag that was honoured.

## Concepts

### Silent flag drop (citty dispatch)

`citty` forwards only `rawArgs.slice(subCommandArgIndex + 1)` to a subcommand
(`node_modules/citty/dist/index.mjs:217`). Any flag typed *before* the subcommand name is
discarded before the leaf command parses. The root command declares no `args` at all
(`src/cli/index.ts:44-71`), so nothing catches them.

Verified empirically against the built CLI:

    $ node dist/cli/index.js config list --json
    {"configs":[]}

    $ node dist/cli/index.js --json config list
    No configurations found.          # exit 0

Both documented forms appear in the docs. `docs/headless.md:55,641` writes
`noorm --dry-run run build` — the form that cannot work. The reporter used exactly that form.

This single defect is why #49's repro looks the way it does and is half of #52.

### Result output vs diagnostic output

`Logger` has two writers (`src/core/logger/logger.ts:143`): `console` (stdout) and
`diagnostics` (stderr). `#writeConsole` (`:497-543`) routes:

- `--json` → NDJSON event lines to **stdout**
- otherwise → human text to **stderr**

So `noorm change list` writes its table to stderr, and `noorm change list --json` writes
log noise to stdout *ahead of* the payload. Both directions are backwards. A command's
**result** is stdout; its **diagnostics** are stderr, in both modes.

`change list`/`history` compound it by calling `outputResult` only under `if (args.json)`
(`src/cli/change/list.ts:57-61`, `history.ts:54-58`) — the text branch never reaches the
one helper that writes to stdout correctly.

### Connection resolution has two doors

`resolveConfig` (`src/core/config/resolver.ts:211`) is canonical: it merges
`DEFAULTS <- stage <- stored <- env <- flags` (env at `:253`). Everything reaching it via
`withContext`/`createContext` honours `NOORM_CONNECTION_*`.

`StateManager.getConfig(name)` (`src/core/state/manager.ts:349`) is a raw record read with
no merge. `db create` (`src/cli/db/create.ts:46`) and `db drop` (`src/cli/db/drop.ts:50`)
call it directly and then connect with the result. That is the whole of #51.

`docs/dev/config.md:13-23` and `docs/headless.md:161-165` state the precedence as a blanket
guarantee for `noorm`, with no per-command exceptions. The docs are right; two commands
are wrong.

### Secret tiers: documented, built, never connected

`resolveSecret` and `buildSecretsContext` (`src/core/vault/resolve.ts:45,149`) implement the
documented three-tier precedence (config-local > global-local > vault).
`docs/dev/vault.md:169` names `buildSecretsContext()` as *the* template-render path.

Neither function has a production caller. The render path instead calls
`stateManager.getAllSecrets(configName)` (`src/core/state/manager.ts:479`) — config-local
tier only, no vault merge — from `src/sdk/namespaces/run.ts:255` and five sibling sites.

**Vault secrets never reach `$.secrets`, for any identity.** The reporter's diagnosis
("the vault tier silently yielded nothing for this identity") was correct about the symptom
and understated the cause: it yields nothing for everyone.

Then two more layers of silence turn a missing secret into valid SQL:

- `$.secrets` is a plain object (`src/core/template/context.ts:70`), so a missing key is
  `undefined`, not an error.
- `sqlQuote` (`src/core/template/utils.ts:85-95`) guards `null` but not `undefined`;
  `String(undefined)` → `"undefined"` → `'undefined'`.

Net: `CREATE LOGIN worker WITH PASSWORD = 'undefined';` applied successfully.

## Business rules

1. **A flag that cannot be honoured is an error, never a no-op.** Unknown or
   misplaced flags fail loudly with the correct form named.
2. **Results go to stdout; diagnostics go to stderr.** In every mode. `--json` stdout is
   parseable without `tail -1`.
3. **Env-only mode is a first-class configuration source for every command that connects.**
   No command reads a stored config raw and then connects with it.
4. **A secret that cannot be resolved has no correct rendering.** Fail, naming the key.
   Never substitute a placeholder into SQL.
5. **Scaffolding teaches its own layout.** A command that creates a directory structure
   either populates it or documents it.

## Decisions

### D1 — Only `-c`/`--cwd` is a root-level flag

A flag goes on the command that uses it. `-c`/`--cwd` is the sole exception: it is consumed
before dispatch — it sets the working directory everything else (project discovery, config
resolution) resolves against — and `-c` already means `--config` after the subcommand, so the
split is genuinely load-bearing rather than a convenience.

`--dry-run`, `--json`, `--yes` are **not** hoisted. They are per-subcommand, exactly like
`--config` and `--force` always were. A flag placed before the subcommand that isn't
`-c`/`--cwd` is rejected outright, naming the flag and the correct form — a flag that cannot
be honoured is still an error, never a silent no-op (Business rule 1).

Implemented by narrowing `extractGlobalCwd` (`src/cli/index.ts`) to strip only `-c <path>` /
`--cwd <path>` / `--cwd=<path>` from `rawArgs` before dispatch; every other flag-looking token
seen before the subcommand falls through to the error path.

Rejected: declaring the flags at every level. It multiplies declaration sites, and citty
still would not forward a parent's parsed value to a child.

### D2 — `run build` and `db teardown` declare and honour `--dry-run`

Both omit `sharedArgs.dryRun` while their docs promise it
(`docs/cli/run.md:26`, `docs/guide/database/teardown.md:255`). The core gate
(`src/core/runner/runner.ts:608`) already works and is reached by five sibling commands;
`build` simply never sets the flag. Threading it through `BuildOptions`
(`src/sdk/types.ts:82-88`) reaches live code with no new branch.

### D3 — `db create` / `db drop` resolve through `resolveConfig`

Replace the raw `stateManager.getConfig` read with the canonical resolver, matching
`run build`. No new precedence logic — the merge already exists and is tested
(`tests/core/config/resolver.test.ts:234-260`).

### D4 — Logger writers swap by purpose, not by mode

Command results → stdout. Logger event stream → stderr, in both text and `--json` mode.
`change list`/`history` build their text and pass it to `outputResult` unconditionally,
matching the commands that already get this right (`src/cli/config/list.ts:40,59-63`).

An empty result set prints an explicit empty-state line, so "no changesets" is never
indistinguishable from "no output".

### D5 — Secrets fail hard, and the vault tier gets connected

Two parts, both required. Failing hard alone would turn the reporter's broken login into a
loud error — correct, but they *had* set the secret via `vault set` as the docs instruct, so
it must also resolve.

- `$.secrets` becomes a Proxy that throws on unknown-key access, naming the key and the
  tiers searched.
- `sqlQuote` rejects `undefined` rather than stringifying it — defence in depth for any
  other path that reaches it.
- The render path calls `buildSecretsContext` instead of `getAllSecrets`, so the documented
  three tiers actually apply.

Optional probing needs an explicit form. `$.secrets.KEY ?? default` cannot survive a
throwing `get` trap — `??` evaluates its left operand, which is the read that throws. So the
contract is: **read throws, `in` does not.** A template probing for an optional secret writes

    KEY in $.secrets ? $.secrets.KEY : default

That is a feature, not a workaround. `?? default` silently accepts a missing secret, which
is the exact coercion that turned an unresolved password into the string `undefined`.
Requiring `in` makes "this secret is optional" a statement the template author wrote on
purpose, and leaves every unguarded read loud.

`examples/todo-db/sql/10_seeds/feature_flags.sql.tmpl` used the `?.[key] ?? null` form to
force a flag off when its secret is absent — a legitimate intent, expressed the unsafe way.
It moves to the `in` guard.

### D6 — `change add` scaffolds SQL stubs

`createChange` (`src/core/change/scaffold.ts:111-130`) already creates `change/` and
`revert/` directories plus `changelog.md`, but leaves both directories empty. An empty
changeset is not merely inert — `parseChange` throws
`ChangeValidationError` (`src/core/change/parser.ts:117`), which `#loadChange`
(`src/core/change/manager.ts:624`) converts to `ChangeNotFoundError`. The user is told the
change does not exist, when it does.

Scaffold `change/001_<slug>.sql` and `revert/001_<slug>.sql` as commented stubs.

`docs/headless.md:885` currently documents this as creating `change.sql` and `revert.sql` —
files, not directories. It is wrong today and must be corrected regardless.

### D7 — Docs corrections are part of the fix, not follow-up

Three doc statements are actively false and each one cost the reporter time:

- `docs/dev/secrets.md:113,151-153` — claims there is no headless `noorm secret set` and
  directs users to `noorm vault set` instead. `src/cli/secret/set.ts:12-65` is fully
  headless, and `docs/guide/environments/secrets.md:27-40` documents it correctly. The dev
  doc contradicts both the code and its own user guide.
- `docs/headless.md:885` — wrong `change add` output shape (D6).
- `docs/headless.md:55,641` — `noorm --dry-run run build`, a form that never works;
  `--dry-run` is per-subcommand only, matching `--config`/`--force` (D1).

`noorm secret` also has no `docs/cli/` page while `noorm vault` has two.

## Out of scope

- Changing the changeset directory convention. `change/` + `revert/` stays (issue #53 says so).
- Reworking the vault identity/enrolment model. D5 connects the existing resolver; it does
  not redesign key distribution.
- The 18 pre-existing test failures on `next` (test-double gaps in
  `tests/sdk/run-build-filtering.test.ts`, `tests/sdk/context.test.ts`, `tests/rpc/*`).
  D5 touches `src/sdk/namespaces/run.ts:255`, which is the line those doubles trip on, so
  they are repaired as a side effect — but they are not the goal.

## Open question — #54

Filed as "not reliably reproducible", with the reporter explicitly asking to rule double
execution in or out at the source rather than chase the flake. Investigation pending;
this section is completed before the checkpoint that addresses it.

## Change log

### 2026-07-25 — D1 reversed: only `-c`/`--cwd` hoisted

**What changed:** `--dry-run`, `--json`, `--yes` are no longer hoisted to any position. Only
`-c`/`--cwd` is a root-level flag; every other flag, including these three, is per-subcommand
and errors if placed before the subcommand — exactly like `--config`/`--force` always did.

**Why:** the original D1 created an asymmetry with no principled justification: three flags
worked in either position while `--config`/`--force` never did, for no reason beyond "these
three seemed worth the convenience." The standard is now uniform — a flag goes on the command
that uses it — with `-c`/`--cwd` as the sole exception, because it is consumed before dispatch
and its short form collides with `--config` after the subcommand.

**Superseded:** the original D1 hoisted `--dry-run`, `--json`, `--yes` out of `rawArgs` before
citty dispatch and re-injected them into the leaf command's parsed args, the same mechanism
`-c`/`--cwd` used.
