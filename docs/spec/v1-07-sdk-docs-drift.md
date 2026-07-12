# Spec: v1-07 — SDK/docs drift corrections

Ticket: `tickets/v1/07-sdk-docs-drift.md` · Findings: VR-api-03, VR-docs-02/-03/-04/-05 (`research/v1-audit/v1-release/sdk-api-surface.md`, `docs-drift.md`)

The body of this spec is current truth. Superseded decisions live only in the change log.


## Objective


Every API referenced in shipped docs, JSDoc examples, example READMEs, and the AI-agent skill file must exist in today's source. Five copy-paste-level corrections; no behavior change, no new APIs.

TDD skipped because: docs/JSDoc-only change — no runtime behavior to test. Gate is `bun run typecheck` plus `rg` sweeps proving zero remaining occurrences of each bad form.


## Checkpoints


All line numbers re-verified against branch `v1/07-sdk-docs-drift` @ `1f718c5`. Verification commands (V1-V5) are listed after the table.

| CP | Fix | Files (verified lines) | Bad form → correct form | Verify |
|----|-----|------------------------|-------------------------|--------|
| CP1 | JSDoc `@example` on `ExportOptions`/`ImportOptions` calls top-level Context methods that don't exist (ships in published `.d.ts`) | `src/sdk/types.ts:91,117` | `ctx.exportTable(...)` → `ctx.noorm.dt.exportTable(...)`; `ctx.importFile(...)` → `ctx.noorm.dt.importFile(...)` — mirror the correct examples at `src/sdk/namespaces/dt.ts:34,60`; keep tuple-return style as-is | V1 |
| CP2 | Tutorial + teardown guide call nonexistent Context methods | `docs/getting-started/building-your-sdk.md:373,382`; `docs/guide/database/teardown.md:195,196,234` (+ prose ~240) | `this.#ctx.reset()` → `this.#ctx.noorm.db.reset()`; `this.#ctx.truncate()` → `this.#ctx.noorm.db.truncate()`; `ctx.truncate()` → `ctx.noorm.db.truncate()`; `ctx.runFile('./seeds/test-data.sql')` → `ctx.noorm.run.file('./seeds/test-data.sql')`; `ctx.reset()` → `ctx.noorm.db.reset()`; teardown.md prose "combines `teardown()` and `build({ force: true })`" → reference `ctx.noorm.db.teardown()` / `ctx.noorm.run.build({ force: true })` | V2 |
| CP3 | Imports from never-published `noorm/sdk` / `noorm/core` | `docs/dev/sdk.md:19,26,853,890,910,928,957` + prose ~16; `docs/guide/database/teardown.md:178`; `src/sdk/index.ts:8` (JSDoc, ships in `.d.ts`); `docs/dev/sdk.md:95` and `docs/dev/project-discovery.md:99` (`findProjectRoot` from `noorm/core`) | `from 'noorm/sdk'` → `from '@noormdev/sdk'` everywhere; sdk.md prose "part of the main noorm package" → standalone `@noormdev/sdk` package. `findProjectRoot` is NOT exported from `@noormdev/sdk`: in `docs/dev/sdk.md:93-98` rewrite the blockquote — `projectRoot` defaults to `process.cwd()` (`src/sdk/index.ts:93`, `src/sdk/types.ts:48`); pass the directory containing `.noorm/` explicitly when running elsewhere; drop the import example. In `docs/dev/project-discovery.md:99` (internal dev doc) label the import as internal source module `src/core/project.ts`, not a published package | V3 |
| CP4 | pg example README setup uses nonexistent `db create --name` flag | `examples/llm-memory-db-pg/README.md:53-59` (Setup block) | Replace with the config-first workflow proven by the mssql sibling (`examples/llm-memory-db-mssql/README.md:31-37`): show `dev.json`/`test.json` contents (values from `examples/llm-memory-db-pg/.noorm/settings.yml` stages: postgres, localhost:15432, `noorm_llm_dev`/`noorm_llm_test`, user/password `noorm_test`, `isTest` false/true), then `noorm config import dev.json` / `test.json`, then `noorm db create -c dev` / `-c test`, keeping the existing `noorm config use dev` / `noorm run build` / `noorm change ff` lines. Note config-before-create ordering as the mssql sibling does | V4 |
| CP5 | Skill file documents nonexistent `noorm help <cmd>` subcommand | `skills/noorm/references/cli.md:771-781` (`### help` section) | `noorm help` / `noorm help config use` / `noorm help change ff` → `noorm --help` / `noorm config use --help` / `noorm change ff --help`; adjust the section heading/prose to the `--help` flag form (there is no `help` subcommand) | V5 |


