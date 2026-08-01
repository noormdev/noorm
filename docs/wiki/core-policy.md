---
type: Domain
description: Access-control policy — role×permission matrix, SQL statement classifier, and the legacy protected→access migration, imported by every caller channel that enforces a config-scoped action.
---

# core-policy

## What it does

Single access-control layer for every config-scoped action across every caller channel (CLI, TUI, SDK, MCP). Roles live on the config (`ConfigAccess`), not the actor — the actor is a `Channel` (`user` or `agent`) — and a hard-coded permission × role matrix (`MATRIX`) resolves `allow`/`confirm`/`deny` per action. Replaces the removed `Config.protected: boolean` and the deleted `src/core/config/protection.ts` / `src/rpc/protection.ts` rule checkers.

Also owns raw-SQL statement classification (`read`/`write`/`ddl`, with a destructive-function denylist) used to gate ad-hoc SQL, and the one-version `protected` boolean → `access` migration path (`resolveLegacyAccess`).

## Artifacts

- [`src/core/policy/types.ts`](../../src/core/policy/types.ts) — `Role` (`viewer`/`operator`/`admin`), `Channel` (`user`/`agent`), `ConfigAccess` (`{ user: Role; agent: Role | false }`), `Permission`, `PolicyTarget`, `PolicyCell` (`allow`/`confirm`/`deny`), `PolicyCheck`
- [`src/core/policy/matrix.ts`](../../src/core/policy/matrix.ts) — `MATRIX`, the hard-coded `Permission × Role → PolicyCell` table (not user-extensible), mirroring [`docs/spec/config-access-roles.md`](../spec/config-access-roles.md)
- [`src/core/policy/check.ts`](../../src/core/policy/check.ts) — `checkPolicy`, `checkConfigPolicy`, `assertPolicy`, `isVisibleToChannel`, `guarded`, `formatAccessTag`, `confirmationPhraseFor`; the enforcement and display entrypoints every caller reaches for
- [`src/core/policy/channel.ts`](../../src/core/policy/channel.ts) — `resolveChannel`; resolves `NOORM_CHANNEL` env override, then harness provenance (`isAgentSession`), then defaults to `user`
- [`src/core/policy/harness.ts`](../../src/core/policy/harness.ts) — `AGENT_HARNESSES`, `detectAgentHarness`, `isAgentSession`; env-marker allowlist for Claude Code, Codex, Cursor, Gemini CLI, and a generic `AI_AGENT`/`NOORM_AGENT` self-declaration
- [`src/core/policy/classify.ts`](../../src/core/policy/classify.ts) — `classifyStatements`; sql-parser-cst-based statement classifier with a keyword-based fallback (used whenever the CST parser throws, which is the routine path for `mssql` since it has no grammar of its own here), a CTE-DML upgrade rule, and `DESTRUCTIVE_FUNCTIONS` denylist (e.g. `pg_terminate_backend`, `lo_import`, `setval`, `pg_read_file`)
- [`src/core/policy/legacy-access.ts`](../../src/core/policy/legacy-access.ts) — `resolveLegacyAccess`, `DEFAULT_ACCESS` (`{ user: 'admin', agent: 'viewer' }`), `GUARDED_ACCESS` (`{ user: 'operator', agent: 'viewer' }`)
- [`src/core/policy/index.ts`](../../src/core/policy/index.ts) — barrel export for all of the above

## Docs

- [`docs/spec/config-access-roles.md`](../spec/config-access-roles.md) — implementation contract: data model, permission matrix, SQL classification, enforcement, migration
- [`docs/design/config-access-roles.md`](../design/config-access-roles.md) — design rationale for the role model
- [`docs/dev/config.md`](../dev/config.md), [`docs/dev/config-sharing.md`](../dev/config-sharing.md) — describe `access` in place of the removed `protected` boolean
- [`docs/guide/environments/configs.md`](../guide/environments/configs.md), [`docs/guide/environments/stages.md`](../guide/environments/stages.md) — user-facing access-role guidance
- [`skills/noorm/references/config.md`](../../skills/noorm/references/config.md) — skill reference for config access roles

## Coupling

