---
type: Domain
---

# core-policy

## What it does

Single access-control layer for every config-scoped action across every caller channel (CLI, TUI, SDK, MCP). Roles live on the config (`ConfigAccess`), not the actor — the actor is a `Channel` (`user` or `mcp`) — and a hard-coded permission × role matrix (`MATRIX`) resolves `allow`/`confirm`/`deny` per action. Replaces the removed `Config.protected: boolean` and the deleted `src/core/config/protection.ts` / `src/rpc/protection.ts` rule checkers.

Also owns raw-SQL statement classification (`read`/`write`/`ddl`, with a destructive-function denylist) used to gate ad-hoc SQL, and the one-version `protected` boolean → `access` migration path (`resolveLegacyAccess`).

## CLI code

- [`src/core/policy/types.ts`](../../src/core/policy/types.ts) — `Role` (`viewer`/`operator`/`admin`), `Channel` (`user`/`mcp`), `ConfigAccess` (`{ user: Role; mcp: Role | false }`), `Permission`, `PolicyTarget`, `PolicyCell` (`allow`/`confirm`/`deny`), `PolicyCheck`
- [`src/core/policy/matrix.ts`](../../src/core/policy/matrix.ts) — `MATRIX`; the hard-coded `Permission × Role → PolicyCell` table (not user-extensible), mirroring [`docs/spec/config-access-roles.md`](../spec/config-access-roles.md)
- [`src/core/policy/check.ts`](../../src/core/policy/check.ts) — `checkPolicy`, `checkConfigPolicy`, `assertPolicy`, `guarded`, `confirmationPhraseFor`; the enforcement entrypoints every caller reaches for
- [`src/core/policy/classify.ts`](../../src/core/policy/classify.ts) — `classifyStatements`; SQL-parser-cst-based statement classifier with a keyword-based fallback, a CTE-DML upgrade rule, and `DESTRUCTIVE_FUNCTIONS` denylist (e.g. `pg_terminate_backend`, `lo_import`, `setval`)
- [`src/core/policy/legacy-access.ts`](../../src/core/policy/legacy-access.ts) — `resolveLegacyAccess`, `DEFAULT_ACCESS` (`{ user: 'admin', mcp: 'viewer' }`), `GUARDED_ACCESS` (`{ user: 'operator', mcp: 'viewer' }`)
- [`src/core/policy/index.ts`](../../src/core/policy/index.ts) — barrel export for all of the above

## Docs

- [`docs/spec/config-access-roles.md`](../spec/config-access-roles.md) — implementation contract: data model, matrix, migration
- [`docs/design/config-access-roles.md`](../design/config-access-roles.md) — design rationale for the role model
- [`docs/dev/config.md`](../dev/config.md), [`docs/dev/config-sharing.md`](../dev/config-sharing.md) — updated to describe `access` in place of `protected`
- [`docs/guide/environments/configs.md`](../guide/environments/configs.md), [`docs/guide/environments/stages.md`](../guide/environments/stages.md) — user-facing access-role guidance
- [`skills/noorm/references/config.md`](../../skills/noorm/references/config.md) — skill reference for config access roles

## Coupling

- [`src/core/config/schema.ts`](../../src/core/config/schema.ts)/`types.ts` and [`src/core/state/manager.ts`](../../src/core/state/manager.ts) import `resolveLegacyAccess`/`ConfigAccess` — see the `core-state` domain for where `access` is resolved, defaulted, and backfilled.
- [`src/core/change/executor.ts`](../../src/core/change/executor.ts), [`src/core/runner/runner.ts`](../../src/core/runner/runner.ts), [`src/core/transfer/index.ts`](../../src/core/transfer/index.ts), and [`src/core/sql-terminal/executor.ts`](../../src/core/sql-terminal/executor.ts) all call `assertPolicy` at their core seam — see `core-change`, `core-runner`, `core-db`, and `core-identity` respectively.
- [`src/mcp/server.ts`](../../src/mcp/server.ts) and [`src/rpc/types.ts`](../../src/rpc/types.ts) gate every non-`'open'` `RpcCommand` via `checkConfigPolicy` — see `mcp-rpc`.
- [`src/sdk/guards.ts`](../../src/sdk/guards.ts) and [`src/sdk/index.ts`](../../src/sdk/index.ts) wrap `checkConfigPolicy` for the SDK's `channel`-aware guards — see `sdk`.
- [`src/tui/components/dialogs/SmartConfirm.tsx`](../../src/tui/components/dialogs/SmartConfirm.tsx)/`ProtectedConfirm.tsx` and every destructive-action TUI screen call `checkConfigPolicy` directly to build confirm-dialog props — see `tui`.
- [`src/core/settings/rules.ts`](../../src/core/settings/rules.ts)'s `protected` rule-match key checks `guarded(config)`, not a config field — see `core-state`.

## Conventions worth knowing

- `checkPolicy`'s `confirm` cell resolves differently per channel: `user` prompts for `yes-<config>` (`confirmationPhraseFor`, skippable via `NOORM_YES`), `mcp` collapses `confirm` to `deny` — there's no human on the other end of MCP stdio to type a phrase.
- `mcp: false` (invisible config) is never a role and is not expected to reach `checkPolicy` — visibility is enforced upstream (`SessionManager.connect`, `list_configs`).
- `checkConfigPolicy` fails closed: a config with no `access` at all is denied on every channel.
- `classifyStatements` fails closed to `ddl` for anything it can't positively classify as `read` or `write` — an unrecognized statement could do anything.
- `DESTRUCTIVE_FUNCTIONS` is a denylist, not an allowlist, by design: `SELECT f()` is statically undecidable, so only known-dangerous builtins upgrade a `SELECT` to `write`.
- `guarded(target)` (`target.access.user !== 'admin'`) is display-only — used by TUI styling, `config list`, and settings rule matching — never an enforcement input.
- Tests: [`tests/core/policy/check.test.ts`](../../tests/core/policy/check.test.ts) (270L) covers `checkPolicy`/`checkConfigPolicy`/`assertPolicy`/`guarded`/`confirmationPhraseFor`; [`tests/core/policy/classify.test.ts`](../../tests/core/policy/classify.test.ts) (446L) covers read/write/ddl classification, multi-statement, CTE handling, CTE-DML, and the destructive-function denylist.