## Verification commands (API-exists proofs)


```bash
# V1 — real dt API (expect hits at dt.ts:37 and dt.ts:65)
rg -n 'async exportTable' src/sdk/namespaces/dt.ts
rg -n 'async importFile' src/sdk/namespaces/dt.ts

# V2 — real db/run API (expect db.ts:276 truncate, :298 teardown, :319 reset; run.ts:104 file, :161 build)
rg -n 'async truncate\(' src/sdk/namespaces/db.ts
rg -n 'async teardown\(' src/sdk/namespaces/db.ts
rg -n 'async reset\(' src/sdk/namespaces/db.ts
rg -n 'async file\(' src/sdk/namespaces/run.ts
rg -n 'async build\(' src/sdk/namespaces/run.ts

# V3 — published package name; findProjectRoot not an SDK export (expect @noormdev/sdk; expect 0 hits)
rg -n '"name"' packages/sdk/package.json
rg -n 'findProjectRoot' src/sdk/index.ts

# V4 — db create takes only config + json (expect args block with exactly those two)
sed -n '19,22p' src/cli/db/create.ts

# V5 — no help subcommand, only --help interceptor (expect only the interceptor hit ~line 301)
rg -n "subCommands|'help'" src/cli/index.ts
```


## Do-not-touch list (deliberate negative-form mentions)


These files mention the bad forms on purpose — they document the gotchas. Leave unchanged:

- `docs/guide/troubleshooting.md` (both gotchas, negative form)
- `docs/cli/help.md` (documents absence of a `help` subcommand)
- `docs/guide/database/create.md:142` (link text about the `--name` gotcha)
- `examples/llm-memory-db-mssql/mssql-problems.md`, `examples/llm-memory-db-mssql/REPORT.md`, `examples/llm-memory-db-pg/REPORT.md`, `examples/llm-memory-db-pg/REPORT-PHASE-1.md` (historical audit reports)


## Acceptance criteria


1. `bun run typecheck` green (CP1/CP3 touch `src/sdk/types.ts` and `src/sdk/index.ts` JSDoc only).
2. Zero-occurrence sweeps (run from repo root; corrected `ctx.noorm.*` forms do not match these patterns):

    ```bash
    rg -n 'ctx\.exportTable|ctx\.importFile' src/ docs/ examples/ skills/ README.md   # → 0
    rg -n 'ctx\.reset\(|ctx\.truncate\(|ctx\.runFile\(' src/ docs/ examples/ skills/ README.md   # → 0
    rg -n "from 'noorm/sdk'|from 'noorm/core'" src/ docs/ examples/ skills/ README.md   # → 0
    rg -n 'db create --name' examples/llm-memory-db-pg/README.md   # → 0
    rg -n 'noorm help' skills/   # → 0
    ```

    Full-repo hits for `db create --name` / `noorm help` may remain only in do-not-touch files.
3. Every changed code sample references only exports/flags that exist today (reviewer spot-verifies against `src/sdk/`, `src/cli/`).
4. Error-handling style in touched examples is unchanged (tuple returns stay tuples — see out of scope).


## Out of scope


- Error-style conversion (tuples → throws): project ruling D1 lands in ticket 25; the doc-example sweep for it is ticket 26. Fix API *names* only, as they exist today (`ctx.noorm.dt.exportTable` returns a tuple — keep it).
- Any new API, export, or CLI flag. If a documented API "should" exist, that is a decision, not this ticket.
- VR-docs-01 flag-placement sweep (`noorm --json X` → `noorm X --json`) — separate ticket.
- Committing `dev.json`/`test.json` files to the pg example — the README instructs their creation, mirroring the mssql sibling.
- `docs/dev/sdk.md` content beyond the import lines and the `findProjectRoot` blockquote (e.g. its error-handling section's try/catch examples — ticket 26).


## Change log


- 2026-07-12 — spec created from ticket 07 + audit findings; all line numbers re-verified against worktree branch `v1/07-sdk-docs-drift` @ `1f718c5`.
