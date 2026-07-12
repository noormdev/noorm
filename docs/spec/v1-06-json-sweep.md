# Spec: `--json` placement sweep + delete dead NOORM_JSON surface (v1 ticket 06)


## Stacking

This branch (`v1/06-json-sweep`) is stacked on `v1/02-yes-flag` (HEAD `cde3e26`), not `master` — ticket 02 already modified `src/core/environment.ts` (added `isEnvTruthy`), the same file this spec edits to delete `shouldOutputJson`. The implementer/reviewer diff for every iteration is scoped to `git diff <iteration-base>...HEAD` inside this worktree, i.e. only this ticket's delta on top of 02's HEAD — never re-diff against `master`.


## Goal

Docs must show the CLI invocation form that actually works. `--json` (like `--force`/`--dry-run`) is a per-subcommand citty flag, not a root flag — `noorm --json <cmd>` is silently swallowed (no error, no JSON, default human output); only `<cmd> --json` works. `docs/cli/flags.md` and `docs/guide/troubleshooting.md` already document this correctly. Every other doc surface that shows the broken root-level form must be swept to the working post-subcommand form. Separately, `NOORM_JSON` is documented as a working "force JSON output" env var but has zero production call sites — the audit direction (per Conflict 1 in `research/v1-audit/v1-release/SUMMARY.md`) is to delete the dead surface rather than wire it.


## Evidence

