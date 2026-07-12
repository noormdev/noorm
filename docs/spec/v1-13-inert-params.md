# Spec: delete inert parameters (v1 audit ticket 13)

Ticket: `tickets/v1/13-delete-inert-parameters.md` · Findings: AP-yagni-04, AP-yagni-02 (`research/v1-audit/atomic-principles/yagni.md`) · Decision: `tickets/v1/00-DECISIONS.md` D8 (RULED 2026-07-11 — comment the intent, delete the seam)

The body of this spec is current truth. Superseded decisions live only in the change log.


## Goal

Delete two option surfaces that are accepted but do nothing for any real caller: `ToUniversalOptions.version` (silently dropped inside `toUniversalType`) and the `connectionString`/`connectionBridge`/`computePool` DI-override trio on `ExportTableOptions`/`ImportFileOptions` (D8 — the worker-fetch DI seam). Both are deletion-only, behavior-preserving for every existing caller.

**Correction to the ticket text:** the ticket and its dispatch brief say `ToUniversalOptions.version` lives in `src/sdk/types.ts`. It does not — `src/sdk/types.ts` has no `ToUniversalOptions` type at all (it holds `ExportOptions`/`ImportOptions`, the SDK-facing option bags ticket 25 owns). The actual type is `src/core/dt/type-map.ts:29-40` (`ToUniversalOptions`), consumed by `toUniversalType()` at `type-map.ts:76-95`, with the dead pass-through at `src/core/dt/schema.ts:84-88` — exactly matching the original audit evidence (AP-yagni-04). This spec targets the real location. Net effect for the ticket-25 merge touchpoint: **zero file overlap** — this spec never touches `src/sdk/types.ts`, `src/sdk/namespaces/*.ts`, `ExportOptions`, or `ImportOptions`.


## Non-goals

- `ExportTableOptions.version` / `ImportFileOptions.version` (a different, still-used field — feeds `DtSchema.dv` and downstream `toDialectType` version-aware target mapping). Not touched.
- `ToDialectOptions.version` (genuinely used by `toDialectType` for target-side type selection). Not touched.
- `src/sdk/types.ts`, `ExportOptions`, `ImportOptions`, `src/sdk/namespaces/*.ts` — ticket 25's territory (branch `v1/25-sdk-contract`, in flight). If any edit in this spec turns out to require touching these, stop and report instead.
- Any other option on `ExportTableOptions`/`ImportFileOptions` (`schema`, `passphrase`, `batchSize`, `onConflict`, `truncate`, `tables`) — all have real callers, untouched.
- Re-implementing worker-routed DT export/cross-DB fetch/shared serializer pools. The D8 ruling is delete-and-comment, not build-out.


## Success criteria

- [ ] `ToUniversalOptions.version` field removed from `src/core/dt/type-map.ts`; the dead pass-through (`version,`) removed from the `toUniversalType(...)` call inside `buildDtSchema` in `src/core/dt/schema.ts`.
- [ ] `ExportTableOptions.connectionString` / `.connectionBridge` / `.computePool` and `ImportFileOptions.computePool` removed from `src/core/dt/types.ts`, plus their now-fully-unused `WorkerBridge`/`WorkerPool`/`ConnectionEvents`/`ComputeEvents` type imports in that file.
- [ ] `src/core/dt/index.ts`: the DI-seam plumbing (`createDefaultConnectionBridge`, `CONNECTION_WORKER`, the `connectionBridge`/`computePool` override-resolution blocks in `exportTable`/`importDtFile`, the `connectionBridge` branch in `exportTableWithWorkers`) is deleted. Every caller now unconditionally takes the in-process Kysely fetch + internally-owned compute pool path — the only path any real caller has ever exercised.
- [ ] A short comment sits at the `exportTable()` DI-seam site recording: what the seam was for (TUI connection-worker handoff for off-main-thread fetch during a big export; cross-database fetch via a caller-supplied `connectionString`; a shared serializer pool across a batch of table exports via `computePool`), and that this diff (find it via `git log`/`git blame` on this file, or the deleted `createDefaultConnectionBridge` shape) is the rebuild recipe if a first real caller shows up.
- [ ] Zero-caller proof recorded for both removals (grep evidence in the implementation log — see Checkpoints).
- [ ] `bun run typecheck`, `bun run lint`, `bun run build` all green.
- [ ] `tests/core/dt/**` and `tests/sdk/**` green (no test references the removed fields; none needed updating beyond compiling).
- [ ] Public SDK types (`src/sdk/types.ts`) never advertised these options in the first place — confirmed unaffected, not "no longer advertise."


