# Spec: v1-08 dangerous-path tests

Ticket: `tickets/v1/08-dangerous-path-tests.md`. Evidence: `research/v1-audit/quality-lenses/test-intent.md` (QL-test-01..04).

## Goal

The most destructive code paths in noorm — change revert/rewind, vault secret crypto, database
creation — have near-zero test coverage relative to their blast radius. This is a test-only
ticket: add intent-encoding tests (fail red when the business rule breaks, not just when a line
of code changes) for these paths. No production source changes.

## Source-reading findings (informs scope)

- `ChangeManager.rewind()` (`src/core/change/manager.ts:369-372`) sorts applied changes by
  `appliedAt?.getTime()`. `ChangeStatus.appliedAt` is typed `Date | null`
  (`src/core/change/types.ts:140`) and populated from `history.ts`'s `executed_at` column
  (`src/core/change/history.ts:172`, `Generated<Date>` per `src/core/shared/tables.ts:240`). The
  SQLite driver (both `sqlite-bun` and `better-sqlite3` adapters) returns `executed_at` as a raw
  string, not a `Date` instance — `.getTime()` throws `TypeError` whenever the `applied` array
  has 2+ entries (`Array.prototype.sort`'s comparator is never invoked for 0-1 element arrays, so
  this is silent below the threshold). This is tracked as ticket 34, not fixed here. See
  "Deferred to ticket 34" below for exactly which tests this affects.
- `db create` (`src/cli/db/create.ts`, `src/core/db/operations.ts`) has **no policy gate at all**
  — no `checkConfigPolicy`/`assertPolicy` call anywhere in the create path, unlike `db drop`
  which explicitly gates on `db:destroy` (`src/cli/db/drop.ts:59`). Any role, including `viewer`,
  can currently run `noorm db create`. This is a real asymmetry worth its own ticket — **not
  fixed here** (test-additive-only scope; flagged in the implementation log / final report as a
  new finding, not silently patched). Consequence for this spec: the `db create` CLI test does
  not need role-seeding/denial cases the way `tests/cli/db/drop.test.ts` does — there's no gate
  to deny. "Mirroring drop.test.ts's structure" means the end-to-end-real-SQLite-file approach
  and subprocess-driven CLI invocation, not the specific role-matrix assertions.
- `db create` has no compiled `dist/cli/index.js` in a fresh worktree; `bun run build` (`tsc`)
  must run once before the CLI-level test can execute, same as CI's build-before-test-groups
  ordering and the same precondition `drop.test.ts` already relies on.

## Checkpoint table

| CP | Area | New file(s) | Level | CI group | Deferred to #34 |
|----|------|-------------|-------|----------|------------------|
| 1 | Change tracker + manager | `tests/core/change/tracker.test.ts`, `tests/core/change/manager.test.ts` | unit (in-memory SQLite) | group 1 (`tests/core`) | 2 of ~9 manager tests |
| 2 | Vault key crypto + storage CRUD | `tests/core/vault/key.test.ts`, `tests/core/vault/storage.test.ts` | unit (`key.test.ts` needs no DB; `storage.test.ts` uses in-memory SQLite) | group 1 (`tests/core`) | none |
| 3 | `db create` CLI | `tests/cli/db/create.test.ts` | CLI/subprocess, real SQLite file | group 3 (`tests/cli`) | none |

## CP1 — Change tracker + manager

### `tests/core/change/tracker.test.ts` (new)

Pins `ChangeTracker.canRevert`/`markAsReverted` state-machine rules (`src/core/change/tracker.ts:106-205`).
No dependency on `rewind()`'s sort — safe from ticket 34.

- `canRevert` returns `{canRevert:false, reason:'not applied'}` when no `change`-direction record
  exists for the name. Business rule pinned: you cannot revert something that was never applied.
- `canRevert` returns `{canRevert:true, status:'success'}` for a `success` record. Pinned: the
  normal, expected revert-eligible state.
- `canRevert` returns `{canRevert:true, status:'failed'}` for a `failed` record. Pinned:
  intentionally permissive — a failed change (which may have partially applied files) can still
  be reverted, matching `executor.ts`'s `revertChange` skip-vs-throw split.
- `canRevert` returns `{canRevert:false, reason:'not applied yet'}` for a `pending` record.
- `canRevert` returns `{canRevert:false, reason:'already reverted'}` for a `reverted` record.
  Pinned: prevents double-revert.
- `canRevert` returns `{canRevert:false, reason:'schema was torn down'}` for a `stale` record.
- `canRevert(name, force: true)` bypasses every status branch above except the missing-record
  case — pins that `force` cannot manufacture a revert for something that was never applied.
- `markAsReverted` flips only the **most recent** `change`-direction record's status to
  `reverted` when a change was applied twice (re-applied after a prior revert). Seed two
  `change`-direction rows with the same name (earlier id = `reverted`, later id = `success`),
  call `markAsReverted`, assert only the later row flips and the earlier stays untouched. Pins
  the `orderBy('id', 'desc').limit(1)` "most recent wins" rule — if a future refactor updates
  all matching rows or the wrong one, this test goes red.
