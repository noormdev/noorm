# Spec: `--yes` satisfies confirmation gates on db truncate/teardown/reset (v1 ticket 02)


## Goal

The documented headless flag must work. `noorm db truncate --yes`, `noorm db teardown --yes`, and `noorm db reset --yes` must succeed headlessly for operator-role configs without requiring `NOORM_YES` in the environment. Today all three funnel into the SDK guard `checkProtectedConfig`, whose confirmation check reads only the `NOORM_YES` env var; nothing threads the CLI's resolved `--yes` decision into it, so the flag the commands themselves document fails with "set NOORM_YES=1".

While in there, unify the two divergent `NOORM_YES` truthiness rules (`shouldSkipConfirmations` accepts only `'1'`/`'true'`; `isYesMode` accepts any non-empty string except `'0'`/`'false'`) into one shared parser that tickets 24 (`NOORM_DEBUG`) and 28 (`config rm --yes`) will reuse.


## Evidence

- Ticket: `tickets/v1/02-yes-flag-confirmation.md` (finding QL-safe-02, corroborates VR-cli-06)
- Audit: `research/v1-audit/quality-lenses/destructive-safety.md` QL-safe-02
- `src/cli/db/reset.ts:23-28` — CLI pre-gate checks bare `args.yes` only
- `src/cli/db/truncate.ts:8-63`, `src/cli/db/teardown.ts:8-77` — declare `yes: sharedArgs.yes`, document `--yes` in examples, never read `args.yes`
- `src/sdk/guards.ts:103-128` — `checkProtectedConfig` throws `ProtectedConfigError` on `requiresConfirmation`; receives only `Pick<CreateContextOptions, 'channel'>`
- `src/sdk/namespaces/db.ts:278,300,321` — truncate/teardown/reset each call `checkProtectedConfig(this.#state.config, this.#state.options, 'db:reset', ...)`
- `src/core/policy/check.ts:79` — `checkPolicy` resolves `confirm` cells via `shouldSkipConfirmations()`
- `src/core/environment.ts:101-107` — `shouldSkipConfirmations` accepts only `'1'`/`'true'`
- `src/cli/_utils.ts:75-87` — `isYesMode` accepts `args.yes` OR any non-empty `NOORM_YES` except `'0'`/`'false'` (case-insensitive)
- `src/cli/db/drop.ts:59-76` — the correct pattern: policy check + `if (check.requiresConfirmation && !args.yes)` deny
- `src/core/policy/matrix.ts:19-21` — `db:reset` is `confirm` for operator, `allow` for admin


## Contract

### C1 — shared env-truthiness parser

New exported function in `src/core/environment.ts`:

```typescript
export function isEnvTruthy(value: string | undefined): boolean
```

Pure string parser; takes the env-var value, not the var name. Placed in `core/environment.ts` because `core/environment` is its own first consumer, it has no imports of its own, and both `src/cli/_utils.ts` and future core call sites (tickets 24, 28) already import from it.

**Unified truthiness semantics — exhaustive.** A value is truthy iff it is a non-empty string that is not `'0'` and not `'false'` in any letter case. No trimming; comparison against the raw string.

| Input | Result |
|-------|--------|
| `undefined` | false |
| `''` (empty string) | false |
| `'0'` | false |
| `'false'`, `'FALSE'`, `'False'`, any case-mix of `false` | false |
| `'1'` | true |
| `'true'`, `'TRUE'`, any case-mix of `true` | true |
| `'yes'` | true |
| any other non-empty string (incl. `'no'`, `'off'`, `'00'`, `' '`, `' 0'`) | true |

`'no'`/`'off'` being truthy is deliberate: this is the documented `isYesMode` semantic today (`src/cli/_utils.ts:59-64`), and the ticket unifies onto one rule rather than inventing a third. Narrowing the string set is out of scope.

Delegation — both existing rules collapse onto the parser:

- `shouldSkipConfirmations()` (`src/core/environment.ts`) becomes `return isEnvTruthy(process.env['NOORM_YES'])`. This *widens* its accepted set from `'1'`/`'true'` to the table above, at every `checkPolicy` confirm-cell resolution (user channel).
- `isYesMode(args)` (`src/cli/_utils.ts`) becomes `args.yes` OR `isEnvTruthy(process.env['NOORM_YES'])`. Its observable behavior is unchanged.