## Approaches

| Approach | Description | Trade-off |
|---|---|---|
| A — delete + short intent comment (chosen) | Remove the dead field/branches; leave one short comment at each seam recording intent + rebuild path | Matches D8 ruling exactly; zero behavior change; loses nothing since the deleted code is still in git history |
| B — keep with roadmap comment, no deletion | Leave the DI seam in place, just document it's unused | Rejected by D8 ruling — "coherent design, built ahead of wiring that never landed" is exactly the AP-yagni pattern; keeping unreachable branches forever costs more than a cheap rebuild later |
| C — implement the TUI worker-routed wiring now | Wire `connectionBridge`/`computePool` into a real TUI caller instead of deleting | Rejected — out of scope for a pre-v1 deletion ticket; no near-term caller identified in the D8 investigation |

## Recommendation

Approach A, per the D8 ruling verbatim: "delete the trio and its override plumbing; leave a short comment at the site recording the seam's intent... so rebuilding it with the first real caller is an afternoon, not archaeology."


## Change tree

    src/core/dt/
    ├── type-map.ts .......... M  (ToUniversalOptions: drop `version` field + its doc comment)
    ├── schema.ts ............ M  (buildDtSchema: drop `version,` pass-through arg into toUniversalType(); keep the `version` local var — still feeds `dv` and downstream target-mapping)
    ├── types.ts ............. M  (ExportTableOptions: drop connectionString/connectionBridge/computePool; ImportFileOptions: drop computePool; drop now-unused WorkerBridge/WorkerPool/ConnectionEvents/ComputeEvents imports)
    └── index.ts ............. M  (exportTable/exportTableWithWorkers/importDtFile: delete DI-seam plumbing, collapse to the always-taken in-process-fetch + owned-compute-pool path; delete createDefaultConnectionBridge + CONNECTION_WORKER; drop now-unused ConnectionEvents import; add intent comment)


