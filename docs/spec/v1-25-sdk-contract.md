# Spec: v1-25 SDK failure contract — throw named errors at the boundary

Ticket: `tickets/v1/25-sdk-failure-contract.md`. Decision: `tickets/v1/00-DECISIONS.md` D1
(RULED 2026-07-11 — throw at the producer; `attempt()` is consumer-side and deliberate).
Evidence: `research/v1-audit/v1-release/sdk-api-surface.md` (VR-api-01, VR-api-02, VR-api-06,
VR-api-07).

**This changes the published semver contract of `@noormdev/sdk`.** Every consumer that
currently destructures `[value, err]` from `vault.init/set/delete/copy`,
`transfer.to/plan`, or `dt.exportTable/importFile` breaks on upgrade. This is intentional
and frozen-at-v1 per D1 — the alternative (shipping the mixed contract past v1) is strictly
worse, since unifying it later is *also* a breaking change but without the "not released yet"
excuse.

## Stacked branch

Base: `v1/08-dangerous-tests` @ `35e19e6`, not `master`. Worktree:
`.worktrees/v1-25-sdk-contract` on branch `v1/25-sdk-contract`. Ticket 08 added
`tests/core/vault/{key,storage,idempotent-init}.test.ts` and `tests/core/change/*.test.ts`
asserting the **current** (pre-this-ticket) return shapes. This spec's Checkpoint 2 audits
every one of those assertions against the new contract — see "08's tests: audit result"
below. Reviewers diff against `35e19e6`, not `master`.

## Goal

