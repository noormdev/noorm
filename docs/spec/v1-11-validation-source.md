# Spec: v1-11 single source of truth for config/secret validation rules

- Ticket: `tickets/v1/11-validation-single-source.md`
- Findings: AP-dup-01, AP-dup-02, AP-dup-03, AP-dup-04
  (`research/v1-audit/atomic-principles/duplication.md`)
- **Stacked branch.** Base is `v1/29-locked-stage-guard` at `d0ed966`, not `master` — ticket 29
  added `StateManager.deleteConfig`'s locked-stage guard, touching the same file
  (`src/core/state/manager.ts`) this ticket also modifies (`StateManager.setSecret`).
  Stacking avoids a manager.ts merge conflict between the two tickets. Review/CI scope for
  this ticket is the delta on top of `d0ed966`, not the delta from `master`. If `v1/29`
  merges to `master` first, this branch stays valid as-is; if this ticket ships first, `v1/29`
  is unaffected (different methods on the same class).

## Goal

Four business rules are each hand-duplicated 2-5x across CLI/TUI/core surfaces, and one of
the duplicates has already drifted into a real gap:

1. The config-validate algorithm (connection test + name/database + host-for-non-sqlite) is
   implemented independently in `src/cli/config/validate.ts` and
   `src/tui/screens/config/ConfigValidateScreen.tsx`.
2. `DEFAULT_PORTS` (`postgres: 5432, mysql: 3306, mssql: 1433, sqlite: 0`) is declared twice
   verbatim (`src/core/transfer/same-server.ts`, `src/tui/utils/config-validation.ts`) and
   hardcoded a third time per dialect factory (`postgres.ts`, `mysql.ts`, `mssql.ts` — the
   last hardcodes it twice, once in the pool config and again in an error message).
3. The TUI's live-form config-name/port validators (`CONFIG_NAME_PATTERN`, `validatePort` in
   `src/tui/utils/config-validation.ts`) hand-copy the regex/bounds that
   `src/core/config/schema.ts`'s `ConfigNameSchema`/`PortSchema` already enforce at save time.
