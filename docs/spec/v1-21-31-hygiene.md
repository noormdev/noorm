# v1-21-31-hygiene

Spec-only (no design doc) -- mechanical repo/docs cleanliness plus a docs-only
release-engine note. No `src/` behavior changes.

Tickets: `research/v1-audit` (noorm realm) `tickets/v1/21-repo-docs-cleanliness.md`,
`tickets/v1/31-document-release-split.md`.

TDD: skipped because: docs/config/file-move only, guarded by the doc-lint
(none exists) + build. Verification is per-checkpoint grep/build commands,
not unit tests.


## Deviations from the ticket text (decided before implementation, with evidence)

1. **`.gitignore`'s `graphify-out/` line -- SKIPPED, not dropped.** The ticket
   text claims the directory "was deleted 2026-07-11." Verified false:
   `packages/sdk/graphify-out/` exists on disk today, was never git-tracked
   (`git log --all --name-only --diff-filter=A | grep graphify` empty per
   `research/v1-audit/v1-release/repo-hygiene.md`'s "Ruled out" section), and
   is legitimate local tool output correctly matched by the existing ignore
   rule. Dropping the line would make it resurface as untracked cruft in
   `git status`. Do not touch `.gitignore`.
2. **`postgres-problems.md` -- moved in-repo, not to the realm `raw/` bucket.**
   Two files have content-bearing relative links to it --
   `examples/llm-memory-db-pg/README.md:161` and `REPORT.md:6,65,71` -- which
   describe it as "the full external problem log" / "Phase 2, newly logged
   in postgres-problems.md." Moving it to `/Users/alonso/projects/noorm/raw/`
   (a separate git repo) would sever those relative links and require a
   second, unreviewed cross-repo commit. Instead: relocate it, preserving
   git history, to `examples/llm-memory-db-pg/postgres-problems.md` (its
   natural home per `research/v1-audit/v1-release/repo-hygiene.md`
   VR-hyg-03's own prescription), and update the two relative-path
   references. Stays in one repo, one worktree, preserves content.
3. **TODO.md -- collapse spans two H3 sections, not one.** The literally
   named "Headless CLI Gaps" section (current lines 18-46) is already 100%
   `[x]`. The one genuinely open item (`db dt-modify`) lives in the very
   next H3, "TUI Parity Gaps" (lines 48-114), whose own header framing
   ("Blocks CI/CD adoption for anything beyond change/run/vault workflows")
   is equally stale. `research/v1-audit/v1-release/docs-drift.md` VR-docs-06
   cites the item at TODO.md:98 and spans its own evidence range 22-114,
   i.e. treats both sections as one logical gap-tracking block. Collapse
   both into a single "Headless CLI Gaps" section retaining only the open
   item.
4. **Ignatius CLAUDE.md (ticket 31) -- deferred, not edited.** Ignatius is a
   separate git repo with no worktree isolation and no review loop inside
   this task. Recorded as a cross-repo follow-up in the implementation log
   with the exact paragraph text, rather than committing directly to
   another repo's main branch.


## Checkpoint table

| # | Item | Change | Verification |
|---|------|--------|--------------|
| 1 | docker-compose rename | Rename via git, preserving history: docker-compose.yml -> docker-compose.test.yml. Update the 6 "wrong-name" refs that say the bare `docker-compose.yml`: `docs/wiki/index.md:57` (text+link), `docs/wiki/index.md:77` (link in domain table), `docs/wiki/infra.md:30` (text+link), `docs/spec/config-access-roles.md:119` (prose filename), `examples/llm-memory-db-mssql/README.md:23` (prose filename) and `:25` (bare `docker compose up -d` becomes `docker compose -f docker-compose.test.yml up -d`, otherwise silently breaks post-rename since compose's default-filename resolution won't find `docker-compose.test.yml`). Leave `docs/wiki/scan.md` (auto-generated) and `docs/wiki/infra.md:54` (generic phrase, no filename) untouched. | `rg -n 'docker-compose\.(yml\|test\.yml)' --hidden -g '!node_modules' -g '!.git' -g '!dist'` shows only `docker-compose.test.yml`, excluding `docs/wiki/scan.md`. `docker compose -f docker-compose.test.yml config` parses clean (validates only, does not start containers). `.github/workflows/*.yml` confirmed to have zero compose references before this change (CI provisions DBs via GH Actions `services:` blocks) -- no CI files touched, none needed. |
| 2 | postgres-problems.md | Relocate via git, preserving history: postgres-problems.md -> examples/llm-memory-db-pg/postgres-problems.md. Update `examples/llm-memory-db-pg/README.md:161` (`../../postgres-problems.md` becomes `postgres-problems.md`) and `REPORT.md:6` (`../../postgres-problems.md` becomes `postgres-problems.md`). Lines 65/71 already reference it by bare filename -- no change needed there. | `git log --follow examples/llm-memory-db-pg/postgres-problems.md` shows history preserved. `rg -n 'postgres-problems' --hidden -g '!node_modules' -g '!.git'` shows no remaining `../../postgres-problems.md` path. |
| 3 | Root CNAME | Delete via git (tracked removal): CNAME. | `gh api repos/noormdev/noorm/pages` (already run) confirms source is `gh-pages` branch; `.github/workflows/docs.yml:42` writes its own `CNAME` into the deploy dir. `rg -n 'CNAME'` shows no remaining reader of the root copy besides auto-generated `docs/wiki/scan.md` (left for `/refresh-wiki`). |
| 4 | TODO.md gaps collapse | Replace TODO.md lines 18-114 (both "### Headless CLI Gaps" and "### TUI Parity Gaps" H3 sections) with a single collapsed section: heading "### Headless CLI Gaps", one line noting all commands are implemented except one, and the single open checklist item `- [ ] \`db dt-modify <path>\` - Modify a \`.dt\` file (currently only TUI \`DtModifyScreen\`)`. Drop the stale "40 handlers implemented" count. | `grep -c '\[ \]' TODO.md` in the collapsed section shows exactly 1 open item; `grep -n '40 handlers\|Missing commands' TODO.md` returns nothing. |
| 5 | docs/dev/README.md | Delete via git (tracked removal): docs/dev/README.md. | `grep -rn "dev/README" docs/.vitepress/config.mts` -- zero hits (already verified: only `index.md` wired as Overview). One known dangling auto-generated reference remains at `docs/wiki/worker-bridge.md:23` (signals content) -- intentionally left for the ticket's own required `/refresh-wiki` follow-up, not hand-edited. |
| 6 | CLAUDE.md pnpm claim | `monorepo/CLAUDE.md:51` -- replace "This is a pnpm monorepo with two publishable packages." with "This is a bun workspace monorepo with two publishable packages." (bun.lockb checked in; CI runs `bun install --frozen-lockfile`). | `grep -n 'pnpm monorepo' CLAUDE.md` -- zero hits. `grep -n 'bun workspace monorepo' CLAUDE.md` -- one hit. |
| 7 | docs/wiki/CLAUDE.md steering file | Replace the NestJS/pnpm/turbo sample content with real noorm hints: Bun workspace monorepo (not NestJS), citty CLI + Kysely SQL layer, domain grouping already correct in `docs/wiki/index.md`'s Domains table (no override needed -- remove the fabricated domain-override example), build = `bun run build`, test = `bun run test` (CI splits into 4 serial groups, see `.claude/rules` / `docs/wiki/index.md`). Keep the file's own frontmatter/steering-note preamble (that part is accurate structure, not sample content). | `grep -n 'NestJS\|src/billing\|pnpm turbo' docs/wiki/CLAUDE.md` -- zero hits. File still has valid `Steering` frontmatter. |
| 8 | `.gitignore` graphify-out | **No-op.** See Deviation #1. | `git diff .gitignore` empty. |
| 9 | Ticket 31 -- monorepo release engine | Extend the existing `## Changesets` section in `monorepo/CLAUDE.md` (currently lines 49-56) with one paragraph stating Changesets is the release engine and why it fits: fixed-version group over the two coupled publishable packages (`@noormdev/cli` + `@noormdev/sdk`) means every release bumps them together, appropriate for a two-package monorepo where the packages version in lockstep. | `grep -n 'Changesets' CLAUDE.md` shows the section now states both the engine and the reason (fixed-version group, two-package coupling) -- not just the frontmatter-naming rule that was already there. |
| 10 | Ticket 31 -- ignatius release engine | **Deferred, not edited in this task.** See Deviation #4. Record verbatim paragraph text in the implementation log / FOLLOWUPS.md for whoever applies it: "Ignatius releases via release-please (conventional-commit-derived changelog, single-package manifest) -- the right fit for a single-package repo, unlike monorepo's fixed-version group which exists specifically to keep two coupled packages in lockstep." | Recorded in `FOLLOWUPS.md` and the spec's Implementation log as a deferred cross-repo item -- not a file-diff checkpoint. |

## Out of scope

- Anything under `src/`, `tests/` behavior (only doc-string filename references in test files are touched, and only where the docker-compose rename requires it -- none of the 19 correctly-named test-file references need editing, they already say `docker-compose.test.yml`).
- `.gitignore` graphify-out line (see Deviation #1).
- Any of the other VR-hyg / VR-docs / QL-xrepo findings not named in ticket 21/31 (license, checksum verification, sourcemaps, dead `scripts/install.sh`, platform-detection duplication, etc.) -- separate tickets.
- Ignatius repo edit (see Deviation #4).


## Testing (centralized, run by orchestrator after PASS)

- `bun run typecheck`
- `bun run lint`
- `bun run build`
- `docker compose -f docker-compose.test.yml config` -- validates the renamed compose file parses; does not start containers.

No test groups, no integration, no `docker compose up`.


## Implementation log

### shipped -- 2026-07-12

Built across 2 iterations of /subagent-implementation. Commits (chronological):

- `f192a63` -- CP-1 through CP-7, CP-9: docker-compose rename + refs, postgres-problems.md relocation, CNAME deletion, TODO.md gaps collapse, docs/dev/README.md deletion, CLAUDE.md pnpm-to-bun fix, docs/wiki/CLAUDE.md steering content, CLAUDE.md Changesets release-engine paragraph (includes iteration 2's fix for the 2 stale "monorepo root" annotations, folded into the same commit since it landed before the first commit)
- `80398f5` -- deferred cross-repo follow-up (CP-10, ignatius) recorded durably

**Out-of-scope work performed during this build:**

- none

**Unforeseens -- surprises that emerged during implementation:**

- Task brief's premise for CP-8 (.gitignore graphify-out line, claimed deleted 2026-07-11) was verified false before implementation started -- the directory exists on disk today and was never git-tracked. Treated as a no-op per Deviation #1; flagged explicitly rather than silently dropped or silently followed.
- Task brief offered two disposal options for postgres-problems.md (realm raw/ bucket or delete); neither was taken. Two files (examples/llm-memory-db-pg/README.md, REPORT.md) had content-bearing relative links to it describing unique Phase 2 content not fully duplicated in REPORT.md's own summary -- moved in-repo instead, per Deviation #2, to preserve that content and the links without a cross-repo commit.
- examples/llm-memory-db-mssql/README.md:25 had a bare `docker compose up -d` (no -f flag) not named in the original ticket/research evidence lists -- found during pre-implementation grep sweep. Fixed as part of CP-1 since leaving it would silently break post-rename (compose's default-filename resolution).
- TODO.md's "one still-open item" (db dt-modify) actually lives in the "TUI Parity Gaps" H3, not literally inside "Headless CLI Gaps" as ticket 21's text implies -- both sections collapsed together per Deviation #3.

**Deferred items still open:**

- `.claude/project/followups/v1-21-31-hygiene-f2.md` -- ignatius CLAUDE.md release-engine paragraph (ticket 31, cross-repo, not applied). Verbatim paragraph text recorded in the followup entry.