One failure convention across the public `@noormdev/sdk` boundary (`src/sdk/context.ts` +
`src/sdk/namespaces/*.ts`): every method that can fail **throws** a named, exported,
`instanceof`-matchable error. No public method returns an `attempt`-style
`[value, Error|null]` tuple. Consumers who want tuples wrap the call with `attempt()`
themselves — that is what `attempt()` is for (D1's ruling). Deliberate result-object
carve-outs (`utils.testConnection`) stay, documented as intentional.

## Non-goals

- `ctx.noorm.observer` relocation (D5) — ticket 33.
- Curating the `src/sdk/index.ts` "Types" re-export list (VR-api-05) — ticket 14.
- The doc/skill contradiction sweep (internal rules doc vs. consumer-facing skill teaching
  tuples) — ticket 26. This spec does not touch `skills/noorm/**` or `docs/reference/sdk.md`
  / `docs/dev/sdk.md`.
- `DbNamespace._buildFn` public setter (VR-api-04) — separate finding, not part of D1/this
  ticket's prescription.
- Deep-fixing `src/core/vault/propagate.ts`'s and `getVaultStatus`'s own internal
  `attempt()`-swallowing (see "Flagged, not fixed" below) — beyond the cited storage.ts
  bug, reported rather than silently expanded per the orchestrator's scope guard.
- Full happy-path integration coverage for `transfer.to`/`dt.exportTable` against a live DB
  — unit-level proves the shape (throws, not tuples); `tests/integration/sdk/**` (group 4)
  is the authoritative end-to-end confirmation, run by the central CI runner, not this loop.

## Success criteria

- [ ] No public SDK method returns a `[T, Error|null]` tuple — confirmed by grepping the
      built `packages/sdk/dist/index.d.ts` for tuple-shaped return types after
      `bun run build:packages`.
- [ ] Every SDK-authored guard/synthesized failure has a named, exported,
      `instanceof`-matchable error class (`NotConnectedError`, `VaultAccessError`, plus the
      pre-existing `RequireTestError`/`ProtectedConfigError`/`ImpersonationError`).
- [ ] Vault: genuine absence → `null`/`{}`/`[]`/`false` (unchanged); infrastructure failure
      (DB query throws) → propagates as a thrown error. Tests prove both paths.
- [ ] The 8 duplicated `"Not connected. Call connect() first."` throw sites collapse to one
      `requireConnection(state)` helper.
- [ ] The 4 duplicated dialect pre-checks in `context.ts` are deleted; `sql.ts` is the sole
      source of truth.
- [ ] `utils.testConnection`'s `{ok, error?}` shape is preserved, with JSDoc documenting the
      deliberate carve-out.
- [ ] 08's tests audited against the new contract — every assertion either already holds
      (verified, not just assumed) or is updated.
- [ ] `src/cli/db/transfer.ts` (the one first-party consumer that destructures the converted
      tuples) and the two TUI call sites with no upstream `attempt()` boundary are updated so
      the build stays green and no new unhandled-rejection regression ships.
- [ ] `bun run typecheck`, `bun run typecheck:tests`, `bun run lint`, `bun run build` all
      green.

## Source-reading findings (informs scope and the decisions below)

- **`initializeVault`/`setVaultSecret`/`deleteVaultSecret`/`copyVaultSecrets` at the CORE
  level already return tuples today** (`src/core/vault/storage.ts`, `src/core/vault/copy.ts`)
  and ticket 08's `idempotent-init.test.ts` + part of `storage.test.ts` pin that core-level
  tuple contract directly (not through the SDK). The ticket text says "whether the core
  functions themselves convert is the spec's call; the boundary contract is what's frozen at
  v1." **Decision: keep core tuple-returning, convert only the SDK namespace wrapper.** This
  (a) minimizes the diff to what the boundary contract actually requires, (b) leaves 08's
  core-level tests untouched (verified below — none of them need edits), (c) matches the
  existing pattern for `transfer`/`dt` where core already returns tuples and only the SDK
  wrapper is the public-facing surface.
- **`decryptVaultKey`/`decryptSecret` (`src/core/vault/key.ts`) deliberately return `null` on
  decrypt failure** (wrong key, tampered ciphertext/authTag) — this is documented, tested
  (08's `key.test.ts`), and analogous to `bcrypt.compare` returning `false`: a verification
  primitive signaling "no", not an infrastructure error. **Out of scope** — not touched, not
  reinterpreted as an "infra failure" needing to throw. See "Vault absence-vs-failure rule"
  below for how this interacts with the acceptance-criteria wording.
- **Storage-layer read functions beyond the 3 VR-api-02 cites also swallow the query error.**
  VR-api-02's evidence cites `getVaultKey:153-163`, `getVaultSecret:305-315`,
  `getAllVaultSecrets:355-364`. The ticket's own Prescription section, however, names five SDK
  methods: "Vault reads (`get/getAll/list/exists/propagate`)". `list`/`exists` map to
  `listVaultSecretKeys`/`vaultSecretExists` — **also in `storage.ts`, same file, same
  swallow-pattern, same fix**, just not individually cited by line number in VR-api-02. Folded
  into Checkpoint 1's fix (5 functions, not 3).
- **`propagateVaultKey` (`src/core/vault/propagate.ts`) and `getVaultStatus`
  (`src/core/vault/storage.ts`) have their own, separate `attempt()`-swallowing** (e.g.
  `getUsersWithoutVaultAccess`'s `if (err || !rows) return [];`, count queries silently
  defaulting to 0 on error). This is the same *smell* but a **different file** than the cited
  bug, and fixing it would mean `propagate()`'s SDK method needs its own decision about
  distinguishing "nobody to propagate to" from "the count query failed" — a design question
  the ticket doesn't address. Per the orchestrator's explicit scope guard ("if the contract
  change reveals the vault error-propagation needs core changes beyond storage.ts, report
  before expanding"), **this is flagged, not fixed.** `VaultNamespace.propagate()` still
  benefits automatically from `getVaultKey` now throwing on infra failure (its own `#getVaultKey`
  call), so the *entry* to propagate is safer; the internals of `propagateVaultKey` itself are
  unchanged.
- **Real first-party consumer breaks on the tuple→throw conversion**: `src/cli/db/transfer.ts`
  calls `ctx.noorm.transfer.plan/to` and `ctx.noorm.dt.exportTable/importFile` and destructures
  tuples at 4 call sites. `bun run typecheck` fails without updating it. Included as required
  collateral (Checkpoint 3) — not scope creep, a consequence of the boundary change that must
  ship in the same commit or the build breaks.
- **Two TUI vault screens call the fixed storage.ts functions with no upstream `attempt()`
  boundary.** Traced every direct caller of `getVaultKey`/`getVaultSecret`/`getAllVaultSecrets`/
  `listVaultSecretKeys`/`vaultSecretExists` (`src/cli/vault/{rm,list,propagate,set}.ts`,
  `src/tui/screens/vault/{VaultSetScreen,VaultRemoveScreen,VaultScreen}.tsx`,
  `src/tui/hooks/useVaultSecretKeys.ts`):
  - CLI vault commands: safe. `withVaultContext` (`src/cli/_utils.ts:307-311`) wraps the whole
    command body in `attempt()`; any new throw becomes the existing `[null, opError]` failure
    path.
  - `useVaultSecretKeys.ts`: safe. Already wraps `getVaultKey`/`getAllVaultSecrets` in
    `attempt()` explicitly.
  - `VaultScreen.tsx`'s `onReady` callback: safe. `useConnection.ts:173-174` wraps `onReady` in
    `attempt()`; a thrown error becomes `connError` → the screen's existing error phase.
  - `VaultSetScreen.tsx:92` (`handleSubmit`, direct `getVaultKey` call) and
    `VaultRemoveScreen.tsx:63,75` (`handleDelete`, direct `getVaultKey` +
    `vaultSecretExists` calls): **unsafe.** No `attempt()` anywhere in the chain from these
    event handlers to the event loop. A thrown error here today would be an unhandled promise
    rejection and the screen would hang in `'saving'`/`'deleting'` phase forever with no error
    shown. This is a regression the storage.ts fix would otherwise introduce.
  **Decision: wrap these 3 call sites in `attempt()`**, matching the exact idiom the same two
  files already use 10-15 lines below for `setVaultSecret`/`deleteVaultSecret`
  (`const [, err] = await attempt(async () => {...}); if (err) { setError(err.message);
  setPhase('ready'); return; }`). Minimal, mechanical, zero new UX — required collateral to
  avoid shipping a known regression, not a TUI feature change. Flagged here per the same
  "report before expanding" spirit; push back if this should be a separate ticket instead.
- **`src/sdk/types.ts`'s `ExportOptions`/`ImportOptions` JSDoc `@example` blocks are doubly
  stale** — they call `ctx.exportTable(...)`/`ctx.importFile(...)` (wrong method path; VR-api-03,
  ticket 07's scope, fixed on `v1/07-sdk-docs-drift` which is NOT an ancestor of this branch)
  **and** show `const [result, err] = await ...` (the old tuple contract this ticket removes).
  **07/25 overlap — flagged explicitly per the orchestrator's instruction.** Since this ticket
  must touch these two `@example` blocks anyway (leaving a stale tuple example that also has the
  wrong method name would be actively misleading, worse than before), Checkpoint 4 fixes both
  problems in the same edit: correct path (`ctx.noorm.dt.exportTable`/`ctx.noorm.dt.importFile`)
  *and* correct (no-tuple) contract. **Merge-time reconciliation needed** if/when `v1/07` and
  `v1/25` both land — same two `@example` blocks, touched independently on both branches. Not a
  logical conflict (both changes converge on the same correct end state), just a textual diff
  overlap for whoever merges both.

## Named-error catalog

| Class | Status | Location | Thrown when |
|---|---|---|---|
| `NotConnectedError` | **NEW** | `src/sdk/guards.ts` | `requireConnection(state)` finds `state.connection === null`. Message unchanged: `'Not connected. Call connect() first.'` |
| `VaultAccessError` | **NEW** | `src/sdk/namespaces/vault.ts` | `VaultNamespace.set()` when the supplied `privateKey` yields no usable vault key (never granted access, or wrong key — indistinguishable by design, see below) |
| `RequireTestError` | unchanged | `src/sdk/guards.ts` | `requireTest: true` but `config.isTest !== true` |
| `ProtectedConfigError` | unchanged | `src/sdk/guards.ts` | Access policy denies or requires confirmation the SDK can't give |
| `ImpersonationError` | unchanged | `src/sdk/impersonate/types.ts` | Dialect doesn't support impersonation, or username validation fails |
| `ChangeValidationError`, `ChangeNotFoundError`, `ChangeAlreadyAppliedError`, `ChangeNotAppliedError`, `ChangeOrphanedError`, `ManifestReferenceError` | unchanged | `src/core/change/types.ts` | Already thrown by `ChangeManager`; SDK re-exports, doesn't wrap |
| `LockAcquireError`, `LockExpiredError` | unchanged | `src/core/lock/index.ts` | Already thrown by the lock manager; SDK re-exports, doesn't wrap |
| *(raw driver/DB errors)* | unchanged | n/a | `vault.init/delete/copy`, `transfer.to/plan`, `dt.exportTable/importFile` propagate whatever `Error` the underlying core `attempt()` call produced, unwrapped. Not minted into new classes — matches the existing convention for `db`/`run`/`changes`, which already let core errors propagate raw. Minting a bespoke class per core failure message would be over-engineering (YAGNI) with no consumer benefit that raw `Error` + `.message` doesn't already give. |

Only two new classes. Everything else either already existed or deliberately stays raw.

## `requireConnection` factoring (VR-api-06)

New helper in `src/sdk/state.ts` (the file VR-api-06 itself suggests, and where `ContextState`/
`ConnectionResult` types already live):

```typescript
export function requireConnection(state: ContextState): ConnectionResult {

    if (!state.connection) {

        throw new NotConnectedError();

    }

    return state.connection;

}
```

`ConnectionResult` (`src/core/connection/types.ts:71-75`) has `{ db, dialect, destroy }` — the
single helper covers both call shapes seen across the 8 sites: namespaces that only need `.db`
(`get #kysely()` getters) and `changes.ts`'s `#createChangeContext()` which also needs
`.dialect`. `NotConnectedError` takes no arguments (message is fixed, matching every existing
call site's identical string).

**8 sites replaced** (VR-api-06's exact evidence list):

| # | File:line | Current form | Replacement |
|---|---|---|---|
| 1 | `context.ts:98-104` | public `get kysely()` getter | `return requireConnection(this.#state).db as Kysely<DB>;` |
| 2 | `changes.ts:436-446` | private `get #kysely()` getter | `return requireConnection(this.#state).db;` |
| 3 | `changes.ts:454` | inline check inside `#createChangeContext()` | `const conn = requireConnection(this.#state);` then use `conn.dialect` |
| 4 | `run.ts:179-189` | private `get #kysely()` getter | `return requireConnection(this.#state).db;` |
| 5 | `db.ts:358-368` | private `get #kysely()` getter | `return requireConnection(this.#state).db;` |
| 6 | `dt.ts:88-98` | private `get #kysely()` getter | `return requireConnection(this.#state).db;` |
| 7 | `vault.ts:333-343` | private `get #kysely()` getter | `return requireConnection(this.#state).db;` |
| 8 | `lock.ts:142-152` | private `get #kysely()` getter | `return requireConnection(this.#state).db;` |

Message text is preserved verbatim, so every existing `.toThrow('Not connected')` /
`.rejects.toThrow('Not connected')` substring assertion across `tests/sdk/*.test.ts`
(`bundle-smoke.test.ts:230`, `lifecycle.test.ts:122`, `noorm-ops.test.ts:235-315`) keeps
passing unmodified — confirmed by reading each assertion; none pin the error to a specific
class today, only the message substring.

## Dialect pre-check dedup (VR-api-07)

Delete 4 duplicate checks in `context.ts`, since `sql.ts`'s builders perform the identical
check with the identical message immediately after:

| `context.ts` line | Method | Duplicate message | Authoritative (`sql.ts`) |
|---|---|---|---|
| 230 | `proc()` | `'SQLite does not support stored procedures.'` | `sql.ts:85` (`buildProcCall`) |
| 319 | `func()` | `'SQLite does not support database function calls.'` | `sql.ts:158` (`buildFuncCall`) |
| 368 | `tvf()` | `'SQLite does not support table-valued functions.'` | `sql.ts:256` (`buildTvfCall`) |
| 374 | `tvf()` | `'MySQL does not support table-valued functions.'` | `sql.ts:262` (`buildTvfCall`) |

Each of `proc()`/`func()`/`tvf()` already falls through to the corresponding `buildXCall()` on
every other code path, so deleting the pre-check does not skip any logic — it removes a
redundant early exit whose message and trigger condition are byte-for-byte identical to what
`sql.ts` does two lines later. `tests/sdk/context.test.ts:432-560` and
`tests/sdk/sql.test.ts` assert on message text, not call site — unaffected.

## Vault absence-vs-failure rule

**The rule:** `vault.get/getAll/list/exists` keep returning `null`/`{}`/`[]`/`false` for
**genuine absence** (no row, no such secret key, nothing in the vault). They now **throw** on
**infrastructure failure** — a DB query that itself errors (connection drop, permission
denial, driver error) — instead of silently collapsing that into the same falsy return as
"not found."

**Resolving the acceptance-criteria wording.** The ticket's acceptance criteria says: *"Vault:
missing key → `null`; dropped connection / wrong key / decrypt failure → throw (tests for both
paths)."* Read literally, "wrong key / decrypt failure → throw" could mean `getVaultKey`
should throw when `decryptVaultKey` fails because the caller supplied the wrong `privateKey`.
That would contradict: (a) `decryptVaultKey`'s own documented, tested, deliberate
null-on-failure contract (`key.ts:143-151`, pinned by 08's `key.test.ts`), (b) 08's own
`storage.test.ts:218-235` test — *"should return null from getVaultKey when the identityHash
has an encrypted key but the privateKey does not match"* — which this spec does **not** flag
for update, and (c) D1's own consequence line: *"vault reads keep `null` for genuine absence
but propagate infrastructure failures"* — no mention of decrypt failure needing to throw.

**Reconciliation:** the "wrong key / decrypt failure → throw" clause is satisfied at the
**write path**, not the read path. `VaultNamespace.set()`/`copy()`/`init()`/`delete()` convert
from tuple-return to throw as part of the general contract conversion (separate from the
storage.ts read fix). Today, `vault.set()` already synthesizes `new Error('No vault access')`
when `#getVaultKey` returns null for *any* reason — wrong key or genuine absence, currently
indistinguishable, currently tuple-returned. After conversion, that synthesized error is
**thrown** (now as `VaultAccessError`). So: attempt a *read* with the wrong key → `null`
(can't act on a secret you can't decrypt any differently than one that doesn't exist — avoids
leaking "the secret exists but you lack access" vs. "it doesn't exist"). Attempt a *write* with
the wrong key → throws, because a write is actionable — the caller needs to know why nothing
happened. "Dropped connection" throws on both reads (storage.ts fix) and writes (already true
today via tuple, now via throw) for the same reason: it's not a decrypt/access question at all,
it's the query never running.

**The fix (Checkpoint 1), `src/core/vault/storage.ts`, 5 functions:**

| Function | Old | New |
|---|---|---|
| `getVaultKey` (153-163) | `if (err \|\| !row?.encrypted_vault_key) return null;` | `if (err) throw err;` then `if (!row?.encrypted_vault_key) return null;` (decrypt-failure path below unchanged — still returns `decryptVaultKey`'s own null) |
| `getVaultSecret` (305-315) | `if (err \|\| !row) return null;` | `if (err) throw err;` then `if (!row) return null;` |
| `getAllVaultSecrets` (355-364) | `if (err \|\| !rows) return {};` | `if (err) throw err;` then `if (!rows) return {};` |
| `listVaultSecretKeys` (~417-427) | `if (err \|\| !rows) return [];` | `if (err) throw err;` then `if (!rows) return [];` |
| `vaultSecretExists` (~501-511) | `if (err) return false;` | `if (err) throw err;` then `return !!row;` |

`getVaultStatus` is **not** touched (out of the cited 5, not named in the ticket's
`get/getAll/list/exists/propagate` list — its own count-query error-swallowing is part of the
"flagged, not fixed" propagate.ts/getVaultStatus note above).

**Tests required (Checkpoint 1, `tests/core/vault/storage.test.ts`, new cases):** for at least
`getVaultKey` and `getVaultSecret` (representative of the pattern — full coverage of all 5 is
the bar, not just these two), force a real query failure (e.g. `db.destroy()` before the call,
matching `idempotent-init.test.ts`'s existing `'should return [null, Error] on actual DB
failure'` pattern) and assert `expect(fn(...)).rejects.toThrow()` — proving infra failure now
throws. Pair with a same-file case proving genuine absence (row/key never existed) still
resolves to `null`/`{}`/`[]`/`false` without throwing, so the two paths are asserted side by
side, not just independently.

## Carve-outs (do not change)

| Carve-out | Where | Why |
|---|---|---|
| `utils.testConnection` keeps `{ ok, error? }` | `src/sdk/namespaces/utils.ts:54-58` | Deliberate failure-as-data diagnostic per D1 — "a failed connection is a successful test." JSDoc gets an explicit sentence recording this intent (Checkpoint 4) so it stops reading as an inconsistency. |
| `ctx.transaction()` callbacks throw | `context.ts:188-192` | Kysely's own rollback contract — a callback must throw to trigger rollback. Unaffected by this ticket; `this.kysely` inside it now throws `NotConnectedError` instead of generic `Error`, which is the only change (naming, not behavior). |
| Raw `ctx.kysely` surface | `context.ts:96-106` | Not the SDK's contract to change — Kysely's own query builder throws whatever the driver throws. The connection *guard* in front of it (`NotConnectedError`) is in scope; what Kysely itself does once connected is not. |
| Sync misuse guards | `sql.ts:85,158,256,262` (SQLite/MySQL "not supported"), `context.ts` connection getter | Deterministic "you called this API wrong for this dialect" — stay plain `Error`, not promoted to named classes. Minting `SqliteProcNotSupportedError`-style classes for every dialect/method combination is exactly the over-engineering YAGNI warns against; the message is the contract here, and dialect capability is a compile-time-knowable constraint, not a runtime failure mode consumers need to `instanceof`-branch on. |
| `decryptVaultKey`/`decryptSecret` return `null` on failure | `src/core/vault/key.ts:143-187,236-263` | Deliberate crypto-primitive contract, pinned by 08's `key.test.ts`. Not part of the storage.ts boundary bug. |
| `vault.get/getAll/list/exists` return falsy on no-access (wrong key) | `src/sdk/namespaces/vault.ts` | See "Vault absence-vs-failure rule" above — read-path indistinguishability is deliberate, not an oversight. |
| Core `initializeVault`/`setVaultSecret`/`deleteVaultSecret`/`copyVaultSecrets` stay tuple-returning | `src/core/vault/{storage,copy}.ts` | Ticket explicitly leaves core's own convention to this spec's judgment; only the SDK wrapper is the frozen boundary. Keeps 08's core-level tests (`idempotent-init.test.ts`, most of `storage.test.ts`) valid unmodified. |
| `DbNamespace._buildFn` public setter | `db.ts:347-352` | VR-api-04, a distinct finding not part of D1's prescription. |
| `ctx.noorm.observer` | `noorm-ops.ts:91-95` | D5, ticket 33. |

## Contract table — every public method, old shape → new shape

Legend: **unchanged** = same signature and semantics before/after this ticket (may still get
the `requireConnection` internal refactor, which is not a public-signature change).

### `Context` (`ctx.*`, `src/sdk/context.ts`)

| Method | Old shape | New shape | Note |
|---|---|---|---|
| `get kysely` | throws generic `Error('Not connected...')` | throws `NotConnectedError` | Same message, named class |
| `get connected` | `boolean` | unchanged | |
| `get dialect` | `Dialect` | unchanged | |
| `get noorm` | `NoormOps` | unchanged | |
| `connect()` | `Promise<void>`, propagates `createConnection` errors raw | unchanged | |
| `disconnect()` | `Promise<void>` | unchanged | |
| `transaction(fn)` | `Promise<T>`, throws (Kysely rollback) | unchanged | **Carve-out** |
| `proc(name, ...args)` | `Promise<T[]>`, throws (dialect check duplicated) | `Promise<T[]>`, throws (dialect check now sql.ts-only) | Dedup only |
| `func(name, ...args)` | `Promise<T>`, throws (dialect check duplicated) | `Promise<T>`, throws (sql.ts-only) | Dedup only |
| `tvf(name, ...args)` | `Promise<T[]>`, throws (2 dialect checks duplicated) | `Promise<T[]>`, throws (sql.ts-only) | Dedup only |
| `impersonate(username, fn?)` | throws `ImpersonationError` | unchanged | **Carve-out** |

### `ChangesNamespace` (`ctx.noorm.changes.*`, `changes.ts`)

All 18 public methods (`create`, `addFile`, `removeFile`, `renameFile`, `reorderFiles`,
`delete`, `discover`, `parse`, `validate`, `apply`, `revert`, `ff`, `next`, `status`,
`pending`, `history`, `historyForChange`, `rewind`, `getFileHistory`) — **unchanged public
shape**. Already throw via `ChangeManager`/core or `checkProtectedConfig`. Only internal
change: 2 `requireConnection` sites (getter + `#createChangeContext`).

### `RunNamespace` (`ctx.noorm.run.*`, `run.ts`)

All 6 public methods (`discover`, `preview`, `file`, `files`, `dir`, `build`) — **unchanged**.
Already throw. 1 internal `requireConnection` site.

### `DbNamespace` (`ctx.noorm.db.*`, `db.ts`)

All 14 public methods — **unchanged**. Already throw. 1 internal `requireConnection` site.
`_buildFn` setter untouched (out of scope, VR-api-04).

### `LockNamespace` (`ctx.noorm.lock.*`, `lock.ts`)

All 5 public methods (`acquire`, `release`, `status`, `withLock`, `forceRelease`) —
**unchanged**. Already throw via `LockAcquireError`/`LockExpiredError`. 1 internal
`requireConnection` site.

### `VaultNamespace` (`ctx.noorm.vault.*`, `vault.ts`) — the ticket's core deliverable

| Method | Old shape | New shape |
|---|---|---|
| `init()` | `Promise<[Buffer\|null, Error\|null]>` | `Promise<Buffer\|null>` — throws underlying `Error` on failure; `null` still legitimately means "already initialized" (not an error) |
| `status()` | `Promise<VaultStatus>` | unchanged |
| `set(key, value, privateKey)` | `Promise<[void, Error\|null]>` | `Promise<void>` — throws `VaultAccessError` (no usable key) or underlying `Error` (write failure) |
| `get(key, privateKey)` | `Promise<string\|null>` | unchanged shape; now propagates infra failure as a throw instead of swallowing to `null` (storage.ts fix) |
| `getAll(privateKey)` | `Promise<Record<string, VaultSecret>>` | unchanged shape; same infra-failure-throws fix |
| `list()` | `Promise<string[]>` | unchanged shape; same infra-failure-throws fix |
| `delete(key)` | `Promise<[boolean, Error\|null]>` | `Promise<boolean>` — throws underlying `Error` on failure; `false` still legitimately means "key was never set" |
| `exists(key)` | `Promise<boolean>` | unchanged shape; same infra-failure-throws fix (previously `false` meant both "doesn't exist" and "query failed" — now only the former) |
| `propagate(privateKey)` | `Promise<VaultPropagationResult>` | unchanged shape; inherits safer `#getVaultKey` automatically, `propagateVaultKey`'s own internals unfixed (flagged above) |
| `copy(destConfig, keys, privateKey, options?)` | `Promise<[VaultCopyResult\|null, Error\|null]>` | `Promise<VaultCopyResult>` — throws underlying `Error` (raw, from `copyVaultSecrets`) |

### `TransferNamespace` (`ctx.noorm.transfer.*`, `transfer.ts`)

| Method | Old shape | New shape |
|---|---|---|
| `to(destConfig, options?)` | `Promise<[TransferResult\|null, Error\|null]>` | `Promise<TransferResult>` — throws underlying `Error`. `checkProtectedConfig`'s `ProtectedConfigError` unchanged (already throws, before the tuple call is even reached) |
| `plan(destConfig, options?)` | `Promise<[TransferPlan\|null, Error\|null]>` | `Promise<TransferPlan>` — throws underlying `Error` |

### `DtNamespace` (`ctx.noorm.dt.*`, `dt.ts`)

| Method | Old shape | New shape |
|---|---|---|
| `exportTable(tableName, filepath, options?)` | `Promise<[{rowsWritten,bytesWritten}\|null, Error\|null]>` | `Promise<{rowsWritten: number; bytesWritten: number}>` — throws underlying `Error` |
| `importFile(filepath, options?)` | `Promise<[{rowsImported,rowsSkipped}\|null, Error\|null]>` | `Promise<{rowsImported: number; rowsSkipped: number}>` — throws underlying `Error`. `checkProtectedConfig` unchanged |

1 internal `requireConnection` site (`#kysely` getter).

### `SecretsNamespace` (`ctx.noorm.secrets.*`, `secrets.ts`)

`get(key)`: `string | undefined` — **unchanged, out of scope.** Local encrypted state, no DB
round-trip, no infra-failure mode to distinguish from absence.

### `TemplatesNamespace` (`ctx.noorm.templates.*`, `templates.ts`)

`render(filepath)` — **unchanged.** Already throws via `processFile`.

### `UtilsNamespace` (`ctx.noorm.utils.*`, `utils.ts`)

| Method | Shape | Note |
|---|---|---|
| `checksum(filepath)` | unchanged | Already throws |
| `testConnection()` | unchanged `Promise<{ ok: boolean; error?: string }>` | **Carve-out** — JSDoc gets the deliberate-shape sentence |

### `NoormOps` (`ctx.noorm.*` getters, `noorm-ops.ts`)

`config`/`settings`/`identity`/`observer` getters — **unchanged.** Observer relocation is D5 /
ticket 33.

## 08's tests: audit result

Read every file ticket 08 added, checked each assertion against the new contract:

| File | Result |
|---|---|
| `tests/core/vault/key.test.ts` | **No changes.** Tests `decryptVaultKey`/`decryptSecret` (key.ts) directly — carve-out, untouched by this ticket. |
| `tests/core/vault/idempotent-init.test.ts` | **No changes.** Tests `initializeVault` (core) directly — core stays tuple-returning by this spec's decision. Pre-dates ticket 08 (added in `01208ec`, not part of 08's commits) but lives in the same directory; confirmed unaffected regardless. |
| `tests/core/vault/storage.test.ts` | **No changes to existing assertions** — verified line by line: `deleteVaultSecret`'s `[deleted, err]` tuple assertions (core stays tuple), `getVaultKey`'s wrong-privateKey-returns-null test (carve-out, decrypt failure not infra failure) all hold under the new contract as written. **New test cases added** (Checkpoint 1) for the infra-failure-throws path — additive, not a rewrite. |
| `tests/core/change/{executor,manager,scaffold,parser,types,tracker}.test.ts` | **No changes.** Grepped for `Not connected`, tuple-destructuring, and `attempt(` usage suggesting boundary-contract dependence — zero hits. These test `ChangeManager`/core directly, which already throws and is untouched by this ticket. |

This means the orchestrator's "UPDATE 08's TESTS" mandate resolves to: **audit confirmed
clean, plus additive new coverage in `storage.test.ts` for the absence-vs-failure split.** No
existing 08 assertion needed to change — the ticket's contract decisions (core stays tuple,
decrypt-failure carve-out) were chosen specifically so 08's pinned behavior keeps holding.

## Checkpoints

| # | Checkpoint | Files/areas | Agent | Est. files | Verifies |
|---|---|---|---|---|---|
| 1 | Guard dedup + dialect precheck dedup + vault storage absence-vs-failure fix | `src/sdk/guards.ts`, `src/sdk/state.ts`, `src/sdk/context.ts`, `src/sdk/namespaces/{changes,run,db,dt,vault,lock}.ts`, `src/core/vault/storage.ts`, `tests/core/vault/storage.test.ts` | atomic-implementer (mode: feature) | ~9 | `tests/sdk/*.test.ts` (lifecycle, noorm-ops, bundle-smoke, context, sql, guards) all green unmodified; new `storage.test.ts` cases red→green for infra-failure-throws |
| 2 | VaultNamespace SDK wrapper conversion (`init/set/delete/copy` → throw) + `VaultAccessError` | `src/sdk/namespaces/vault.ts`, `src/sdk/index.ts` (re-export), new `tests/sdk/vault-namespace.test.ts` | atomic-implementer (mode: feature) | ~3 | New tests prove no tuple returned, `VaultAccessError` thrown on no-access, underlying errors propagate on write failure |
| 3 | TransferNamespace + DtNamespace SDK wrapper conversion + CLI consumer update | `src/sdk/namespaces/{transfer,dt}.ts`, `src/cli/db/transfer.ts`, new unit tests | atomic-implementer (mode: feature) | ~4 | `bun run typecheck` green (proves CLI consumer fixed); new unit tests prove throw on unsupported-dialect path without live DB |
| 4 | JSDoc sweep: `vault.ts`/`transfer.ts`/`dt.ts` `@example` blocks updated for new contract; `types.ts` `ExportOptions`/`ImportOptions` examples fixed (07 overlap); `utils.testConnection` carve-out documented | `src/sdk/namespaces/{vault,transfer,dt,utils}.ts`, `src/sdk/types.ts` | atomic-implementer (mode: surgical) | ~5 | Manual read-through; no runtime behavior change, TDD skipped with reason stated |
| 5 | TUI regression guard: wrap the 2 unsafe direct call sites in `attempt()` | `src/tui/screens/vault/{VaultSetScreen,VaultRemoveScreen}.tsx` | atomic-implementer (mode: surgical) | 2 | Existing TUI vault tests (if any) still pass; manual trace confirms no unhandled-rejection path remains |
| 6 | Final sweep: `.d.ts` tuple grep, full verification | n/a (verification only, orchestrator-run) | orchestrator | 0 | `bun run build:packages`, grep `packages/sdk/dist/index.d.ts` for `[T \| null, Error \| null]`-shaped signatures on the converted methods → zero hits; `bun run typecheck`, `typecheck:tests`, `lint`, `build` all green |

## Acceptance criteria (verbatim from ticket)

- No public SDK method returns a `[T, Error|null]` tuple (grep the shipped `.d.ts`).
- Every distinct failure mode at the boundary has a named, exported, `instanceof`-matchable
  error class.
- Vault: missing key → `null`; dropped connection / wrong key / decrypt failure → throw (tests
  for both paths).
- Tests updated; skill/docs updates ride ticket 26.

(See "Vault absence-vs-failure rule" above for how the third bullet's "wrong key / decrypt
failure" clause is satisfied at the write path rather than contradicting the read-path
carve-out and 08's pinned test.)

## Out of scope

- `ctx.noorm.observer` relocation (D5) — ticket 33.
- `src/sdk/index.ts` curated type-export review (VR-api-05) — ticket 14.
- Doc/skill contradiction sweep (`skills/noorm/**`, `docs/reference/sdk.md`, `docs/dev/sdk.md`)
  — ticket 26. Downstream of this ticket: once the contract ships, ticket 26 aligns the prose.
- `DbNamespace._buildFn` public setter (VR-api-04).
- `propagateVaultKey`'s and `getVaultStatus`'s own internal error-swallowing — flagged above,
  not fixed. A future ticket should decide whether "propagate to N of M users, M-N failed
  silently" needs to surface partial failure, since `propagate()`'s `VaultPropagationResult`
  shape has no field for it today.
- Full live-DB integration coverage for `transfer.to`/`transfer.plan`/`dt.exportTable`/
  `dt.importFile`'s happy path — unit-level proves the shape; `tests/integration/sdk/**`
  (group 4) is the real end-to-end confirmation and is explicitly the central runner's job, not
  this loop's (no docker in this loop per the orchestrator's testing instructions).
- `examples/**` (separate packages, own tsconfig, not covered by root `typecheck`/`build`) —
  may reference the old tuple contract in their own SDK usage; not verified or fixed here.

## Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| A consumer beyond `src/cli/db/transfer.ts` destructures one of the converted tuples and isn't caught by `bun run typecheck`/`typecheck:tests` (e.g. dynamic access, `any`-typed intermediary) | low | Grepped `noorm.vault.`, `noorm.transfer.`, `noorm.dt.` across `src/cli`, `src/tui`, `src/rpc`, `src/mcp`, and all of `tests/` before writing this spec — `transfer.ts` is the only hit with tuple destructuring. TDD signal (`typecheck:tests` includes `tests/**`) is the backstop. |
| The `VaultAccessError` message/shape doesn't match what future ticket 26 doc work expects | low | Ticket 26 is downstream and reads whatever ships here; no doc currently references a specific vault-access error shape to contradict. |
| Reviewer disagrees with the "wrong key stays null on read" interpretation of the acceptance criteria | medium | Rationale fully argued in "Vault absence-vs-failure rule" with 3 independent supporting citations (key.ts contract, 08's own test, D1's consequence line). If overruled, the fix is confined to `getVaultKey`'s decrypt-failure branch — small, isolated blast radius. |
| Wrapping the 2 TUI call sites in `attempt()` is judged out of this ticket's scope by the orchestrator | low-medium | Flagged prominently in two places (Source-reading findings, Checkpoint 5) specifically so it's easy to reject/defer without unpicking other checkpoints — Checkpoint 5 is fully independent of 1-4. |

## Change log

- 2026-07-12 — initial spec, authored by orchestrator pre-implementation.

## Implementation log

### shipped (pending user ship decision) — 2026-07-12

Built across 6 iterations of `/subagent-implementation` (5 implement→review cycles + 1
orchestrator-run final verification sweep). Stacked on `v1/08-dangerous-tests` @ `35e19e6`.
Commits (chronological):

- `b038211` — docs(spec): this spec
- `36406d0` — CP1: `NotConnectedError`/`requireConnection` dedup (8 sites), dialect precheck
  dedup (4 sites), vault storage absence-vs-failure fix (5 functions)
- `6430901` — CP2: `VaultNamespace.init/set/delete/copy` tuple→throw, new `VaultAccessError`
- `8d06eb8` — CP3: `TransferNamespace.to/plan` + `DtNamespace.exportTable/importFile`
  tuple→throw, required `src/cli/db/transfer.ts` consumer update
- `1558da6` — CP4: JSDoc sweep (11 edit points), including the confirmed `v1/07` overlap fix
- `943699b` — CP5: TUI regression guard (`VaultSetScreen.tsx`, `VaultRemoveScreen.tsx`)

**Out-of-scope work performed during this build:**

- `src/cli/db/transfer.ts` (4 call sites) — required collateral, not optional. The one
  first-party consumer that destructured the converted tuples; `bun run typecheck` breaks
  without this update. Simplified the file in the process (removed now-redundant manual
  `if (err) throw err;` unwraps).
- `src/tui/screens/vault/{VaultSetScreen,VaultRemoveScreen}.tsx` (3 call sites) — required
  collateral to avoid a regression the storage.ts fix would otherwise introduce (unhandled
  promise rejection in 2 event handlers with no upstream `attempt()` boundary). Flagged
  prominently in the spec before implementation; reviewer confirmed the fix is minimal and
  correct.

**Unforeseens — surprises that emerged during implementation:**

- The acceptance criteria's literal wording ("wrong key / decrypt failure → throw") appeared
  to contradict ticket 08's own pinned test and `key.ts`'s deliberate crypto-primitive
  contract. Resolved by reading the wording as satisfied at the write path (`vault.set()`
  throwing `VaultAccessError`) rather than the read path — documented at length in the spec's
  "Vault absence-vs-failure rule" section with three independent supporting citations. Not
  escalated to the user since the resolution is well-supported and low-blast-radius if
  overruled later (confined to `getVaultKey`'s decrypt-failure branch).
- `tsconfig.test.json`'s `typecheck:tests` surfaces 243 pre-existing errors across 38 files,
  none introduced by this diff (verified definitively — only 3 test files touched across the
  whole ticket, 2 are brand-new with zero errors, the 3rd's errors are on pre-existing
  ticket-08 lines). This is real, pre-existing hygiene debt unrelated to this ticket's scope
  — not fixed here, worth its own ticket if not already tracked.

**Deferred items still open:**

- FOLLOWUPS.md F-1 (🔵 nit, `changes.ts`'s double `requireConnection` call — spec-authored
  shape, not a defect), F-2/F-3 (🔵 nits, dead optional chaining / redundant local rename in
  the CLI file — cosmetic). None block ship; all are one-line tidy-ups if anyone touches these
  files again.
- `propagateVaultKey`'s and `getVaultStatus`'s own internal error-swallowing (flagged in the
  spec's "Source-reading findings" and "Out of scope" sections) — a different file than the
  cited bug, needs its own design decision about surfacing partial-propagation failure. Not a
  FOLLOWUPS entry since it was never in this ticket's scope to begin with, not a thing that
  emerged during the build.
- `tests/integration/sdk/**` (CI group 4, live DB) — not run in this loop per the testing
  scope (no docker/live DB in this environment). Required before ship; see `TESTING.md`.
- Ticket 26 (doc/skill contradiction sweep) is the explicit downstream consumer of this
  ticket's shipped contract — not started here, by design.
