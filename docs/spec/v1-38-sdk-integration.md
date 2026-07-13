# Spec: v1-38 SDK boundary — live-DB integration coverage for the throw contract

Ticket: `tickets/v1/38-sdk-boundary-integration-coverage.md`. Contract under test: `docs/spec/v1-25-sdk-contract.md` (D1 — SDK boundary throws named errors, never `[value, Error|null]` tuples).

## Stacked branch

Base: `v1/33-observer` @ `168da07` (the SDK track tip: 08→25→14→33; contains the full throw contract). Worktree: `.worktrees/v1-38-sdk-integration` on branch `v1/38-sdk-integration`. Reviewers diff against `168da07`, not `master`.

## Goal

Ticket 25 converted 8 `ctx.noorm.*` SDK methods (`vault.init/set/delete/copy`, `transfer.to/plan`, `dt.exportTable/importFile`) from tuple-return to throw, and unit-tested the conversion with mocks/sqlite (`tests/sdk/vault-namespace.test.ts`, `tests/sdk/transfer-dt-namespace.test.ts`). No test drives the converted **SDK namespace wrappers** against a **real** pg/mysql/mssql connection — the existing `tests/integration/**` suite proves the *core* helpers work live (`tests/integration/transfer/*.test.ts` calls `transferData`/`getTransferPlan` directly; `tests/core/dt/integration.test.ts` exercises the dt pipeline directly) but never routes through `VaultNamespace`/`TransferNamespace`/`DtNamespace`. This spec closes that gap: prove the throw contract holds at the SDK boundary against genuine infrastructure, not mocks.

## Non-goals

