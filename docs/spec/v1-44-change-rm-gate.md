# Spec: v1-44 `change:rm` permission — gate changeset deletion on all surfaces

Ticket: `tickets/v1/44-change-rm-ungated.md` (realm repo). Found during live UAT 2026-07-13: a `viewer`-role config deleted a changeset via the TUI. Branch: `v1/44-change-rm-gate` off `next` @ `8f840f1`. Reviewers diff against `8f840f1`. **v1-blocker.**

## Goal

`change:rm` was never modeled in the access-role permission set (`docs/spec/config-access-roles.md` — the source of truth `src/core/policy/matrix.ts` mirrors), so changeset deletion is ungated on every surface:

- TUI `src/tui/screens/change/ChangeRemoveScreen.tsx` — no `checkConfigPolicy` call (every sibling change screen has one at ~line 57-62); deletes from disk (`deleteChange`, line ~127) AND deletes the DB tracking record when the change was applied (line ~131, via `ChangeHistory` + `createConnection`).
- CLI `src/cli/change/rm.ts` — interactive y/n prompt but no policy gate; disk-only deletion.
- SDK `src/sdk/namespaces/changes.ts` `delete()` (~line 160) — bare `coreDeleteChange(change)`, no `checkProtectedConfig` (the file already imports it at line 38 for other methods).

Add the permission and gate all three surfaces with the exact machinery their siblings use. Deletion *semantics* (what gets deleted) are unchanged — only who may trigger it.

## The permission

New matrix row, mirroring `config:rm` (irreversible deletion of a managed artifact):

    'change:rm': { viewer: 'deny', operator: 'confirm', admin: 'confirm' },