- [`src/core/change/executor.ts`](../../src/core/change/executor.ts) calls `assertPolicy` (`change:run`/`change:ff`/`change:revert`) — changes to `MATRIX` or `PolicyCheck` shape affect `core-change`.
- [`src/core/runner/runner.ts`](../../src/core/runner/runner.ts) calls `assertPolicy` (`run:build`/`run:file`/`run:dir`) — affects `core-runner`.
- [`src/core/db/policy.ts`](../../src/core/db/policy.ts) (`assertDbPolicy`), [`src/core/transfer/index.ts`](../../src/core/transfer/index.ts) (`assertPolicy`, `db:reset`/`transfer:plan`) — affects `core-db`.
- [`src/core/vault/policy.ts`](../../src/core/vault/policy.ts) (`checkVaultPolicy`/`assertVaultPolicy`) and [`src/core/sql-terminal/executor.ts`](../../src/core/sql-terminal/executor.ts) (`assertPolicy` + `classifyStatements`) — affects `core-identity`.
- [`src/core/config/schema.ts`](../../src/core/config/schema.ts), [`src/core/config/types.ts`](../../src/core/config/types.ts), [`src/core/config/resolver.ts`](../../src/core/config/resolver.ts), [`src/core/state/access.ts`](../../src/core/state/access.ts), and [`src/core/settings/rules.ts`](../../src/core/settings/rules.ts) import `ConfigAccess`/`resolveLegacyAccess`/`guarded` only — data resolution, defaulting, and rule-matching, not enforcement. Affects `core-state`; a shape change to `ConfigAccess` propagates to all of them.
- [`src/mcp/server.ts`](../../src/mcp/server.ts) calls `checkConfigPolicy` at dispatch for every non-`'open'` `RpcCommand`; [`src/rpc/types.ts`](../../src/rpc/types.ts) types `RpcCommand.permission` as `Permission | 'open'` — affects `mcp-rpc`.
- [`src/sdk/guards.ts`](../../src/sdk/guards.ts) (`checkConfigPolicy`, throws `ProtectedConfigError`) and [`src/sdk/index.ts`](../../src/sdk/index.ts)/[`src/sdk/types.ts`](../../src/sdk/types.ts) (re-export `Channel`/`ConfigAccess`/`Role`) — affects `sdk`.
- [`src/cli/_utils.ts`](../../src/cli/_utils.ts), [`src/cli/change/rm.ts`](../../src/cli/change/rm.ts), `src/cli/config/*.ts`, [`src/cli/db/create.ts`](../../src/cli/db/create.ts)/`drop.ts`, [`src/cli/run/inspect.ts`](../../src/cli/run/inspect.ts)/`preview.ts`, [`src/cli/secret/_policy.ts`](../../src/cli/secret/_policy.ts), [`src/cli/sql/query.ts`](../../src/cli/sql/query.ts), `src/cli/vault/*.ts` call `resolveChannel`/`checkConfigPolicy`/`assertPolicy` directly — affects `cli`.
- [`src/tui/components/dialogs/SmartConfirm.tsx`](../../src/tui/components/dialogs/SmartConfirm.tsx) and every destructive-action screen (`ChangeFFScreen`, `ChangeRunScreen`, `ChangeRevertScreen`, `ChangeRemoveScreen`, `ChangeRewindScreen`, `ChangeNextScreen`, `ConfigRemoveScreen`, `DbCreateScreen`, `DbDestroyScreen`, `DbTeardownScreen`, `DbTransferScreen`, `DbTruncateScreen`, `LockForceScreen`, `RunBuildScreen`, `VaultScreen`) call `checkConfigPolicy`/`confirmationPhraseFor` directly to build confirm-dialog props; [`src/tui/app-context.tsx`](../../src/tui/app-context.tsx) and [`src/tui/screens/config/ConfigAddScreen.tsx`](../../src/tui/screens/config/ConfigAddScreen.tsx) derive default `access` values from `DEFAULT_ACCESS`/`GUARDED_ACCESS` only; [`src/tui/utils/config-validation.ts`](../../src/tui/utils/config-validation.ts) reads `guarded` — affects `tui`.

## Conventions worth knowing

- `checkPolicy`'s `confirm` cell resolves differently per channel: `user` prompts for `yes-<config>` (`confirmationPhraseFor`, skippable via `NOORM_YES`), `agent` collapses `confirm` to `deny` — an agent confirming its own destructive action is theater, and on the CLI it would need only `--yes` to walk through it.
- `agent: false` (invisible config) is never a role and is not expected to reach `checkPolicy` — visibility is enforced upstream via `isVisibleToChannel`.
- `checkConfigPolicy`/`assertPolicy` fail closed: a config with no `access` at all is denied on every channel.
- `resolveChannel` precedence: `NOORM_CHANNEL` env override (exact `user`/`agent` only) > harness provenance (`isAgentSession`, an allowlist of env markers the harnesses set for themselves, deliberately excluding `TERM_PROGRAM`/`CI`/TTY state) > `user` default. The MCP server never calls `resolveChannel` — it constructs its session with `agent` literally.
- `classifyStatements` fails closed to `ddl` for anything it can't positively classify as `read` or `write` — an unrecognized statement, or one the CST parser can't parse and the keyword fallback can't identify, could do anything.
- `DESTRUCTIVE_FUNCTIONS` is a denylist, not an allowlist, by design: `SELECT f()` is statically undecidable, so only known-dangerous builtins upgrade a `SELECT` to `write`.
- `guarded(target)` (`target.access.user !== 'admin'`) and `formatAccessTag` are display-only — used by TUI styling, `config list`, and settings rule matching — never an enforcement input.
- `DEFAULT_ACCESS` (`{ user: 'admin', agent: 'viewer' }`) is what every config gets when its author never set `access` and never set legacy `protected: true`; a legacy `protected: true` maps to `GUARDED_ACCESS` (`{ user: 'operator', agent: 'viewer' }`).
- Tests: [`tests/core/policy/check.test.ts`](../../tests/core/policy/check.test.ts) drives `checkPolicy` against an `EXPECTED_MATRIX` authored independently of [`src/core/policy/matrix.ts`](../../src/core/policy/matrix.ts) (from [`docs/spec/config-access-roles.md`](../spec/config-access-roles.md)) — covers 15 of the 27 defined permissions across role×channel; the matrix has grown past this independent test copy for `db:truncate`, `db:teardown`, `config:write`, `vault:read`/`write`/`propagate`, `secret:read`/`write`, `transfer:plan`, `lock:force`, and `debug:read`/`write`; [`tests/core/policy/classify.test.ts`](../../tests/core/policy/classify.test.ts) and `classify-corpus.test.ts` cover CST/fallback-path assertions and an adversarial SQL corpus; [`tests/core/policy/agent-escalation.test.ts`](../../tests/core/policy/agent-escalation.test.ts) asserts the agent/CLI-shell-out escalation is closed for every permission on a stock config; [`tests/core/policy/default-access.test.ts`](../../tests/core/policy/default-access.test.ts) drives `parseConfig`/`migrateState` end to end rather than comparing constants; [`tests/core/policy/channel.test.ts`](../../tests/core/policy/channel.test.ts) and `visibility.test.ts` cover `resolveChannel` precedence and `isVisibleToChannel` fail-closed handling respectively.