## Outline

    src/core/dt/type-map.ts
      ToUniversalOptions — drop `version?: DatabaseVersion` member

    src/core/dt/schema.ts
      buildDtSchema — stop forwarding `version` into the toUniversalType() call (keep computing/returning it elsewhere in the function)

    src/core/dt/types.ts
      ExportTableOptions — drop connectionString, connectionBridge, computePool members
      ImportFileOptions — drop computePool member

    src/core/dt/index.ts
      createDefaultConnectionBridge — delete (dead after seam removal)
      CONNECTION_WORKER — delete (only consumer was createDefaultConnectionBridge)
      exportTable — replace override-resolution block with unconditional createDefaultComputePool(); drop connectionBridge/ownedConnectionBridge entirely; add intent comment
      exportTableWithWorkers — drop connectionBridge from ctx type + destructure; Stage 0 row-count query becomes unreachable-branch-free (stays 0, matching today's real behavior); fetch loop drops the connectionBridge branch, keeps only the direct-Kysely-fetch body
      importDtFile — replace computePool override-resolution block with unconditional createDefaultComputePool()


## Flows

None — pure deletion, no new or changed externally-observable behavior. The one internal control-flow change (collapsing `if (connectionBridge) {...} else {direct fetch}` to just the direct-fetch body) is behavior-identical for every existing caller because `connectionBridge` was never non-`undefined` in any real invocation (zero-caller proof below) — the `if` branch was dead code from the day it shipped.


## Zero-caller proof (verified 2026-07-12)

**`ToUniversalOptions.version`:** every call site of `toUniversalType(...)` across `src/` and `tests/` passes only `{ dbType, dialect }` except the one dead pass-through at `schema.ts:84-88` being deleted here. `rg -n "toUniversalType\(" --type=ts` — 3 production call sites (`type-map.ts` definition, `schema.ts` ×2), only one (`schema.ts:84`, inside `buildDtSchema`) ever passed `version`; the second production call (`schema.ts:192`, inside `validateSchema`) never did. All ~40 test call sites (`tests/core/dt/type-map.test.ts`, `tests/core/dt/integration.test.ts`) pass only `dbType`/`dialect`.

**D8 trio (`connectionString`/`connectionBridge`/`computePool` on `ExportTableOptions`; `computePool` on `ImportFileOptions`):**
- SDK: `src/sdk/namespaces/dt.ts` `exportTable()` forwards only `schema`/`passphrase`/`batchSize`; `importFile()` forwards only `passphrase`/`batchSize`/`onConflict`/`truncate`. Neither ever touches the trio — confirmed by reading both methods in full.
- TUI: `src/tui/screens/db/DbTransferScreen.tsx:557` (export) passes `{ db, dialect, tableName, filepath, passphrase }`; `:680` (import) passes `{ filepath, db, dialect, passphrase, onConflict, truncate }`. No trio fields.
- CLI: `src/cli/db/transfer.ts:430` goes through the SDK wrapper (`ctx.noorm.dt.exportTable`), which (see above) never forwards the trio.
- Tests: `rg -n "connectionBridge|computePool|connectionString" tests/` outside `tests/workers/connection.test.ts` and `tests/core/dt/worker-pipeline.test.ts` — no hits. Those two files use `connectionString` only as the **worker-protocol `connect` payload field** (`bridge.request('connect', { dialect, connectionString })`), a different, still-live surface (`WorkerBridge`/`connection.ts` worker entry point) — unrelated to the `ExportTableOptions.connectionString` option being deleted here, and untouched by this spec. Neither file calls `exportTable`/`importDtFile`.
- The only test calling `exportTable`/`importDtFile` at all is `tests/sdk/destructive-ops.test.ts` (`dt.exportTable('users', './fake.dtz')`, `dt.importFile('./fake.dtz')`) — zero options object passed.
- No test anywhere in `tests/core/dt/` exercises `exportTableWithWorkers`/`importFileWithWorkers` (the file-based worker pipeline) directly — coverage there is at the primitive level (`DtWriter`/`DtReader`/`serialize`/`deserialize`/`DtStreamer`/schema/type-map), not the pipeline orchestration functions. This is a pre-existing gap, not one this spec introduces or is expected to close (ticket effort is S, deletion-only, scope boundary explicitly excludes new build-out). Behavior-preservation rests on the structural argument above (dead `if` branch removed) plus typecheck + the existing suite staying green.


## Checkpoints

Both checkpoints: `bun run typecheck`, `bun run lint`, `bun run build`, plus the scoped test run below. No live DB, no docker, no integration/CI groups needed — everything touched is exercised (or was already untouched) by local, no-external-service tests.

| # | Checkpoint | Files/areas | Agent | Est. files | Verifies |
|---|------------|-------------|-------|------------|----------|
| 1 | Remove `ToUniversalOptions.version` + the dead pass-through | `src/core/dt/type-map.ts`, `src/core/dt/schema.ts` | atomic-implementer (mode: surgical) | 2 | `bun test --serial tests/core/dt/type-map.test.ts tests/core/dt/schema.test.ts tests/core/dt/integration.test.ts` green; typecheck green; zero-caller grep re-verified |
| 2 | Remove the D8 DT worker-fetch DI seam; leave intent comment; collapse to in-process-fetch + owned-compute-pool | `src/core/dt/types.ts`, `src/core/dt/index.ts` | atomic-implementer (mode: surgical) | 2 | `bun test --serial $(find tests/core/dt tests/sdk -name '*.test.ts' | sort)` green; typecheck green; intent comment present at the `exportTable()` seam site; zero-caller grep re-verified; diff-read confirms the collapsed fetch loop is the former `else` branch verbatim (no logic change beyond removing the dead `if`) |

Commit per green checkpoint.


## Risks

| Risk | Likelihood | Mitigation |
|------|-----------|-----------|
| A caller passes the trio / `version` that this investigation missed | low | Zero-caller proof above covers every production call site + full test grep; if the implementer or reviewer finds one, stop and report per the ticket's scope boundary — do not delete out from under a real caller |
| Collapsing the `if (connectionBridge)`/`else` branches subtly changes the direct-fetch path (e.g. drops a line, mis-indents a shifted block) | low | Reviewer diff-reads the collapsed block against the original `else` body line-for-line; typecheck + existing suite as a backstop |
| Removing now-unused type imports (`WorkerBridge`, `ConnectionEvents`, etc.) in `types.ts`/`index.ts` breaks an import elsewhere that re-exports them | low | `rg` for re-exports of these specific type names from `dt/types.ts`/`dt/index.ts` before deleting; typecheck catches any miss immediately |
| No existing test exercises `exportTableWithWorkers`/`importFileWithWorkers` end-to-end, so a real behavior regression in the collapsed fetch loop could slip past the suite | medium | Out of scope to close (ticket is effort:S, deletion-only) — flagged here and in the implementation log as a pre-existing coverage gap, not introduced by this change |


## Change log

<!-- Populated on first amendment after the spec is approved. Do not log drafting/refinement turns. -->