Rationale recorded here for the spec amendment: deleting an applied change also deletes its DB tracking row — ledger corruption if casual — so admin gets `confirm` (like `config:rm` and `db:destroy`'s posture), not `allow`. The `Permission` type in `src/core/policy/types.ts` gains the member; the spec's permission list and matrix table gain the row.

## Checkpoints

| # | Checkpoint | Files | Agent | Verifies |
|---|---|---|---|---|
| 1 | Model: permission + matrix + spec amendment | `src/core/policy/types.ts`, `src/core/policy/matrix.ts`, `docs/spec/config-access-roles.md`, policy unit tests | atomic-implementer (mode: feature) | `change:rm` in Permission type, MATRIX row as above, spec body's permission list + matrix table updated with a change-log entry (per spec-currency rules: body = current truth). Policy unit tests (find the existing matrix/check tests and extend) assert the three cells. |
| 2 | TUI gate | `src/tui/screens/change/ChangeRemoveScreen.tsx` | atomic-implementer (mode: surgical) | Mirrors `ChangeRevertScreen.tsx`'s gating exactly: `const check = activeConfig ? checkConfigPolicy('user', activeConfig, 'change:rm') : null;` plus whatever render/confirm branches the sibling uses for `deny`/`confirm` cells (read the sibling first; reuse its components — do not invent a new denied-state UI). Viewer sees the deny state and cannot reach the delete step; operator/admin flow through the confirm machinery. |
| 3 | CLI gate | `src/cli/change/rm.ts` | atomic-implementer (mode: surgical) | Mirrors the gating in `src/cli/change/revert.ts` (or `ff.ts` — whichever is the established pattern; read both): policy check before any prompt, deny → clear message + exit 1, confirm cell honored via the standard `--yes`/`NOORM_YES` machinery from ticket 02 (`src/cli/_utils.ts`). Tests in `tests/cli/change/` assert viewer-deny exit 1 and operator+`--yes` success, mirroring existing role-gate tests (e.g. `tests/cli/db/reset.test.ts`'s seedConfig harness). |
| 4 | SDK gate | `src/sdk/namespaces/changes.ts` | atomic-implementer (mode: surgical) | `delete()` calls `checkProtectedConfig(this.#state.config, this.#state.options, 'change:rm', 'changes.delete')` before `coreDeleteChange`, matching the pattern other namespaces use (see `run.ts` `build()` line ~177). Unit test: viewer-role state → `delete()` throws the policy error, no disk mutation; admin + yes → deletes. |

## Non-goals

- Changing what deletion does (disk vs DB-record branches stay as-is).
- Gating other ungated file-management ops (`change add`/`edit` scaffolding) — read-side and creative ops are out of scope; if the audit surfaces more ungated destructive ops, record them in FOLLOWUPS.md, do not fix here.
- MCP-channel-specific handling beyond what `checkConfigPolicy`/`checkProtectedConfig` already do (mcp collapse semantics are established).

## Acceptance criteria (from ticket)

- Viewer-role config cannot delete a changeset from TUI, CLI, or SDK; operator/admin get the confirm cell.
- Spec and matrix stay in lockstep.
- Test per surface per denied/confirmed path.

## Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| Sibling screens' confirm-cell UX differs from a simple Confirm dialog (SmartConfirm with typed phrase?) | medium | Read `ChangeRevertScreen`/`ChangeFFScreen` first and copy their exact confirm handling — `confirmationPhraseFor` exists in `src/core/policy/` and may be part of the pattern. |
| Existing TUI tests for ChangeRemoveScreen don't exist (no TUI screen suites) | high | Rely on the policy/CLI/SDK tests + typecheck for automated proof; record the TUI manual-verification steps in TESTING.md for the orchestrator's UAT handoff. |
| `Permission` type is consumed exhaustively somewhere (switch/Record) that breaks on the new member | medium | typecheck catches Record<Permission, ...> exhaustiveness; grep for other `Permission`-keyed maps (docs tables in `docs/headless.md` enumerate the matrix — update if they list permissions). |

## Change log

- 2026-07-13 — initial spec, authored by orchestrator pre-implementation.

## Implementation log

### shipped (uncommitted merge) — 2026-07-13

Built across 4 iterations of the implement-review subagent loop, one checkpoint each, zero CHANGES_REQUESTED rounds (every reviewer pass returned VERDICT PASS with zero findings on the first attempt). Commits (chronological):

- 2867115 — docs(spec): add v1-44 change:rm gate spec
- 5dc77c7 — CP1: feat(policy): add change:rm permission to access matrix
- 4f950bd — CP2: feat(tui): gate ChangeRemoveScreen behind change:rm policy
- 2d0bba5 — CP3: feat(cli): gate change rm behind change:rm policy
- 7a78d85 — CP4: feat(sdk): gate changes.delete behind change:rm policy

Out-of-scope work performed during this build:

- none. Every checkpoint stayed within its declared Files scope.

Unforeseens — surprises that emerged during implementation:

- CP3 (CLI gate): the spec text pointed at src/cli/change/revert.ts and ff.ts as the CLI gating pattern to mirror. Neither actually calls checkConfigPolicy directly — they inherit enforcement for free through the core-seam in core/change/executor.ts (assertChangePolicy), since they route through withContext and the SDK. rm.ts is an offline, disk-only operation with no such seam to inherit from, so it needs its own direct check. The implementer pivoted to mirror src/cli/config/rm.ts instead, which has an identical deny/confirm/confirm matrix shape and the same direct-check structure. The reviewer verified this pivot was correct, not a deviation.
- CP3 also surfaced and fixed a pre-existing gap: rm.ts checked raw args.yes instead of isYesMode(args), so NOORM_YES=1 alone did not previously satisfy its ad-hoc confirm prompt. Folded into the same checkpoint since the confirm-gate rewrite touched that exact code path.
- CP4: change:rm is a deny/confirm/confirm matrix row, unlike change:revert's deny/confirm/allow — admin is NOT frictionless for delete(). The test suite needed five role/yes combinations instead of the usual two-sided viewer/admin pattern other namespaces use, plus a dedicated real-filesystem disk-mutation test since the spec explicitly required proving no-mutation-on-deny and actual-deletion-on-allow, not just error-type assertions.

Deferred items still open:

- F-1 (blue nit, docs/headless.md staleness): the Access Roles matrix table and the change rm command section in docs/headless.md do not yet mention change:rm. Recorded in FOLLOWUPS.md, not fixed in this build (out of every checkpoint's declared scope). No red or yellow findings were produced by the loop.