- `markAsReverted` on a name with no `change`-direction record is a silent no-op (doesn't throw).

### `tests/core/change/manager.test.ts` (new)

Pins `ChangeManager`'s public API (`src/core/change/manager.ts`) directly against a real
in-memory SQLite DB, matching `tests/core/change/executor.test.ts`'s harness pattern
(`buildContext`, `createTestChange`, `v1.up` bootstrap).

- `revert(name)` on an applied change with real revert SQL actually executes the revert file
  against the DB (e.g. `DROP TABLE`) — assert the table is gone via a follow-up query, not just
  that `status === 'success'`. Assert the history status flips to `'reverted'`.
- `revert(name)` called a **second** time on an already-reverted change returns
  `{status:'success', files:[]}` (the `canRevert` skip path — reason `'already reverted'`), not
  an error. Pins the not-applied-throws vs already-reverted-skips distinction from
  `executor.ts:315-336`.
- `revert(name)` on a change that was never applied throws `ChangeNotAppliedError`.
- `rewind(1)` with exactly one applied change reverts it, returns `{status:'success', executed:1}`.
  **Not deferred** — a 1-element array never invokes `Array.sort`'s comparator, so this is
  immune to the ticket-34 bug.
- `rewind(name)` targeting the one applied change (by name) reverts it and returns success.
  Same 1-element immunity.
- `rewind(name)` with a name that matches no applied change returns
  `{status:'failed', failed:1, changes:[]}` — the not-found branch (`manager.ts:391-402`). Use 0
  or 1 applied changes so the sort stays 1-element-immune.
- `rewind` with 0 applied changes is a no-op: `{status:'success', executed:0, changes:[]}`.
- `next(count)` applies exactly `count` pending changes in order and leaves the rest `pending`.
  Pins the batch-count semantics from `manager.ts:247-330` (QL-test-04's "batch semantics" gap).
- `remove(name, {disk:true, db:true})` deletes the change's directory from disk (assert via
  `existsSync`) **and** its history rows (assert via `getHistory(name)` returning `[]`).
- `remove(name, {db:true})` (disk:false) deletes only history rows; the change directory still
  exists on disk afterward. Pins that `disk`/`db` are independent toggles, not an all-or-nothing
  delete.

**Deferred to #34** — add both as `it.skip` inside `manager.test.ts`, comment mirrors
`tests/cli/run/change-rewind.test.ts:62-71`'s citation style exactly:

- `rewind(2)` reverting two applied changes in most-recent-first order — requires 2+ applied
  changes, triggers the `.getTime()` crash in the sort comparator before `rewind` computes
  anything.
- `rewind(name)` targeting the **older** of two applied changes (proves the "revert until and
  including" multi-item traversal, `manager.ts:388-406`) — same 2+-item sort crash.

## CP2 — Vault key crypto + storage

### `tests/core/vault/key.test.ts` (new)

No DB dependency — `src/core/vault/key.ts` is pure `node:crypto` wrapping. This is the ticket's
core security property.

- `generateVaultKey()` returns a 32-byte `Buffer`; two calls produce different bytes (not a
  fixed/zero key).
- **Round trip**: identity A generates a keypair (reuse `generateKeyPair()` from
  `src/core/identity/crypto.ts` — same X25519 DER/hex format `encryptVaultKey`/`decryptVaultKey`
  expect). `encryptVaultKey(vaultKey, A.publicKey)` then `decryptVaultKey(encrypted, A.privateKey)`
  returns a `Buffer` deep-equal to the original `vaultKey`.
- **Third-identity-fails (the ticket's named core security property)**: encrypt a vault key for
  identity B's public key. A third identity C (separately generated keypair) attempts
  `decryptVaultKey(encrypted, C.privateKey)` — asserted to return `null`, not throw, and
  critically not to return any bytes resembling the original key. This is the test the ticket
  explicitly calls out; if key-wrapping ever confuses recipients or the ECDH/HKDF derivation
  degenerates, this goes red.
- `decryptVaultKey` with a tampered `authTag` or `ciphertext` (flip one hex character) returns
  `null` — pins AES-GCM's authentication, not just confidentiality.
- **Secret round trip**: `encryptSecret(value, vaultKey)` then `decryptSecret(encrypted, vaultKey)`
  returns the original plaintext string.
- `decryptSecret` with the **wrong** vault key (a different 32-byte buffer, not the one used to
  encrypt) returns `null`.
- `decryptSecret` with a tampered `ciphertext` returns `null`.

### `tests/core/vault/storage.test.ts` (new)

Mirrors `tests/core/vault/idempotent-init.test.ts`'s harness exactly: `BunSqliteDatabase(':memory:')`,
`v1.up` bootstrap, `seedIdentity` helper reusing `generateKeyPair`/`computeIdentityHash`.

- `setVaultSecret` then `getVaultSecret` round-trips the plaintext through real DB storage
  (encrypt → store JSON → fetch → decrypt), against a vault key obtained from a real
  `initializeVault` call (not a hand-rolled buffer) to exercise the full path a caller actually
  takes.
- `setVaultSecret` called twice with the same `secretKey` **updates** the existing row (new
  value fetchable, `set_by` updated) rather than inserting a duplicate — assert exactly one row
  exists in `__noorm_vault__` for that key after both calls. Pins the upsert-not-duplicate rule
  (`storage.ts:227-269`).
- `getAllVaultSecrets` with 3 secrets set returns a `Record` keyed by `secret_key`, each entry's
  `value` correctly decrypted and matching what was set.
- `vaultSecretExists` is `false` for a key that was never set, `true` after `setVaultSecret`.
- `deleteVaultSecret` on an existing key returns `[true, null]`; `vaultSecretExists` is `false`
  afterward.
- `deleteVaultSecret` on a key that was never set returns `[false, null]` — **not** an error.
  Pins that deleting something absent is a no-op result, not a failure (`storage.ts:448-479`).
- `getVaultKey` with the correct `identityHash` + matching `privateKey` (from the same identity
  that called `initializeVault`) returns a `Buffer` equal to the key `initializeVault` returned.
- `getVaultKey` with a **wrong** `privateKey` (a second identity's key, never propagated the
  vault key) returns `null` — the storage-layer companion to `key.test.ts`'s third-identity test,
  proving the failure surfaces correctly through the DB-backed lookup, not just the raw crypto
  function.
- `getVaultStatus`: before any `initializeVault` call, `isInitialized: false`. After one identity
  initializes, `isInitialized: true`, `usersWithAccess: 1`. With a second identity seeded but
  never propagated the vault key, `usersWithoutAccess: 1` and that identity's `hasAccess` is
  `false` when queried by their own `identityHash`.

## CP3 — `db create` CLI

### `tests/cli/db/create.test.ts` (new)

Structural mirror of `tests/cli/db/drop.test.ts`: subprocess-driven against the compiled CLI
(`node dist/cli/index.js db create ...`), real SQLite file target, config seeded directly via
`StateManager` (not through TUI-only `config add`). No role/policy assertions — `db create` has
no gate to test (see "Source-reading findings").

Precondition: `bun run build` must have run in this worktree so `dist/cli/index.js` exists.

- Running `noorm db create` against a config pointing at a SQLite file that doesn't exist yet:
  exit code 0, the file now exists (`existsSync`), and tracking is initialized — verify via
  `checkDbStatus(config.connection)` returning `trackingInitialized: true` (imported directly in
  the test, not re-parsed from stdout), not just that the CLI printed a success string.
- Running it again against the same already-created-and-initialized target: exit code 0,
  `alreadyExists: true` / `created: false` in the JSON output (`--json`), and the database file's
  mtime / row data is untouched — proves the `status.exists && status.trackingInitialized`
  short-circuit (`src/cli/db/create.ts:65-74`) actually skips work rather than re-running
  `createDb` destructively.
- `--json` output includes `created`, `trackingInitialized` fields with the correct booleans for
  the fresh-create case (both `true`).

## Deferred to ticket 34 (summary)

Two tests in `tests/core/change/manager.test.ts`, both `it.skip`, both requiring 2+ applied
changes to exercise `ChangeManager.rewind()`'s multi-item sort:

1. `rewind(2)` — reverts two most-recently-applied changes in order.
2. `rewind(name)` targeting the older of two applied changes.

Comment format mirrors `tests/cli/run/change-rewind.test.ts:62-71` (ticket 01's precedent):
cite the exact crash (`TypeError` on `.getTime()`), the file:line of the sort, the file:line of
the type declaration vs. the SQLite driver's actual return type, and note this also breaks real
(non-test) `noorm change rewind` usage against SQLite — not just a test-harness limitation.

## Acceptance criteria (verbatim from ticket)

- Tests fail if the business rule is broken (e.g. flip a revert-ordering or key-check line and
  watch them go red), not just exercise lines.
- Integration additions run in the correct CI group with live DB services.

(This spec adds no `tests/integration/**` files — all additions are unit-level `tests/core/**`
or subprocess-level `tests/cli/**`, both already covered by CI groups 1 and 3 respectively. No
new integration harness is introduced, so the second criterion is satisfied by placement, not by
new integration coverage.)

## Out of scope

- No `src/` changes. Ticket 34 (SQLite `rewind` crash) is not fixed here.
- No fix for `db create`'s missing policy gate — flagged as a new finding, not remediated.
- `vault/copy.ts`, `vault/propagate.ts`, `vault/resolve.ts` remain uncovered. The audit research
  doc's fuller prescription (QL-test-02) mentions these, but the ticket's own "Prescription"
  section scopes vault work to "key round-trip ... storage CRUD" — followed as the authoritative,
  narrower scope. Flagged as a gap for a future ticket, not silently expanded into here.
- `ChangeManager.getHistory`/`getFileHistory` pass-through methods and `list()`/`ff()`/`get()`/
  `load()` are not independently tested — `next()`/`revert()`/`rewind()`/`remove()` were judged
  the highest-risk surface per QL-test-04's "at minimum" framing.

## Change log

- 2026-07-12 — initial spec, authored by orchestrator pre-implementation.