- Ticket: `tickets/v1/06-json-flag-docs-sweep.md`
- `research/v1-audit/v1-release/docs-drift.md` VR-docs-01 — 33+25+~30 broken-form occurrences across README/docs/skills, contrasted with the two files that already document the rule correctly
- `research/v1-audit/v1-release/cli-contract.md` VR-cli-04 (dupe of VR-docs-01, docs/headless.md's 33 occurrences) and VR-cli-05 (`shouldOutputJson()` has zero production callers; prescription: "delete the function, its test, and the NOORM_JSON documentation rows")
- `research/v1-audit/v1-release/SUMMARY.md` Conflict 1 — ruling: sweep docs, delete dead NOORM_JSON surface; root-level `--json` interception deferred post-v1
- `src/core/environment.ts:132-143` — `shouldOutputJson()`, only reads `process.env['NOORM_JSON']`
- Zero-caller proof (re-verified this session): `rg -n 'shouldOutputJson' --type ts` returns only the definition (`environment.ts:137`) and its test file (`tests/core/config/env.test.ts:15,496,500,508,516`) — no production caller anywhere in `src/`.


## Scope decisions (read before implementing)

### A — Doc sweep scope is broader than the ticket's illustrative list, narrower than a literal `examples/` glob

The ticket prose names README.md/docs/index.md/docs/headless.md/skill file/docs/guide/ as examples, and the acceptance criterion says `rg 'noorm --json '` over `README, docs/, skills/, examples/` returns 0. A full repo sweep (this session) found **97** total root-level `--json ` occurrences across 23 files. Two are the ticket's named exceptions (already correct, do not touch):

- `docs/cli/flags.md` (3 occurrences) — shows the broken form under a "Does not work" heading, directly contrasted with the correct form above it.
- `docs/guide/troubleshooting.md` (1 occurrence) — same pattern, in a "doesn't produce JSON" gotcha heading.

Three more files exhibit the **identical pattern** (broken form shown deliberately, as a documented gotcha/historical repro, not as an instruction to follow) and are being treated the same way — this is a deviation from the literal `examples/` sweep-to-zero reading, flagged here rather than applied silently:

- `examples/llm-memory-db-mssql/mssql-problems.md` (3 occurrences, lines 96/100/255) — a `$`-prefixed shell transcript of an actual bug-hunting session; the broken form is what was literally typed and its (broken) output is shown. Rewriting it would falsify the transcript.
- `examples/llm-memory-db-pg/REPORT.md` (1, line 82) and `REPORT-PHASE-1.md` (1, line 83) — both already state the rule correctly ("`--json` ... must come AFTER the subcommand... does not [work]"), using the broken form only as the contrasted counter-example, same as `flags.md`.

**Files to fix** (18 files, 88 occurrences — moving `--json` from before to after the subcommand name, respecting pipes/redirects/command substitution):

`docs/index.md` (1), `docs/headless.md` (33), `skills/noorm/references/cli.md` (~25), `docs/guide/database/explore.md` (6), `docs/dev/headless.md` (5), `docs/guide/database/transfer.md` (2), `docs/guide/changes/history.md` (2), `docs/guide/changes/forward-revert.md` (2), `docs/dev/ci.md` (2), `docs/cli/identity.md` (2), `docs/guide/database/teardown.md` (1), `docs/guide/changes/overview.md` (1), `docs/guide/automation/ci.md` (1), `docs/guide/environments/secrets.md` (1), `docs/guide/environments/vault.md` (1), `docs/dev/transfer.md` (1), `docs/dev/secrets.md` (1), `docs/dev/sdk.md` (1).

`README.md` — already clean on this branch (0 occurrences; its Quick Start was trimmed to a 3-line headless example with no `--json` before this ticket). Verify only, no edit needed.

Transform rule: `noorm --json <rest>` → `noorm <rest> --json`, with `--json` landing just before a trailing `| jq ...` pipe or `2>&1` redirect if present, otherwise at the end of the invocation. Preserve any other flags/args verbatim (e.g. `noorm --json -c prod db explore` → `noorm -c prod db explore --json`; `noorm --json ${CONFIG:+-c "$CONFIG"} change | jq ...` → `noorm ${CONFIG:+-c "$CONFIG"} change --json | jq ...`).

### B — Keep the `NOORM_JSON` META_ENV_VARS registrations; do not delete them

The dispatching instructions named `src/core/config/index.ts:13` and `src/core/settings/manager.ts:38` as registrations to remove alongside `shouldOutputJson()`. Verification this session shows that would be wrong and would regress a passing test:

- `src/core/config/index.ts`'s `META_ENV_VARS` set (and the parallel `META_SETTINGS_ENV_VARS` in `settings/manager.ts`) exists to keep `NOORM_*` meta env vars out of `makeNestedConfig`'s config-object resolution — a purpose independent of whether anything currently *reads* `NOORM_JSON`.
- `getEnvConfig()` (`src/core/config/index.ts:65-85`) returns `allConfigs()` with no schema stripping of unknown keys (only a dialect-enum check). If `NOORM_JSON` is removed from `META_ENV_VARS`, setting `NOORM_JSON=1` in the environment would inject a spurious `json: '1'` field into the resolved config object.
- `tests/core/config/env.test.ts:246-258` ("should exclude meta env vars from config") explicitly asserts `config['json']` is `undefined` when `NOORM_JSON` is set — this test would fail if the registration were removed.

The audit's own prescription (VR-cli-05) only calls for deleting "the function, its test, and the NOORM_JSON documentation rows" — never the config/settings meta-var filters. **Decision: keep both registrations as-is.** The dead surface being deleted is `shouldOutputJson()` (the function nothing calls) and the doc rows that claim it works — not the defensive filter that happens to share the same string.


## Contract

### C1 — Delete `shouldOutputJson()`

- Remove `shouldOutputJson()` and its JSDoc from `src/core/environment.ts` (currently lines 132-143).
- Remove the `describe('shouldOutputJson', ...)` block from `tests/core/config/env.test.ts` (currently lines 496-519ish) and drop `shouldOutputJson` from the import at line 15.
- Leave the `NOORM_JSON` entries in `tests/core/config/env.test.ts`'s env-var backup lists (line ~44) and the "should exclude meta env vars from config" test (line ~246-258) untouched — `NOORM_JSON` is still a real meta var per Scope decision B.
- Leave `src/core/config/index.ts:13` and `src/core/settings/manager.ts:38` untouched per Scope decision B.

### C2 — Doc sweep

Fix all 88 occurrences across the 18 files listed in Scope decision A, per the transform rule. Leave the 5 exempt files (`docs/cli/flags.md`, `docs/guide/troubleshooting.md`, `examples/llm-memory-db-mssql/mssql-problems.md`, `examples/llm-memory-db-pg/REPORT.md`, `examples/llm-memory-db-pg/REPORT-PHASE-1.md`) untouched.

Additionally, remove the `NOORM_JSON` documentation *rows* (the ones claiming it forces JSON output — dead per C1) from:

- `docs/headless.md:130` (env var block) and `:145` (meta-variables table row)
- `docs/dev/config.md:115` (behavior-variables table row)
- `docs/guide/environments/configs.md:195` (behavior-variables table row)
- `skills/noorm/references/cli.md:74` (env var block)

These are distinct from the placement-sweep occurrences above — they're deletions, not moves. Do not remove `NOORM_YES`/`NOORM_CONFIG` neighbor rows in the same tables/blocks.

### C3 — Doc-lint guard

Add a grep-based guard script matching the repo's existing `scripts/*.sh` bash convention (see `scripts/install.sh`, `scripts/ralph-wiggum.sh` for style — `#!/bin/bash` or `#!/bin/sh`, header comment block, `set -e`).

- New file: `scripts/check-json-placement.sh`. Greps `README.md docs/ skills/ examples/` for the pattern `noorm --json ` (literal, trailing space), excluding the 5 exempt files from Scope decision A by path. Exit 1 and print offending `file:line` matches if any are found; exit 0 with a short confirmation otherwise.
- Wire it as a `package.json` script (e.g. `"lint:docs": "bash scripts/check-json-placement.sh"`).
- Wire it into `.github/workflows/docs.yml` (the docs-focused workflow, triggers on `docs/**`) as a step before the VitePress build — `docs.yml` doesn't currently gate on any check, this becomes its first one. Do not add it to `ci.yml` (that workflow doesn't trigger on `docs/**`/`skills/**` paths and this ticket doesn't extend its trigger paths).
- Prove it works: temporarily plant a bad-form line in a scratch/tracked file, run the script, confirm exit 1 with the planted line reported, then remove the plant. Record the before/after output in `TESTING.md`, not as a permanent test fixture.


## Out of scope

- Root-level `--json` interception (the `extractGlobalCwd`-style root flag pattern) — deferred post-v1 per the audit's Conflict 1 ruling. Adding it later only makes previously-ignored invocations work; no breaking change.
- Error-style/exit-code consistency work — ticket 26.
- `docs/spec/v1-02-yes-flag.md:121`'s mention of `NOORM_JSON` as "unowned" migration work — historical spec content for a different ticket; not touched.
- Re-doing any of ticket 02's `src/core/environment.ts` changes (`isEnvTruthy`, `shouldSkipConfirmations`) — this ticket's delta is additive on top of 02's HEAD.


## Checkpoint table

| # | Checkpoint | Done when |
|---|------------|-----------|
| CP1 | Dead surface deleted | `shouldOutputJson` gone from `src/core/environment.ts`; its test block gone from `tests/core/config/env.test.ts`; zero-caller proof re-confirmed post-edit (`rg -n 'shouldOutputJson'` returns nothing); `NOORM_JSON` META_ENV_VARS registrations in `config/index.ts`/`settings/manager.ts` intact (Scope decision B) |
| CP2 | Doc sweep clean | `rg -c 'noorm --json ' <each of the 18 files>` returns 0 for all; `rg 'noorm --json '` over `README.md docs/ skills/ examples/` returns exactly the 5 exempt files' pre-existing counts (9 total: 3+1+3+1+1) and nothing else |
| CP3 | NOORM_JSON doc rows removed | The 4 "forces JSON output" table/block rows (docs/headless.md ×2, docs/dev/config.md, docs/guide/environments/configs.md, skills/cli.md) gone; neighboring NOORM_YES/NOORM_CONFIG rows intact |
| CP4 | Doc-lint guard in place and proven | `scripts/check-json-placement.sh` exists, wired into `package.json` and `docs.yml`; plant-and-catch proof recorded in TESTING.md, plant removed from tracked files afterward |
| CP5 | Quality gates green | `bun run typecheck`, `bun run lint`, `bun run build` all pass at HEAD |


## Acceptance criteria (verbatim from ticket, with Scope-decision annotations)

- `rg 'noorm --json '` over README, docs/, skills/, examples/ returns 0 **— except the 5 files identified in Scope decision A as correctly documenting the gotcha via contrast/historical transcript (flags.md, troubleshooting.md, mssql-problems.md, REPORT.md, REPORT-PHASE-1.md); these keep their existing occurrences unchanged.**
- `NOORM_JSON`/`shouldOutputJson` gone from source and docs **— `shouldOutputJson` fully gone from source; `NOORM_JSON` gone from docs as a claimed working feature (C2), but the string remains in source only as an inert META_ENV_VARS/META_SETTINGS_ENV_VARS filter entry per Scope decision B (prevents config-object pollution; unrelated to the dead JSON-output-forcing behavior).**
- Doc-lint check in place.
