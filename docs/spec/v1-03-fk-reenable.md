# Spec: FK re-enable guarantee (truncate) + transfer FK-restore surfacing

Ticket: `tickets/v1/03-fk-reenable-guarantee.md` · Findings: QL-safe-01, QL-safe-05 (`research/v1-audit/quality-lenses/destructive-safety.md`)

The body of this spec is current truth. Superseded decisions live only in the change log.


## Goal


A mid-truncate failure must never leave FK enforcement off. `truncateData` executes one flat statement array (disable-FK, per-table truncate, enable-FK) and throws on the first failure — everything after, including the enable-FK bookend, is skipped. On MSSQL the toggle is per-table `ALTER TABLE ... NOCHECK CONSTRAINT ALL`: persistent schema state that survives reconnects, so a failed truncate leaves referential integrity off until manual repair. On Postgres/MySQL the toggle is session-scoped but still leaks to other work sharing the connection.

Separately, transfer's post-run FK re-enable failure is only observer-emitted; `TransferResult` has no field for it, so a caller seeing `status: success` has no signal that FK enforcement may still be off on the destination.


## Contract


Exact guarantee, verbatim:

> Enable-FK statements execute even when any truncate statement throws; the original error still surfaces; partial re-enable failures are reported.

Expanded:

1. **truncateData** (`src/core/teardown/operations.ts`): once statement execution begins (non-dry-run, at least one table to truncate), the enable-FK statements ALWAYS execute — regardless of whether a disable-FK or truncate statement failed. Finally-semantics via `attempt` (never try-catch — project rule).
2. **Original error surfaces**: the first disable/truncate failure is captured and re-thrown AFTER the enable-FK phase completes. Enable-phase failures never mask it.
3. **Partial re-enable failures reported**: each failing enable-FK statement emits `teardown:error` (existing event, `{ error, object: <stmt> }`) and execution continues with the REMAINING enable statements (one MSSQL table's failure must not skip the other tables' re-enable). If enable failures occur and there was no original error, the first enable failure is thrown.
4. **Transfer** (`src/core/transfer/`): `TransferResult` gains required `fkChecksRestored: boolean`. `false` only when FK checks were disabled for the transfer and the re-enable attempt failed; `true` otherwise (including `disableForeignKeys: false`, where checks were never touched). Existing observer emit on failure stays.
5. **CLI surfacing** (`src/cli/db/transfer.ts`): JSON output includes `fkChecksRestored`; human-readable output prints a loud warning (stderr) when it is `false`.

Behavior explicitly preserved:

- Dry-run output: `TruncateResult.statements` remains the flat disable→truncate→enable concatenation in the same order.
- Comment skipping (`--` prefix) and `'; '` sub-statement splitting apply in every phase exactly as today.
- `teardown:progress` emissions per sub-statement unchanged.
- `TransferResult.status` semantics unchanged (a failed FK restore does not flip status); CLI exit codes unchanged.


## Design constraints


- Error-handling ruling D1: `attempt()` is correct here because the function does something with the error — captures it, guarantees the enable phase runs, re-surfaces it. Never try-catch.
- 4-block function structure, ESLint style per `.claude/rules/typescript.md`. JSDoc on any new/extracted function explaining WHY.
- `transfer:complete` event payload (`src/core/transfer/events.ts`) gains `fkChecksRestored: boolean` — additive; the only emitter is `executeTransfer`, consumers (`src/tui/hooks/useTransferProgress.ts`) only read fields.
- Only construction site of `TransferResult` is `src/core/transfer/executor.ts:199`; SDK (`src/sdk/namespaces/transfer.ts`) passes it through untouched.


## Checkpoints


| CP | Deliverable | Verification (independent) |
|----|-------------|----------------------------|
| CP-1 | `truncateData` restructured: disable/truncate/enable phases; enable phase always executes; original error re-thrown after enable phase; per-statement enable failures emit `teardown:error` and don't stop remaining enables. | Unit tests in `tests/core/teardown/` with a stubbed/mocked Kysely executor that records statement order and fails on an injected statement: (a) MSSQL mid-truncate failure → all `CHECK CONSTRAINT ALL` statements still executed, thrown error is the injected one; (b) Postgres (and MySQL/SQLite where the toggle is session-scoped) → enable statement still executed, original error thrown; (c) enable-only failure → other enable statements still run, error thrown; (d) truncate failure + enable failure → original truncate error is the one thrown; (e) `teardown:error` emitted for each enable failure. Dry-run statement order unchanged (existing tests stay green). |
| CP-2 | `TransferResult.fkChecksRestored: boolean` (required, JSDoc'd) set by `executeTransfer`; `transfer:complete` event carries it. | Unit test (no DB container) driving `executeTransfer` with a mocked Kysely/ctx: enable-FK SQL failure → `fkChecksRestored === false`, `status` unchanged, observer `error` event emitted; success path → `true`; `disableForeignKeys: false` → `true`. |
| CP-3 | CLI: JSON output includes `fkChecksRestored`; human output warns on `false` (stderr). | Read-verify `src/cli/db/transfer.ts` JSON object + warning branch; typecheck green. Unit test only if an existing CLI-output test harness pattern applies cheaply (`tests/cli/db/` has no transfer test today — do not build new harness scaffolding for this). |
| CP-4 | MSSQL integration test: injected mid-truncate failure on a live MSSQL (AFTER DELETE trigger that THROWs) → `truncateData` throws the injected error AND `sys.foreign_keys.is_disabled = 1` count is 0 afterward. | Test added to `tests/integration/teardown/mssql.test.ts` following the existing `skipIfNoContainer('mssql')` pattern. Executed by the central runner (docker); not run locally. |

CP-1 and CP-2/CP-3 are independent slices; CP-4 depends on CP-1.


## Acceptance criteria (ticket, verbatim)


- Test per dialect (MSSQL especially): injected mid-truncate failure → FK re-enable statements still executed, original error still reported.
- Transfer result and CLI/JSON output surface a failed FK restore.


## Evidence


- QL-safe-01: `src/core/teardown/operations.ts:150-201` (flat array at 153-165, throw-on-first-failure loop at 188-195), `src/core/teardown/dialects/mssql.ts:23-47` (per-table NOCHECK/CHECK — persistent schema state), `src/core/teardown/dialects/postgres.ts:20-31`, `src/core/teardown/dialects/mysql.ts:20-31` (session-scoped toggles).
- QL-safe-05: `src/core/transfer/executor.ts:173-194` (enable failure → observer emit only, "don't fail the transfer"), `src/core/transfer/types.ts:163-177` (`TransferResult` — no FK field), `src/cli/db/transfer.ts:334-363` (JSON/human output — no FK field).


## Out of scope


- Per-file change retry — ticket 17.
- Teardown/truncate confirmation gates (`--yes` handling) — ticket 02.
- `teardownSchema`'s execution loop (drops objects; has no FK disable/enable bookend to guarantee).
- Transfer `status`/exit-code semantics changes; TUI transfer screen rendering of the new field.
- Pooled-connection session-toggle leakage on Postgres/MySQL (pre-existing design property, noted in QL-safe-01).


## Change log


- 2026-07-12 — initial spec authored from ticket 03 + QL-safe-01/QL-safe-05 evidence.
