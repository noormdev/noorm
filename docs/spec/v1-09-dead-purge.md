# Spec: v1-09 — Purge dead deps, dead domain, stale files

Status: approved
Ticket: tickets/v1/09-purge-dead-deps-domain.md
Findings: AP-dead-01/-03/-05/-06, AP-yagni-01, QL-sec-03, QL-xrepo-02
Branch: v1/09-dead-purge

## Goal

Pure deletion, no behavior change. Five independently verified dead items removed; zero refactors, zero renames.

## TDD

Skipped because: deletion-only, no new behavior. The safety net is the existing suite staying green — typecheck + lint + build + the tui hook tests locally, all four CI test groups for full verification (see TESTING.md in the scratchpad).

## Checkpoints

| # | Deletion | Pre-deletion re-verification (must show zero real references) | Post-deletion proof |
|---|----------|----------------------------------------------------------------|---------------------|
| CP-1 | Remove 5 runtime deps from root `package.json` `dependencies`: `consola`, `ink-select-input`, `ink-spinner`, `ink-text-input`, `node-machine-id`. Then run plain `bun install` (NOT --frozen-lockfile) to regenerate `bun.lockb`. | `for d in consola ink-select-input ink-spinner ink-text-input node-machine-id; do rg -n -F "$d" --glob '!node_modules' --glob '!bun.lockb' .; done` — only hit per dep is its own `package.json` declaration line (61, 66-68, 71). VERIFIED 2026-07-12 by orchestrator. | Same `rg` — zero hits. `bun install` exits 0; `git status` shows `bun.lockb` modified. `bun run build` green. |
| CP-2 | Delete `src/hooks/` directory entirely (1 file, `observer.ts`). Remove the `src/hooks/` entry from the tui domain row in `docs/wiki/index.md:74`; remove the stale `src/hooks/observer.ts` bullet at `docs/wiki/tui.md:38` (AP-yagni-01 prescription covers both wiki files). | `rg -n -e useOnNoormEvent -e useNoormEventGenerator -e useOnceNoormEvent -e useEmitNoormEvent -e 'hooks/observer' --glob '!node_modules' .` — hits only inside `src/hooks/observer.ts` itself plus the two wiki pointers. VERIFIED 2026-07-12 by orchestrator (the `./hooks`/`../hooks` imports in `src/tui/` resolve to `src/tui/hooks/`, not `src/hooks/`). | `test ! -d src/hooks`; same `rg` — zero hits anywhere; `bun run typecheck` green. |
| CP-3 | Delete `scripts/install.sh`. Fix the stale pointer at `docs/wiki/infra.md:22` (remove the bullet — the live pair is root `install.sh` == `docs/public/install.sh`). | `rg -n -F 'scripts/install.sh' --glob '!node_modules' .` — only the file's own header comment and `docs/wiki/infra.md:22`. `diff install.sh docs/public/install.sh` — identical (live pair intact). VERIFIED 2026-07-12 by orchestrator. | `test ! -f scripts/install.sh`; same `rg` — zero hits; `diff install.sh docs/public/install.sh` still identical (untouched). |
| CP-4 | Delete `matchesPathPrefix` from `src/core/shared/files.ts:92` (function + its JSDoc) and its two barrel re-exports: `src/core/shared/index.ts:12` and `src/core/index.ts:100` (keep `filterFilesByPaths` on both lines — it is live, used by RunBuildScreen). | `rg -n matchesPathPrefix --glob '!node_modules' .` — exactly 3 hits: definition + 2 re-export lines. VERIFIED 2026-07-12 by orchestrator. | Same `rg` — zero hits; `bun run typecheck` and `bun run build` green. |
| CP-5 | Delete the `"start:init"` script from root `package.json:19`. | `rg -n -F 'start:init' --glob '!node_modules' .` — only `package.json:19` and the auto-generated inventory `docs/wiki/scan.md:1066` (not a real reference; scan.md is machine-regenerated — do NOT hand-edit it). VERIFIED 2026-07-12 by orchestrator. | `rg -n -F 'start:init' package.json` — zero hits. `bun run build` green. |

## Success criteria

- All five checkpoint post-deletion proofs hold.
- `bun run typecheck`, `bun run lint`, `bun run build` green in the worktree.
- `bun test --serial tests/cli/hooks` green (adjacent tui hook tests — proves the live `src/tui/hooks/` domain is untouched).
- `git diff` contains ONLY the listed deletions + the two wiki pointer fixes + `bun.lockb` regeneration. No incidental changes.

## Non-goals / scope boundary

- `voca` STAYS (ruling D7, 2026-07-11) — do not touch it or any other dependency.
- No refactors, no renames, no porting of `scripts/install.sh` features into the live installer.
- Do not hand-edit `docs/wiki/scan.md` (auto-generated inventory).
- Do not touch `src/tui/hooks/` (the live, canonical hooks domain).
- Full 4-group CI test run is deferred to CI / orchestrator finalize (integration group needs live DBs).

## Change log

- 2026-07-12: created. Inline spec per ticket (suggested verb: /subagent-implementation, spec-only). All five targets re-verified by orchestrator in fresh worktree before authoring; zero references gained since audit.
