# Spec: TUI/RPC adopt the helpers that already exist

Ticket: `tickets/v1/12-tui-rpc-adopt-helpers.md` · Findings: AP-dup-05/-06/-07 (`research/v1-audit/atomic-principles/duplication.md`)

The body of this spec is current truth. Superseded decisions live only in the change log.


## Objective

Three existing helpers are underused or duplicated against:

1. `createChangeManager` (`src/tui/utils/change-context.ts`) — used by 3 of 5 change-execution screens. `ChangeRunScreen`/`ChangeRevertScreen` hand-roll the same `ChangeContext` construction instead, even though `ChangeManager.run`/`.revert` already exist for exactly their use case.
2. `withScreenConnection` (`src/tui/utils/connection.ts`) — zero callers. Seven TUI files hand-roll the connect+test+destroy dance it was written to replace.
3. The mcp-channel config-invisibility rule ("a config with `access.mcp === false` or missing `access` does not exist on the mcp channel") is implemented twice, independently, with different null-handling: `src/rpc/commands/config.ts:33` assumes `access` is always present; `src/rpc/session.ts:68` explicitly fails closed when `access` is missing.

This spec adopts (1) and (2) as pure refactors (no behavior change beyond what's noted under Design decisions), and fixes (3) by extracting one `isVisibleToChannel` helper into `core/policy` with session.ts's fail-closed semantics, used by both call sites.

No new abstractions beyond the two narrow, justified exceptions called out under Design decisions.


## Design decisions (read before implementing)

These resolve ambiguity the ticket text doesn't spell out. They are binding — do not re-derive from scratch.

### D1 — `withScreenConnection` gains an optional `onConnect` hook

`RunDirScreen` and `RunFileScreen` support mid-execution cancellation: an `activeConnectionRef` holds the live `ConnectionResult` so a Ctrl-C/Esc handler can call `conn.destroy()` to abort a hanging query. `conn.destroy` (returned by `createConnection`) is **not** the same as `db.destroy()` — it's a wrapped function (`src/core/connection/factory.ts:167-179`) that also untracks the connection from `ConnectionManager` and emits `connection:close`. Calling `db.destroy()` directly instead would skip both, leaving a stale tracked entry and a missing event. `withScreenConnection`'s current signature only exposes `db` to the callback, not the wrapper — there's no way to get a handle for cancellation.

Fix: add an optional third options parameter:

```typescript
export async function withScreenConnection<T>(
    connectionConfig: ConnectionConfig,
    configName: string,
    fn: (db: Kysely<NoormDatabase>) => Promise<T>,
    options?: { onConnect?: (conn: ConnectionResult) => void },
): Promise<[T | null, Error | null]>
```

`onConnect` fires once, right after `createConnection` succeeds and before `fn` runs, with the wrapped `ConnectionResult`. Callers that need a cancel-ref (`RunDirScreen`, `RunFileScreen`) pass it; callers that don't (`RunBuildScreen`, `RunExecScreen`, `DbTeardownScreen`, `DbTruncateScreen`) omit it. `withScreenConnection` has zero existing callers, so this is additive with no migration cost — not a new abstraction, an extension of the helper's own documented purpose ("wraps the connect + cast + try/finally destroy pattern") to cover a real caller need.

### D2 — `ConnectionProvider.tsx` is excluded from `withScreenConnection` adoption

`ConnectionProvider` holds a connection **across** many renders and unrelated future events (config change, explicit `destroyConnection()`, unmount) — not within a single callback. `withScreenConnection`'s contract is connect → run one callback → destroy, unconditionally, before returning. There's no way to fit "connect now, keep alive indefinitely, destroy later on a trigger I don't control yet" into that shape without decomposing `withScreenConnection` into separate connect/destroy primitives — which is itself a new abstraction the ticket's scope boundary forbids.

The ticket's acceptance criterion reads "No hand-rolled connect/test/destroy in **TUI screens**" — `ConnectionProvider.tsx` lives in `src/tui/providers/`, not `src/tui/screens/`. Treat this literally: `ConnectionProvider` stays as-is. Its `Connection failed: ${connErr?.message ?? 'Unknown error'}` string remains the one documented exception to the "only the helper owns this string" rg check below — flagged, not silently dropped.

The other 6 named files (`RunBuildScreen`, `RunDirScreen`, `RunExecScreen`, `RunFileScreen`, `DbTeardownScreen`, `DbTruncateScreen`) are all genuinely one-shot (connect, do the operation, destroy, return) — all 6 adopt `withScreenConnection`.

### D3 — `ChangeRunScreen`/`ChangeRevertScreen` reload the change via the manager

Today both screens keep the already-loaded `Change` object in state (from the loading-phase `loadChangesWithStatus` call) and pass it straight to `executeChange`/`revertChange`. `ChangeManager.run(name)`/`.revert(name)` instead reload the change from disk by name (`#loadChange`) before executing. This matches how the 3 sibling screens already behave (`ChangeFFScreen` etc. call `.ff()`/`.next()`/`.rewind()`, which also re-list/re-load internally) — adopting the factory means accepting this reload, which throws `ChangeNotFoundError`/`ChangeOrphanedError` consistently with the rest of the change-screen family instead of using each screen's bespoke pre-validation. Not a behavior regression: the screen's own loading phase already validated the change exists and has content before the user ever reaches the confirm step.


## Contract

### Policy visibility (AP-dup-06)

- `isVisibleToChannel(access: ConfigAccess | undefined, channel: Channel): boolean` — exported from `src/core/policy/check.ts` (alongside `checkPolicy`/`checkConfigPolicy`) and re-exported from `src/core/policy/index.ts`.
- Semantics (fail-closed, matches `session.ts`'s current behavior verbatim): returns `true` unless `channel === 'mcp' && (!access || access.mcp === false)`, in which case `false`.
- `src/rpc/commands/config.ts`'s `list_configs` handler filters via `summaries.filter((summary) => isVisibleToChannel(summary.access, session.channel))` — unconditional filter (no more `if (session.channel === 'mcp')` guard branch; `isVisibleToChannel` returns `true` for every summary on the `user` channel, so the filter is a no-op there, same observable result as today).
- `src/rpc/session.ts`'s `connect()` replaces its inline `this.channel === 'mcp' && (!rawAccess || rawAccess.mcp === false)` condition with `!isVisibleToChannel(rawAccess, this.channel)`.
- Existing tests `tests/core/rpc/list-configs.test.ts` and `tests/core/rpc/session.test.ts` must stay green unmodified — they already pin the two behaviors this change unifies.
- New test pins the fail-closed null-handling directly against `isVisibleToChannel` (not just through the two call sites): `access: undefined` on the `mcp` channel → `false`; `access: undefined` on the `user` channel → `true`; `access.mcp === false` on `mcp` → `false`; a real role on `mcp` → `true`.

### Change screens (AP-dup-05)

- `ChangeRunScreen.handleRun` builds a `ChangeManager` via `createChangeManager({ db, configName: activeConfigName ?? '', projectRoot, settings, cryptoIdentity, activeConfig })` and calls `.run(change.name)` in place of the inline `ChangeContext` object + `executeChange(context, change)`.
- `ChangeRevertScreen.handleRevert` does the same with `.revert(change.name)` in place of `revertChange(context, change)`.
- Both screens delete their now-unused imports (`executeChange`/`revertChange` from `core/change/executor.js`, `resolveScreenIdentity`/`resolveChangesDir`/`resolveSqlDir` from `tui/utils/index.js` if no longer referenced elsewhere in the file) and add `createChangeManager` to their `tui/utils/index.js` import.
- `conn.destroy()` still happens in both — `createChangeManager` doesn't own the connection lifecycle (it's built from an already-connected `db`), only the `ChangeContext`/execution. This part of the screens is unchanged.

### `withScreenConnection` adoption (AP-dup-07)

- `src/tui/utils/connection.ts`: add the `onConnect` option per D1. No other behavior change.
- `RunBuildScreen.tsx` `executeBuild`, `RunExecScreen.tsx` `executeFiles`: replace the inline `testConnection` → `createConnection` → try/catch/finally block with a single `withScreenConnection(activeConfig.connection, activeConfigName, async (db) => {...})` call, handling the returned `[result, err]` tuple. No `try`/`catch` — per `.claude/rules/typescript.md`, use the tuple directly.
- `DbTeardownScreen.tsx` `executeTeardown`, `DbTruncateScreen.tsx` `executeTruncate`: same swap. These two don't call `testConnection` today (they reuse an already-verified shared connection for the preview phase, then open a fresh one for the destructive op) — `withScreenConnection` adds that connectivity check as a consistent side effect of adoption; harmless since the DB is already known reachable, and matches how the other adopting screens now behave.
- `RunDirScreen.tsx` `executeDir`, `RunFileScreen.tsx` `executeFile`: same swap, **plus** `onConnect: (conn) => { activeConnectionRef.current = conn; }` to preserve the existing cancel-ref behavior. The `finally`-block `activeConnectionRef.current = null; await conn.destroy();` is replaced — `withScreenConnection` owns the destroy; the screen only needs to null the ref after the call resolves.
- Acceptance check (run after each iteration touching these files):

  ```bash
  grep -rn 'Connection failed: ${connErr' src/tui/
  ```

  Must return exactly one hit: `src/tui/utils/connection.ts` (the helper's own definition). `ConnectionProvider.tsx` is the documented exception (D2) — if this check is run against `src/tui/screens/` specifically instead, `ConnectionProvider.tsx` is outside that path and the check passes cleanly; if run against all of `src/tui/`, expect and note the one `ConnectionProvider.tsx` hit as the D2 exception, not a regression.


## Out of scope

- No new abstractions beyond D1's `onConnect` option (justified, minimal, additive).
- No behavior change to the policy matrix, roles, or any permission other than fixing the mcp-visibility null-handling disagreement.
- `ConnectionProvider.tsx` refactor (D2).
- Any of the 5 change-execution screens' UI/copy/keybindings — behavior-preserving refactor only.
- Ticket 32 (`v1/32-session-status`, unmerged) introduces a *third* independent inline copy of the same mcp-invisibility check in `src/rpc/commands/session.ts`'s new `statusCommand` (`config.access.mcp === false`). That file doesn't exist on this branch's base (master) and isn't touched here — noted for whoever reconciles the merge, not fixed in this spec.


## Checkpoints

| # | Checkpoint | Files/areas | Verifies |
|---|------------|-------------|----------|
| CP1 | `isVisibleToChannel` + wire both rpc call sites | `src/core/policy/check.ts`, `src/core/policy/index.ts`, `src/rpc/commands/config.ts`, `src/rpc/session.ts`, new test | Fail-closed test red→green; `list-configs.test.ts` + `session.test.ts` still green |
| CP2 | Change screens adopt `createChangeManager` | `src/tui/screens/change/ChangeRunScreen.tsx`, `ChangeRevertScreen.tsx` | No `executeChange`/`revertChange` import in either file; typecheck/lint/build green |
| CP3 | `withScreenConnection` gains `onConnect`; adopted by the 4 screens that don't need it | `src/tui/utils/connection.ts`, `RunBuildScreen.tsx`, `RunExecScreen.tsx`, `DbTeardownScreen.tsx`, `DbTruncateScreen.tsx` | rg check clean for these 4; typecheck/lint/build green |
| CP4 | `withScreenConnection` adopted with `onConnect` for cancel-ref preservation | `RunDirScreen.tsx`, `RunFileScreen.tsx` | rg check clean; cancellation code path reviewed line-by-line for parity (no test coverage exists — see Testing) |


## Testing

No existing screen-level tests exist for any of the 7 `withScreenConnection` files or the 2 change screens (`tests/cli/screens/` only covers `init/`) — the dispatch brief's assumption of "existing screen tests as safety net" does not hold; this is a deviation, noted for the record, not silently worked around. Given that gap, TUI checkpoints (CP2-CP4) lean on: typecheck (catches signature/shape drift), lint, build (these screens render through `dist/` in some CI paths), the `rg` proof of pattern removal, and close manual diff review for behavior parity — especially the cancellation path in CP4, which is the highest-risk, least-observable change in this spec.

Policy checkpoint (CP1) is TDD: write the fail-closed null-handling test first (red), then add `isVisibleToChannel` (green), then wire the two call sites.

Test commands: `bun run typecheck`, `bun run lint`, `bun run build` (only if a CP requires `dist/`), plus the specific test files touched/added:
- `tests/core/policy/check.test.ts` (or a new `tests/core/policy/visibility.test.ts` if cleaner — implementer's call, follow existing file granularity in `tests/core/policy/`)
- `tests/core/rpc/list-configs.test.ts`
- `tests/core/rpc/session.test.ts`

No integration/docker tests. No `tests/cli` serial run required unless a change screen's typecheck/build surfaces a `tests/cli` regression — if so, run `bun test --serial tests/cli` and report.


## Acceptance criteria (verbatim from ticket)

- No hand-rolled connect/test/destroy in TUI screens (`rg` for the pattern returns only the helper).
- One policy visibility implementation; a test pinning the fail-closed null-handling behavior.


## Change log

- 2026-07-12 — initial spec, authored inline by the orchestrator per `/subagent-implementation` (no design doc — ticket is pre-scoped, spec-only per dispatch brief).
- 2026-07-12 — checkpoint table normalized to the `# | Checkpoint | Files/areas | Verifies` column contract (`atomic validate spec`); implementation log appended at finalize. No decision changes.

## Implementation log

### shipped — 2026-07-12

Built across 4 iterations of /subagent-implementation (fresh atomic-implementer → atomic-reviewer per checkpoint, sonnet). Every reviewer pass returned PASS with 0🔴 0🟡 0🔵 0❓. Commits (chronological):

- `9f47d7b` — spec (this doc)
- `eb083a0` — CP1: `isVisibleToChannel` in core/policy, wired into `list_configs` + `SessionManager.connect`; fail-closed null-handling test (red→green). Fixes the latent disagreement where `config.ts` had no `access` guard while `session.ts` did.
- `1f8a1d1` — CP2: ChangeRunScreen/ChangeRevertScreen adopt `createChangeManager` (`.run`/`.revert`), dropping the hand-rolled ChangeContext.
- `43471c3` — CP3: `withScreenConnection` gains optional `onConnect` hook; adopted by RunBuild/RunExec/DbTeardown/DbTruncate.
- `a290e7a` — CP4: RunDir/RunFile adopt `withScreenConnection` with `onConnect` to preserve mid-run cancel-ref.

**Out-of-scope work performed during this build:**

- none — scope held to the two Change screens, the six connection-adopting screens, and the one policy consolidation. `ConnectionProvider.tsx` excluded by design (D2).

**Unforeseens — surprises that emerged during implementation:**

- The dispatch brief assumed existing screen tests as a safety net; there are none (`tests/cli/screens/` only covers `init/`). TUI checkpoints leaned on typecheck + lint + build + rg pattern-removal proofs + line-by-line diff review instead. Recorded in the Testing section.
- CP4's test→create cancel-check seam is now internal to `withScreenConnection` and cannot be reproduced; accepted as a microsecond window still guarded by the post-create check. Flagged and reviewer-verified.
- `withScreenConnection` needed an `onConnect` hook to fit the two cancel-ref screens without exposing the raw connection — the one justified addition (D1), additive since the helper had zero prior callers.

**Deferred items still open:**

- F-1 (FOLLOWUPS): `DbTransferScreen`/`SqlTerminalScreen` hand-roll `conn.destroy()` but were outside AP-dup-07's 7-file scope and carry neither duplicated error-string template. Their dual/persistent connection shapes likely don't fit `withScreenConnection`'s one-shot contract (same reason as the D2 ConnectionProvider exclusion). Left for a future connection-lifecycle audit; not this ticket.