4. The secret-key identifier format (`/^[A-Za-z][A-Za-z0-9_]*$/`) is checked in **three**
   independent TUI copies (`SECRET_KEY_PATTERN`/`validateSecretKey` in
   `src/tui/components/secrets/types.ts`, and a second hand-copied regex inline in
   `src/tui/components/secrets/SecretValueForm.tsx:115` — found during spec authoring,
   not called out in AP-dup-04's evidence list but the same rule, same drift risk) and
   **nowhere** in `StateManager.setSecret` — the seam CLI, SDK, and MCP all funnel through.
   Today `noorm secret set "key with spaces" v` succeeds via the CLI while the identical
   input is rejected in the TUI form.

Consolidate each rule to one definition; wire every consumer to import it. Close the
secret-key gap as the one deliberate behavior change.

## Contract

- **Validate algorithm.** One function in `src/core/config/` computing the three-check
  sequence (connection test, name/database presence, host presence for non-sqlite) and
  returning an ordered check-result list. `cli/config/validate.ts` and
  `ConfigValidateScreen.tsx` both call it; each keeps only its own presentation layer
  (text/JSON output vs `StatusList`/toast). No change to which checks run, their order, their
  keys/labels, or the pass/fail boundary.
- **DEFAULT_PORTS.** One exported `Record<Dialect, number>` in `src/core/connection/`.
  `same-server.ts`, `tui/utils/config-validation.ts`, and the three dialect factories
  (`postgres.ts`, `mysql.ts`, `mssql.ts` — both its hardcodes) import it instead of declaring
  or hardcoding their own copy. Same values, same behavior.
- **Name/port schemas.** `ConfigNameSchema` and `PortSchema` exported from
  `src/core/config/schema.ts` (currently module-private). The TUI's
  `validateConfigName`/`validatePort` in `src/tui/utils/config-validation.ts` become thin
  wrappers translating `.safeParse()` results into the existing `string | undefined` form-error
  shape. Same accept/reject boundary (min-length 1, `/^[a-z0-9_-]+$/i`, port 1-65535
  inclusive); the TUI's uniqueness check (`existingNames`) stays TUI-side — it is
  application state, not a static schema rule, and has no schema equivalent. Displayed
  error-message *text* may shift to the schema's canonical wording where a wrapper adopts the
  Zod issue message directly — that is presentation, not one of the accept/reject rules this
  ticket is barred from changing, so it is in scope for this consolidation, not a deviation to
  flag.
- **Secret-key format — the gap closure.** `StateManager.setSecret(configName, key, value)`
  validates `key` against the identifier pattern
  (`/^[A-Za-z][A-Za-z0-9_]*$/`, matching the existing TUI rule exactly — no change to what
  counts as a valid key) as its first validation step, before the "config exists" check or any
  state mutation. Invalid key → throws a **named** error (D1 producer-throw convention:
  `class X extends Error` with `override readonly name = 'X' as const`, matching
  `ConfigStageLockedError`/`ConfigValidationError`). After this, `noorm secret set "key with
  spaces" v` fails identically through CLI (`cli/secret/set.ts`), the CI bulk-import path
  (`cli/ci/secrets.ts`), the TUI (`SecretSetScreen.tsx`, `ConfigImportScreen.tsx`), and any
  future SDK/MCP caller — because they all call `StateManager.setSecret`. The TUI's
  `validateSecretKey` (`tui/components/secrets/types.ts`) and the inline regex in
  `SecretValueForm.tsx` both become thin wrappers around the same core check (live-typing
  feedback only — the StateManager check is the actual enforcement).

## Design

### `src/core/config/validate.ts` (new)

- `export interface ConfigCheckResult { key: string; label: string; status: 'success' |
  'error'; detail: string }`
- `export async function validateConfigChecks(config: Config): Promise<{ checks:
  ConfigCheckResult[]; valid: boolean }>` — ports the exact three-check body currently
  duplicated in `cli/config/validate.ts` (lines 60-101) and `ConfigValidateScreen.tsx`
  (lines 65-135): connection test via `testConnection` from `../connection/factory.js`, then
  `name`/`database` presence, then `host` presence when `dialect !== 'sqlite'`. Same keys
  (`connection`, `name`, `database`, `host`), same labels, same detail strings, same
  fail-fast-nothing semantics (all checks always run; `valid` is the AND of all of them).
- `cli/config/validate.ts`: replace the inline `checks`/`valid` construction with a call to
  `validateConfigChecks(config)`; keep the text/JSON output formatting as-is.
- `ConfigValidateScreen.tsx`: replace the inline `results`/`allValid` construction with a call
  to `validateConfigChecks(config)`. The screen loses the sub-row "pending" state on the
  connection check specifically (the whole check list now resolves as one batch) — the
  screen-level `<Spinner label="Validating configuration..." />` (already rendered while
  `items.length === 0`) continues to cover the wait. This is a presentational simplification
  from batching three checks that used to be interleaved with one `setItems` call per step;
  it does not change what is checked or its result.

### `src/core/connection/defaults.ts` (new)

- `export const DEFAULT_PORTS: Record<Dialect, number> = { postgres: 5432, mysql: 3306,
  sqlite: 0, mssql: 1433 }` — moved verbatim from `same-server.ts`.
- Exported from `src/core/connection/index.ts` alongside the existing `factory`/`manager`/
  `types` exports.
- `same-server.ts`: drop the local `DEFAULT_PORTS` const, import from `../connection/
  defaults.js`. `getDefaultPort()` stays in this file unchanged (still the only place it's
  used/tested — `tests/core/transfer/same-server.test.ts`); it now reads the imported
  constant instead of a local one.
- `tui/utils/config-validation.ts`: drop the local `DEFAULT_PORTS` export, import from
  `../../core/connection/index.js` and re-export it (the barrel at `tui/utils/index.ts`
  re-exports `DEFAULT_PORTS` from this module today — keep that export path stable so nothing
  outside this file needs to change its import).
- `dialects/postgres.ts`: `config.port ?? 5432` → `config.port ?? DEFAULT_PORTS.postgres`,
  importing `DEFAULT_PORTS` from `../defaults.js`.
- `dialects/mysql.ts`: same pattern, `DEFAULT_PORTS.mysql`.
- `dialects/mssql.ts`: same pattern for both hardcodes — the pool-config default in
  `buildTediousConfig` (`config.port ?? 1433`) and the error-message interpolation in
  `verifyDatabaseExists` (`` `...${config.port ?? 1433}` ``) both become
  `DEFAULT_PORTS.mssql`.

### `src/core/config/schema.ts`

- Export `ConfigNameSchema` and `PortSchema` (currently declared `const`, module-private) —
  add both to the file's existing named exports. No change to either schema's rules.

### `src/tui/utils/config-validation.ts`

- `validateConfigName(value, existingNames?)`: run `ConfigNameSchema.safeParse(value)` first;
  on failure return the first Zod issue's message (or a fallback string if the issues array is
  somehow empty). On success, keep the existing `existingNames?.includes(value)` uniqueness
  check as-is (schema has no concept of "existing names"). Delete the local
  `CONFIG_NAME_PATTERN` regex.