Existing tests that pin the old narrow semantics (e.g. `tests/core/config/env.test.ts:354+`, `tests/core/policy/check.test.ts:139-151`) must be updated to the unified contract — that update is the point of the ticket, not collateral damage.

### C2 — thread the resolved yes-decision into the SDK guard

- `CreateContextOptions` (`src/sdk/types.ts`) gains an optional field:

    ```typescript
    /**
     * Pre-confirm operations that a policy `confirm` cell would otherwise
     * block — the programmatic equivalent of the CLI's --yes. Only
     * meaningful on the user channel; mcp collapses confirm to deny
     * before this is consulted. Default: false.
     */
    yes?: boolean;
    ```

- `checkProtectedConfig` (`src/sdk/guards.ts`) widens its options param to `Pick<CreateContextOptions, 'channel' | 'yes'>` and mirrors `db drop`'s gate: throw `ProtectedConfigError` only when `check.requiresConfirmation && !options.yes`. The confirmation error message must name both `--yes` and `NOORM_YES=1` as remedies.
- No change inside `src/sdk/namespaces/db.ts` — truncate/teardown/reset already pass `this.#state.options` through; the field rides along. (`dt.ts:70` and `transfer.ts:46` share the guard and inherit the same behavior; that is intended, not drift.)
- `withContext` (`src/cli/_utils.ts`) passes the resolved decision when creating the context: `createContext<NoormDatabase>({ config: args.config, yes: isYesMode(args) })`. `withVaultContext` is untouched (no vault command funnels into `checkProtectedConfig`'s confirm path; ticket 28 owns its surface).

**Invariant (must be tested):** on the `mcp` channel, `confirm` collapses to deny in `checkPolicy` *before* any confirmation-skip logic, so `yes: true` never unblocks an MCP-channel context. Ruling D2 (2026-07-11) affirmed current MCP access defaults; this spec must not alter MCP-channel behavior.

### C3 — CLI command behavior

- `db reset` (`src/cli/db/reset.ts`): CLI pre-gate switches from bare `args.yes` to `isYesMode(args)`, so `NOORM_YES` satisfies it the same as `--yes` (one rule everywhere). The pre-gate itself stays — reset remains gated for every role via CLI, as today.
- `db truncate` / `db teardown`: no new CLI pre-gate. Admin-role configs keep running without confirmation (matrix `allow`); operator-role configs are unblocked by `--yes`/`NOORM_YES` via C2. The command bodies need no change — the decision rides through `withContext`.
- `db drop` is untouched; it already implements the pattern (and `checkPolicy`'s internal env check plus its own `args.yes` check cover both routes).

### Resulting behavior matrix (user channel, `db:reset` permission)

| Config role | Flag/env | Before | After |
|-------------|----------|--------|-------|
| operator | none | ProtectedConfigError | ProtectedConfigError (message names `--yes` and `NOORM_YES`) |
| operator | `--yes` | ProtectedConfigError ("set NOORM_YES=1") | succeeds |
| operator | `NOORM_YES=1` | succeeds | succeeds |
| operator | `NOORM_YES=yes` | ProtectedConfigError | succeeds (unified truthiness) |
| operator | `NOORM_YES=0` / `false` / empty | ProtectedConfigError | ProtectedConfigError |
| admin | none | allow (reset CLI still requires its `--yes` pre-gate) | unchanged |
| viewer | `--yes` | deny (matrix) | deny — `--yes` never overrides deny |
| any (mcp channel) | `yes: true` | deny (confirm collapses to deny) | deny — unchanged |


## Checkpoints

| # | Checkpoint | Independently verifiable by |
|---|-----------|------------------------------|
| CP-1 | `isEnvTruthy` exists in `src/core/environment.ts` with the exhaustive semantics above; `shouldSkipConfirmations` and `isYesMode` delegate to it; no other copy of `NOORM_YES` truthiness logic remains in src/ | Unit tests in `tests/core/config/env.test.ts` (parser table: `1`/`true`/`TRUE`/`yes`/arbitrary → true; `0`/`false`/`FALSE`/empty/undefined → false) and `tests/cli/yes-flag.test.ts` (isYesMode parity); grep shows no `NOORM_YES` string comparison outside the parser and its two delegators |
| CP-2 | `CreateContextOptions.yes` exists; `checkProtectedConfig` allows a `requiresConfirmation` result when `options.yes` is true and still throws when absent/false; error message names `--yes` and `NOORM_YES`; `yes: true` does NOT unblock mcp channel | Unit tests in `tests/sdk/guards.test.ts` (operator + `yes: true` → no throw; operator + no yes + no env → `ProtectedConfigError`; mcp + `yes: true` → throws) |
| CP-3 | SDK gate-level: `ctx.noorm.db.truncate()/teardown()/reset()` on an operator-role config pass the guard when the context was created with `yes: true` and no `NOORM_YES` env | Tests in `tests/sdk/destructive-ops.test.ts` following that file's existing harness, covering all three methods |
| CP-4 | CLI: `db reset` pre-gate accepts `NOORM_YES` via `isYesMode`; `withContext` passes `yes: isYesMode(args)` into `createContext`; truncate/teardown/reset CLI paths carry the flag (mirroring `tests/cli/db/drop.test.ts` as far as the CLI test harness permits without a live DB) | Tests in `tests/cli/yes-flag.test.ts` and/or `tests/cli/db/`; anything requiring a live database is recorded as integration-deferred in TESTING.md, not silently skipped |
| CP-5 | Quality signals green: `bun run typecheck`, `bun run lint`, and every touched test file passes in isolation | Orchestrator-run commands |


## Acceptance criteria (ticket, verbatim)

- `noorm db truncate --yes` (operator-role config, no NOORM_YES) succeeds headlessly; same for teardown/reset.
- One truthiness parser for NOORM_YES across all call sites, with tests for `1/true/0/false/empty`.


## Out of scope

- MCP-channel behavior — ruling D2 (2026-07-11) affirmed current access defaults; `confirm`-to-deny collapse on mcp is preserved untouched (QL-safe-03 is a separate ticket).
- Narrowing or otherwise changing which strings the unified parser accepts beyond the documented `isYesMode` semantics (e.g. making `'no'`/`'off'` falsy).
- Migrating `NOORM_DEBUG` / `NOORM_DEV` / `NOORM_HEADLESS` / `NOORM_JSON` / `NOORM_LOGGER_DEBUG` checks onto the parser (ticket 24 owns NOORM_DEBUG; the rest are unowned).
- `config rm --yes` (ticket 28).
- Adding new CLI pre-gates to `db truncate` / `db teardown`, or changing `db drop`.
- `withVaultContext` threading.
- TUI confirmation screens (they call `checkConfigPolicy` directly and keep their type-to-confirm flow).
- Live-DB integration tests (docker services owned elsewhere right now; deferred via TESTING.md).


## Test commands (scoped)

```bash
bun test tests/core/config/env.test.ts
bun test tests/core/policy/check.test.ts
bun test tests/sdk/guards.test.ts
bun test tests/sdk/destructive-ops.test.ts
bun test tests/cli/yes-flag.test.ts
bun test tests/cli/db/drop.test.ts
bun run typecheck
bun run lint
```

Plus any test file the implementation adds or touches, run individually. Whole-group runs and `tests/integration` are orchestrated centrally — do not run them from this task.


## Change log

- 2026-07-12 — Initial spec authored from ticket 02 + QL-safe-02 evidence (spec-only, no design doc, per project ruling).

## Implementation log

### shipped (branch v1/02-yes-flag, unmerged) — 2026-07-12

Built across 2 iterations of /subagent-implementation. Commits (chronological):

- `9003555` — spec authored
- `59e7032` — CP-1..CP-4: isEnvTruthy parser + delegation, CreateContextOptions.yes, checkProtectedConfig honors yes, withContext threading, reset pre-gate isYesMode, full test coverage (15 unit + 6 CLI subprocess + mcp collapse case)

**Out-of-scope work performed during this build:**

- none

**Unforeseens — surprises that emerged during implementation:**

- CLI subprocess tests need `dist/` — central verification must `bun run build` before running tests/cli (recorded in scratchpad TESTING.md).
- A sqlite fixture in the CLI harness let the ticket acceptance criterion be proven end-to-end without docker — no integration deferral needed for it.

**Deferred items still open:**

- none (FOLLOWUPS ledger empty; both iteration-1 reviewer findings closed in iteration 2)