- Re-testing the core helpers' own tuple contract (`tests/core/vault/storage.test.ts`, `tests/core/transfer/**`, `tests/core/dt/**` already do this and are untouched).
- Full transfer/dt happy-path data-correctness coverage (row counts, FK ordering, conflict strategies) — `tests/integration/transfer/*.test.ts` and `tests/core/dt/integration.test.ts` already own that. This spec's happy-path assertions exist only to prove the SDK wrapper resolves a plain value, not a tuple, on success.
- Any change to `src/sdk/**` or `src/core/**` production code. Test-only ticket (ticket 25's scope boundary: "Test coverage only; the contract itself is 25's done work").
- New namespaces beyond the three ticket 25 converted (vault/transfer/dt). `changes`/`run`/`db`/`lock` already threw before ticket 25 and are unaffected.

## Contract under test (from v1-25, verbatim shapes)

| Namespace method | Shape | Real-failure proof required |
|---|---|---|
| `vault.get/getAll/list/exists` | unchanged shape; infra failure now throws instead of collapsing to falsy | yes — absence vs. failure side by side |
| `vault.set` | `Promise<void>`; throws `VaultAccessError` (no usable key) or underlying `Error` (write failure) | yes — both error paths |
| `transfer.to/plan` | `Promise<TransferResult>`/`Promise<TransferPlan>`; throws underlying `Error` | yes — unreachable dest |
| `dt.exportTable/importFile` | `Promise<{...}>`; throws `NotConnectedError` (no connection) or underlying `Error` (real failure) | yes — both |

`NotConnectedError` (`src/sdk/guards.ts`) and `VaultAccessError` (`src/sdk/namespaces/vault.ts`) are the two named classes; everything else is raw `Error` propagation per the v1-25 contract table — assert `.rejects.toThrow()` / `instanceof Error`, not a bespoke class, for those paths.

## Harness

Reuse `tests/utils/db.ts` (`createTestConnection`, `skipIfNoContainer`, `TEST_CONNECTIONS`, `makeTestConfig`, `deployTestSchema`, `teardownTestSchema`) — no new harness code. `skipIfNoContainer(dialect)` gates every `beforeAll`, matching `tests/integration/sdk/{db-reset,tvf,tvp}.test.ts`.

Vault schema bootstrap: `v1.up(db, dialect)` / `v1.down(db, dialect)` from `src/core/version/schema/migrations/v1.ts` (dialect-aware — `postgres`/`mssql`/generic branches cover all three target dialects) creates/drops `__noorm_identities__` and `__noorm_vault__`. Identity fixtures mirror `tests/sdk/vault-namespace.test.ts`'s `seedIdentity`/`generateKeyPair`/`computeIdentityHash` plus `setIdentityOverride`/`clearIdentityOverride` from `src/core/identity/storage.ts` (avoids touching `~/.noorm/identity.json` in CI).

`ContextState` is constructed directly (not via `createContext()`, which needs on-disk project bootstrap) — same pattern as `tests/integration/sdk/db-reset.test.ts`'s `makeState()`. `access: { user: 'admin', mcp: 'admin' }` (matches `makeTestConfig`) so `checkProtectedConfig` never blocks `dt.importFile`/`transfer.to` in these tests — the throw contract under test is the SDK boundary's tuple→throw conversion, not the policy gate (already covered by `tests/core/transfer/policy-gate.test.ts`).

**Isolation rule:** any test that destroys a connection or drops a table to force a real infra failure must do so on a connection/schema scoped to that test only (a dedicated `createTestConnection(dialect)` call, or a `beforeEach` full teardown+rebuild), never on the shared `beforeAll` connection other tests in the same file depend on. `tests/sdk/vault-namespace.test.ts`'s top-level `beforeEach` (fresh db per test) is the model for the vault file; the dedicated-connection approach is the model for one-off destroy tests in transfer/dt.

## Checkpoints

| # | Checkpoint | File | Agent | Verifies |
|---|---|---|---|---|
| 1 | VaultNamespace live throw contract | `tests/integration/sdk/vault-namespace.test.ts` | atomic-implementer (mode: feature) | Per dialect (postgres, mysql, mssql), one `describe` block each: (a) not-connected `vault.get` → `NotConnectedError`; (b) genuine absence (vault initialized, key never set) → `vault.get` resolves `null`, no throw; (c) real infra failure (dedicated connection destroyed before the call) → `vault.get` rejects — (b)+(c) side by side prove absence-vs-failure live; (d) `vault.set` with no vault access → rejects `VaultAccessError`; (e) `vault.set` with a valid key but the vault table dropped before the write → rejects a generic `Error`, `not.toBeInstanceOf(VaultAccessError)`. `beforeEach` rebuilds schema fresh per test (`v1.down` + `v1.up`) to keep (e)'s table-drop from leaking into later tests. |
| 2 | TransferNamespace live throw contract | `tests/integration/sdk/transfer-namespace.test.ts` | atomic-implementer (mode: feature) | Per dialect (postgres, mysql, mssql): `transfer.to`/`transfer.plan` against an unreachable dest (real closed port, e.g. `port: 1`) both reject with the underlying `Error`, not a tuple — `TransferNamespace` has no internal connection requirement (no `#kysely`), so this is the achievable live-failure proof without a NotConnectedError path. Plus one postgres-only happy-path case reusing `tests/integration/transfer/postgres.test.ts`'s dest-database bootstrap: `transfer.plan(destConfig)` against two real reachable databases resolves a `TransferPlan` object (`Array.isArray(result)` is `false`), proving the success path isn't tuple-shaped either. |
| 3 | DtNamespace live throw contract | `tests/integration/sdk/dt-namespace.test.ts` | atomic-implementer (mode: feature) | Per dialect (postgres, mysql, mssql): (a) not-connected `dt.exportTable` and `dt.importFile` (`connection: null`) both reject `NotConnectedError`; (b) connected, `dt.exportTable('nonexistent_table_xyz', filepath)` on a genuinely absent table rejects a generic `Error` (fails in `buildDtSchema`, before any worker thread spins up — confirmed by reading `src/core/dt/index.ts`'s `exportTable`, so this stays fast); (c) connected, `dt.importFile('/nonexistent-path/x.dtz')` rejects a generic `Error` (fails in `DtReader.open()`, before worker spin-up). No happy-path export/import needed here — 25's contract table already unit-proves the shape; this checkpoint's job is only the real-failure throw proof `ctx.noorm.dt.*` currently lacks live. |
| 4 | Final sweep | n/a (orchestrator-run) | orchestrator | All three new files pass `bun test --serial tests/integration/sdk/vault-namespace.test.ts tests/integration/sdk/transfer-namespace.test.ts tests/integration/sdk/dt-namespace.test.ts` against live pg/mysql/mssql containers; full group 4 (`bun test --serial tests/integration`) still green (no regression to `db-reset`/`tvf`/`tvp`); `bun run typecheck`, `bun run lint`, `bun run build` all green. |

## Acceptance criteria (from ticket, verbatim)

- At least one integration test per converted namespace (vault/transfer/dt) asserts throw-not-tuple against a live DB.
- The absence-vs-failure distinction is proven live (genuine-absent → null; infra failure → throw).

Both are satisfied by Checkpoint 1's (b)/(c) pair (absence-vs-failure) and by every checkpoint asserting `.rejects.toThrow(...)` / `Array.isArray(result) === false` against a live container (throw-not-tuple, per namespace).

## Out of scope

- Changing `src/sdk/**`/`src/core/**` — test-only ticket.
- `changes`/`run`/`db`/`lock` namespaces — already-thrown, untouched by ticket 25, not this ticket's concern.
- New harness utilities in `tests/utils/db.ts` — the existing harness covers everything needed.
- Exhaustive dialect×scenario matrix beyond what's listed above (e.g. mysql/mssql happy-path transfer.plan) — one dialect (postgres) is sufficient to prove the success-path shape; the failure-path proof (the actual point of this ticket) runs on all three.

## Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| `dt.exportTable`/`importFile` real-failure tests accidentally hit the worker-thread pipeline (slow, flaky in CI) | low | Verified by reading `src/core/dt/index.ts`: `buildDtSchema`/`reader.open()` both fail and return before any `WorkerBridge`/`WorkerPool` is created. Chosen failure modes (nonexistent table, nonexistent file) are the ones that fail at that early stage. |
| Table-drop test (Checkpoint 1e) leaks a dropped `__noorm_vault__` table into a later test in the same file | medium | `beforeEach` rebuilds schema (`v1.down` + `v1.up`) per test, not per describe block — mirrors `tests/sdk/vault-namespace.test.ts`'s existing per-test `beforeEach` isolation model, just against live DBs instead of in-memory sqlite. |
| MSSQL closed-port connection attempt hangs instead of failing fast | low | `port: 1` on localhost with nothing listening returns `ECONNREFUSED` immediately for all three drivers (pg/mysql2/tedious) — no custom timeout needed. If the reviewer finds this hangs in practice, drop to a `withTimeout`-wrapped assertion rather than reworking the port choice. |

## Change log

- 2026-07-12 — initial spec, authored by orchestrator pre-implementation.