- `validatePort(value)`: keep the `!value → undefined` (optional field) and
  `isNaN(parseInt(...)) → error` short-circuits (Zod's `z.number()` input contract expects an
  actual `number`, not a `NaN`; keeping the `isNaN` guard avoids passing `NaN` into
  `.safeParse()` and gives a consistent message for non-numeric input). For a valid integer,
  run `PortSchema.safeParse(port)` and map failure to an error string. Delete the manual
  `port < 1 || port > 65535` bounds check — the schema is now the only place that bound lives.
- Import `ConfigNameSchema`/`PortSchema` from `../../core/config/schema.js`.

### `src/tui/screens/settings/SettingsStageEditScreen.tsx`

- The stage-defaults "Default Port" field carries a fourth independent copy of the
  1-65535 bound (inline `isNaN(port) || port < 1 || port > 65535` → `'Port must be
  1-65535'`, line ~148) — a TUI live-form port validator with a hand-copied bound, the
  exact class this ticket's item 3 targets. It was not enumerated in AP-dup-03's evidence
  list (the audit's Coverage section records `core/settings` screens as not examined in
  depth), but the acceptance criterion "`rg` finds no surviving copies" of the port rule
  is literal, so it is in scope for this consolidation. Surfaced by the checkpoint-2
  implementer.
