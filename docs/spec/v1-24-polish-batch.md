# Spec: v1-24 Post-v1 polish batch

Ticket: `tickets/v1/24-polish-batch.md` (realm repo). Branch: `v1/24-polish-batch` off `next` @ `bce82df`. Reviewers diff against `bce82df`. Five independent small items; each is its own checkpoint.

## Goal

1. **`ImportOptions` reuses `ConflictStrategy`.** `src/sdk/types.ts:140` declares `onConflict?: 'fail' | 'skip' | 'update' | 'replace'` inline; the canonical union `ConflictStrategy` lives at `src/core/transfer/types.ts:19`. Import the type and use it. The unions are textually identical, so `.d.ts` consumers see no change.
2. **One NOORM_DEBUG truthiness rule.** `src/core/environment.ts:89` `isDebug()` uses `=== 'true'`; `src/core/observer.ts:247` and `src/core/connection/manager.ts:60,71` use raw truthiness (so `NOORM_DEBUG=0` *enables* debug there). Fix: `isDebug()` delegates to the existing `isEnvTruthy()` (same file, line 110 — ticket 02's helper, whose JSDoc already names NOORM_DEBUG as the intended future consumer), and all three call sites call `isDebug()`. Resulting rule everywhere: `0`/`false`/empty disable, any other non-empty value enables.
3. **camelCase citty args.** Kebab-declared args: `src/cli/db/transfer.ts:173,177,185,189` (`on-conflict`, `batch-size`, `no-fk`, `no-identity`) and `src/cli/ci/identity/enroll.ts:43` (`public-key`). Rename keys to camelCase (`onConflict`, `batchSize`, `noFk`, `noIdentity`, `publicKey`) to match the rest of the CLI. **The flag surface must not change**: `--on-conflict` etc. must keep parsing. Citty converts camelCase arg names to kebab-case flags — verify this empirically with the built CLI or a unit test before relying on it; if it does not, keep `alias: 'kebab-name'` entries. Update all `args['kebab-name']` accessors.
4. **Delete the never-adopted `export namespace` rule.** Remove the "Namespace types under the class" sentence and the `export namespace StateManager { ... }` block from `.claude/rules/typescript.md`'s Class Patterns section (0/55 classes follow it). Keep the `#`-prefix guidance.
5. **Stop serializing `err.stack` across MCP.** `src/mcp/server.ts:135` returns `JSON.stringify({ error: err.message, stack: err.stack })` to the MCP client. Drop `stack` from the payload; log it server-side following the file's existing logging pattern (match whatever `src/mcp/server.ts` already does for diagnostics — do not invent a new logger). Matches the CLI's message-only error shape.

## Non-goals

- NOORM_YES handling (ticket 02, already landed) — only NOORM_DEBUG call sites change.
- Any new flags, options, or behavior in `db transfer` / `ci identity enroll` — key renames only.
- Restructuring MCP error responses beyond removing `stack`.

## Checkpoints

| # | Checkpoint | Files | Agent | Verifies |
|---|---|---|---|---|
| 1 | ConflictStrategy reuse | `src/sdk/types.ts` | atomic-implementer (mode: surgical) | `ImportOptions.onConflict` typed as `ConflictStrategy`; import path consistent with the file's existing imports; `bun run typecheck` green; SDK type tests (if any reference ImportOptions) green. |
| 2 | NOORM_DEBUG helper | `src/core/environment.ts`, `src/core/observer.ts`, `src/core/connection/manager.ts` | atomic-implementer (mode: feature) | `isDebug()` uses `isEnvTruthy`; both raw `process.env['NOORM_DEBUG']` checks replaced with `isDebug()`; test proves `NOORM_DEBUG=0` disables and `NOORM_DEBUG=1` enables (ticket acceptance criterion). Note observer.ts evaluates at module scope — test via subprocess or module-cache reset, matching how existing environment tests handle env-dependent module state. |
| 3 | camelCase citty args | `src/cli/db/transfer.ts`, `src/cli/ci/identity/enroll.ts` | atomic-implementer (mode: feature) | Keys renamed; all accessors updated; CLI tests prove `--on-conflict`, `--batch-size`, `--no-fk`, `--no-identity`, `--public-key` still parse (existing `tests/cli/**` for these commands extended if not already covering flag parsing). |
| 4 | Rule-file cleanup | `.claude/rules/typescript.md` | atomic-implementer (mode: surgical) | `export namespace` example and its prose gone; no other rule content touched. |
| 5 | MCP stack removal | `src/mcp/server.ts` | atomic-implementer (mode: surgical) | Payload carries `{ error: err.message }` only; stack logged server-side; MCP tests updated/added for the error shape. |

## Acceptance criteria (from ticket)

- `NOORM_DEBUG=0` disables debug everywhere (test).
- MCP error payloads carry message only; stack appears in server logs.

## Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| citty does not auto-kebab camelCase args → renamed flags break | medium | Empirical check first (checkpoint 3); fall back to explicit `alias` entries so the surface is provably unchanged. |
| `isDebug()` semantics change surprises a NOORM_DEBUG=true user | low | `true` remains truthy under `isEnvTruthy` — strictly widening (`1`, `yes` now also work); only `0`/`false` flip from enable→disable, which is the bug being fixed. |
| observer.ts module-scope evaluation makes the debug test flaky | medium | Subprocess-based test or documented module-reset pattern; if neither is clean, test `isDebug()` directly and assert observer.ts/connection-manager call it (AST check), noting why in the test. |

## Change log

- 2026-07-12 — initial spec, authored by orchestrator pre-implementation.