- Authority: a stage-default port is validated at save time by **`core/settings/schema.ts`**
  (`StageDefaultsSchema.port` → that file's private `PortSchema`), NOT by
  `core/config/schema.ts`'s `PortSchema`. So the correct authoritative schema for this
  screen is the **settings** `PortSchema` — pointing the live-form validator at the same
  schema that governs the data at save time is the whole point of the ticket (prevent
  live-form vs save-time divergence).
- Export `PortSchema` from `core/settings/schema.ts` (currently module-private) and replace
  the screen's inline validator body with a `PortSchema.safeParse(port)` delegation,
  keeping the existing `!value → undefined` (optional) and `isNaN → error` short-circuits
  (same shape as the `config-validation.ts` `validatePort` rewrite). Same accept/reject
  (1-65535 integer); displayed message text may shift to the schema's canonical Zod wording
  (presentation, allowed).

### `src/core/state/manager.ts` — the gap closure

- Add `InvalidSecretKeyError extends Error` (colocated in this file, next to `setSecret`,
  matching the `ConfigStageLockedError` convention already in this codebase — `override
  readonly name = 'InvalidSecretKeyError' as const`, constructor takes the offending `key`
  and formats the message: `` `Secret key "${key}" is invalid: must start with a letter and
  contain only letters, numbers, and underscores` ``).
- `setSecret(configName, key, value)`: add a validation-block check —
  `/^[A-Za-z][A-Za-z0-9_]*$/.test(key)` — as the **first** statement, before the "config
  exists" check. Throws `InvalidSecretKeyError` on failure. No `attempt()` — this function
  does nothing with the error beyond throwing it (D1: throw at producer).
- The identifier regex is a two-line literal at the point of use, matching how
  `ConfigStageLockedError`'s sibling checks in this codebase are simple inline conditions
  (`canDeleteConfig`) — no separate exported constant is needed in `core/state` since nothing
  else in core needs to reuse the raw pattern (the TUI wrappers call the throwing function via
  a safe-parse-style helper, not the regex directly — see below).
- Export `InvalidSecretKeyError` from `src/core/state/index.ts` alongside the existing
  `StateManager` export.

### `src/tui/components/secrets/types.ts`

- `SECRET_KEY_PATTERN` and `validateSecretKey(key)` become a thin wrapper: trim, check
  non-empty (`'Key is required'`, unchanged — StateManager has no equivalent "required" rule
  since it never receives an empty call in practice, this is a form-level required-field
  check, not the format rule), then delegate the format check to a **non-throwing** probe of
  the same rule `StateManager` enforces. Since `StateManager.setSecret` only throws (it is not
  a pure predicate), add a small exported helper next to `InvalidSecretKeyError` in
  `core/state/manager.ts` (or `core/state/index.ts`): `export function isValidSecretKey(key:
  string): boolean` returning the regex test result, used by both `setSecret` (validation
  block) and the TUI wrappers (live-typing feedback) so the pattern itself has exactly one
  literal occurrence in the codebase. `validateSecretKey` calls `isValidSecretKey(trimmed)`
  and returns the existing message string on failure — same message, same behavior.

### `src/tui/components/secrets/SecretValueForm.tsx`

- Line 115's inline `/^[A-Za-z][A-Za-z0-9_]*$/.test(val)` is deleted; the `validate` callback
  for the add-mode `secretKey` field calls `isValidSecretKey(val)` (imported from
  `core/state`) instead, keeping the same returned message string. This is the field that
  actually gates what `StateManager.setSecret` receives when adding a new secret by key, so
  it is the highest-value of the three duplicate copies to converge — flagged during spec
  authoring as an additional site beyond AP-dup-04's listed evidence, same rule, in scope.

## Checkpoints

| # | Scope | Done when |
|---|-------|-----------|
| 1 | `core/config/validate.ts` (new), wire `cli/config/validate.ts` + `ConfigValidateScreen.tsx`; `core/connection/defaults.ts` (new), wire `same-server.ts`, `tui/utils/config-validation.ts`, `dialects/{postgres,mysql,mssql}.ts` | New tests for `validateConfigChecks` (all-pass sqlite case, missing-host non-sqlite case) and for `DEFAULT_PORTS` single-definition (`rg` proof, see below) pass. `bun run typecheck` clean. `rg "DEFAULT_PORTS\s*[:=]\s*\{" src` and `rg "port:\s*5432|port:\s*3306|port:\s*1433" src/core/connection/dialects` find zero hits outside `core/connection/defaults.ts`. |
| 2 | `core/config/schema.ts` (export `ConfigNameSchema`/`PortSchema`); `core/settings/schema.ts` (export `PortSchema`); `tui/utils/config-validation.ts` (`validateConfigName`/`validatePort` call the config schemas); `tui/screens/settings/SettingsStageEditScreen.tsx` (port validator calls the settings `PortSchema`) | Existing `tests/cli/config-validation.test.ts` still green (unmodified). New tests: TUI validators reject/accept the exact same boundary cases as before (empty, bad chars, dup name, port 0/1/65535/65536/non-numeric), for both the config-form and stage-defaults port validators. `rg "CONFIG_NAME_PATTERN|port < 1 \|\| port > 65535"` finds zero hits across `src` (all four TUI hand-copies gone). |
| 3 | `core/state/manager.ts` (`InvalidSecretKeyError`, `isValidSecretKey`, `setSecret` gap closure), `core/state/index.ts` export; `tui/components/secrets/types.ts` + `SecretValueForm.tsx` wired to `isValidSecretKey` | **Failing test first**: a `StateManager.setSecret(configName, 'key with spaces', 'v')` test that fails on current code, passes after the fix, asserting `InvalidSecretKeyError` — this is the seam that covers CLI (`cli/secret/set.ts`, `cli/ci/secrets.ts`), SDK, and MCP identically. Valid keys (existing `manager.test.ts` cases) unaffected. `rg "A-Za-z][A-Za-z0-9_]"` (the identifier pattern) finds exactly one literal occurrence (`core/state/manager.ts`) plus its usages — zero independent copies in `src/tui/**`. |

## Acceptance criteria (verbatim from ticket 11)

- `noorm secret set "key with spaces" v` fails identically via CLI, SDK, and MCP (tests at the
  StateManager seam).
- One definition each for the validate algorithm, ports table, name/port schemas; `rg` finds
  no surviving copies.

## Out of scope

- Changing what any of the four rules accept or reject, beyond the secret-key gap closure
  (the ticket's one explicit exception). Message-*text* changes that fall out of adopting the
  schema's canonical Zod wording are not a rule change (see Contract) but the underlying
  accept/reject boundary must be provably identical — checkpoint 2's boundary-case tests exist
  specifically to prove this.
- AP-dup-05 through AP-dup-08 (change-manager factory bypass, MCP-channel visibility
  duplication, `withScreenConnection` dead code, access-tag display duplication) — separate
  findings, separate tickets.
- Adding a `setSecret`-equivalent write path to the SDK's `SecretsNamespace` (`src/sdk/
  namespaces/secrets.ts`, currently read-only — `get()` only) or to MCP — out of scope. The
  ticket's "SDK/MCP inherit enforcement" claim is about the shared seam (any future caller of
  `StateManager.setSecret` gets the check for free), not about adding new SDK/MCP surfaces.
- **Merging the two core Zod `PortSchema` definitions** (`core/config/schema.ts` and
  `core/settings/schema.ts`) into one shared schema. Both encode the identical 1-65535 bound,
  so this is a real core-vs-core duplication — but it is a different finding than AP-dup-03
  (which is about TUI hand-copies vs the authoritative Zod schema, not two core schemas), the
  audit never examined it (Coverage lists `core/settings` as not examined in depth), and
  whether a stage-default port and a config port are "one rule" or "two rules that agree
  today" is a design question, not mechanical dedup. This ticket points each TUI validator at
  its own domain's authoritative schema (config validator → config `PortSchema`, stage-defaults
  validator → settings `PortSchema`), which fully closes the TUI hand-copies; the two core
  schemas staying separate is recorded as a follow-up (F-2) for a future ticket.
- `src/core/config/resolver.ts`'s `checkConfigCompleteness` (stage-required-secrets check) —
  a different check than the three-check validate algorithm this ticket consolidates; already
  correctly single-sourced, not touched.

## Change log

- 2026-07-12 — initial spec.
- 2026-07-12 — checkpoint 2 scope extended: a fourth port-bound hand-copy in
  `SettingsStageEditScreen.tsx` (surfaced by the CP2 implementer, not in AP-dup-03's evidence
  list) is included so the "no surviving copies" acceptance criterion holds repo-wide; wired to
  the authoritative **settings** `PortSchema`. Merging the two core `PortSchema` definitions is
  explicitly deferred (see Out of scope + F-2). No accept/reject change.
