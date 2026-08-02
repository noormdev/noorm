---
type: Domain
description: Build pipeline, CI, npm/binary release, example fixtures, and the VitePress docs site.
---

# infra

## What it does

Builds and publishes the two workspace packages (`@noormdev/cli`, `@noormdev/sdk`) via tsup and Changesets, produces standalone binaries via `bun build --compile`, runs GitHub Actions CI across three dialects plus example-project smoke tests, and builds/deploys the VitePress docs site at noorm.dev. Also holds the three example projects and the VHS tape sources that record the docs site's terminal GIFs/screenshots.

## Artifacts

- [`examples/todo-db/`](../../examples/todo-db) — Postgres reference project (soft-deletes, JSONB, TVFs, transactional SPs); depends on `@noormdev/sdk`, `kysely`, `pg`; driven end-to-end by the `example-todo-db` CI job
- [`examples/llm-memory-db-mssql/`](../../examples/llm-memory-db-mssql) — MSSQL example exercising table-valued parameters and schema-bound validator UDFs; depends on `@noormdev/sdk`, `kysely`, `tedious`, `tarn`, `zod`; driven end-to-end by the `example-llm-memory-db-mssql` CI job
- [`examples/llm-memory-db-pg/`](../../examples/llm-memory-db-pg) — Postgres LLM-memory-DB example; depends on `@noormdev/sdk`, `kysely`, `pg`, `zod`; has no corresponding CI job in [`.github/workflows/ci.yml`](../../.github/workflows/ci.yml)
- [`docs/tapes/demo-project/`](../tapes/demo-project) — throwaway 4-file schema (`app_user`, `project`, `task`, an `open_task` view, two changes) used only to record the docs site's GIFs/screenshots, not by CI or by the other examples

## CLI code

- [`scripts/build.mjs`](../../scripts/build.mjs) — zx script; runs tsup against [`tsup.cli.config.ts`](../../tsup.cli.config.ts) then [`tsup.sdk.config.ts`](../../tsup.sdk.config.ts), prepends a `#!/usr/bin/env node` shebang to the CLI bundle, then generates `packages/sdk/dist/index.d.ts` via `dts-bundle-generator`
- [`scripts/build-binary.mjs`](../../scripts/build-binary.mjs) — `bun build --compile` for 5 targets (darwin-arm64/x64, linux-x64/arm64, windows-x64) into `packages/cli/bin/noorm-<suffix>`; each build embeds [`src/cli/index.ts`](../../src/cli/index.ts) plus both worker entry points and injects `__CLI_VERSION__`
- [`scripts/check-flag-placement.sh`](../../scripts/check-flag-placement.sh) — the `lint:docs` script; greps [`README.md`](../../README.md), [`docs`](..), [`skills`](../../skills), [`examples`](../../examples) for the broken "flag before the subcommand" form, exempting a fixed list of files that intentionally show it as a documented contrast
- [`scripts/Dockerfile`](../../scripts/Dockerfile) / [`scripts/ralph-wiggum.sh`](../../scripts/ralph-wiggum.sh) — sandboxed Docker image (Node 24 + Claude Code) and a loop-until-`<promise>DONE</promise>` runner script; not referenced by any CI, build, or release workflow
- [`tsup.cli.config.ts`](../../tsup.cli.config.ts) — bundles [`src/cli/index.ts`](../../src/cli/index.ts) to `packages/cli/dist`, ESM, `node22` target, `noExternal: [/.*/]` except `better-sqlite3`, `bun:sqlite`, `pg-native`, `react-devtools-core`
- [`tsup.sdk.config.ts`](../../tsup.sdk.config.ts) — bundles [`src/sdk/index.ts`](../../src/sdk/index.ts) to `packages/sdk/dist`, sourcemaps on, treeshake on, externalizes `kysely` and the DB drivers (`pg`, `mysql2`, `tedious`, `tarn`, `better-sqlite3`, `bun:sqlite`) as peer deps, aliases `ansis` to a stub (SDK doesn't need terminal colors)
- [`docker-compose.test.yml`](../../docker-compose.test.yml) — local test DB services on non-default ports: Postgres 17 (15432), MySQL 8.0 (13306), MSSQL 2022 (11433); postgres and mysql are `tmpfs`-backed, mssql is not
- [`bunfig.toml`](../../bunfig.toml) — `bun test` config: `preload = ["./tests/preload.ts"]`, 30s timeout, `root = "./tests"`, `concurrency = 1`

## Docs

- [`docs/index.md`](../index.md) — VitePress home page: hero, feature grid (links to `/guide/relational-design`, `/reference/sdk`, `/guide/database/transfer`, `/guide/automation/mcp`, `/headless`), quick-start snippet
- [`docs/.vitepress/config.mts`](../.vitepress/config.mts) — site config; `srcExclude: ['wiki/**', 'spec/**', 'design/**', 'superpowers/**', 'tmp/**', 'tapes/**']` because those directories' prose (e.g. [`docs/wiki`](.)'s `<steering note: ...>` blocks) breaks VitePress's Vue-SFC markdown compiler; defines nav/sidebar, OG/Twitter meta, and a Google Analytics tag
- [`docs/.vitepress/theme/`](../.vitepress/theme) — theme extending VitePress `DefaultTheme` with `HeroEyebrow.vue`, `HeroTerminal.vue`, `HeroStats.vue`, and `brand.css`
- [`docs/dev/`](../dev) — ~24 contributor-facing architecture pages, one per core module/feature, indexed from [`docs/dev/index.md`](../dev/index.md); served under a separate `/dev/` sidebar
- `docs/guide/{sql-files,environments,changes,database,automation}/` — user-guide pages, several per subtopic
- [`docs/guide/relational-design.md`](../guide/relational-design.md) — guide page arguing for inherited compound keys and basetype-subtype tables over ORM-style surrogate IDs and polymorphic associations, using a `user → todo → todo_item` compound-key example; linked from the homepage feature grid and the main sidebar's Features group
- [`docs/guide/deployment.md`](../guide/deployment.md) — deployment guide
- [`docs/modeling/`](../modeling) — 8 pages documenting [ignatius](https://github.com/noormdev/ignatius), a separate information-modeling tool in a separate repo (not part of this monorepo's [`src/`](../../src)); noorm's own docs site hosts its documentation (`index.md`, `installation.md`, `entities.md`, `data-flows.md`, `best-practices.md`, `branding.md`, `reverse-engineering.md`, `modeling-skill.md`). [`docs/public/video/ignatius.mp4`](../public/video/ignatius.mp4)/`ignatius-poster.jpg` are ignatius demo assets referenced from [`docs/modeling/index.md`](../modeling/index.md).
- [`docs/why-noorm.md`](../why-noorm.md) — origin-story page: noorm is the fifth CLI-interface attempt (minimist → cmd-ts → oclif → citty/@clack/prompts), with Ink added afterward for the TUI split between interactive (TUI) and automatable (CLI/headless) surfaces
- [`docs/cli/`](../cli) — 10 CLI reference pages (`flags`, `help`, `identity`, `init`, `run`, `secret`, `settings-edit`, `settings-secret`, `sql-repl`, `sql`)
- [`docs/getting-started/`](../getting-started) — `installation`, `first-build`, `concepts`, `building-your-sdk`
- [`docs/reference/sdk.md`](../reference/sdk.md) — SDK API reference (`createContext`, `ctx.kysely`, `ctx.noorm` namespace)
- [`docs/spec/`](../spec), [`docs/design/`](../design) — checkpoint specs and design docs for specific features (e.g. `config-access-roles.md`, `v1-49-54-cli-field-defects.md`); excluded from the built site
- [`docs/tapes/`](../tapes) — VHS tape sources (`01-install.tape`, `02-build-and-change.tape`, `03-tui.tape`, `04-screenshots.tape`, `theme.tape`) plus shell helpers `env-scrub.sh`, `sandbox.sh`, `shots.sh` and a [`README.md`](../../README.md); renders the GIFs/PNGs under [`docs/public/image/`](../public/image); excluded from the built site via `srcExclude`
- [`docs/public/install.sh`](../public/install.sh) — the installer served at `https://noorm.dev/install.sh`
- [`docs/wiki/`](.) — this wiki; excluded from the built VitePress site for the reason noted in `config.mts`

## Coupling

- CI ([`.github/workflows/ci.yml`](../../.github/workflows/ci.yml)) triggers only on `src/**`, `tests/**`, `packages/**`, `examples/**`, [`bun.lockb`](../../bun.lockb), `tsconfig*.json`, and the workflow file itself — a [`docs/`](..)-only change never runs `ci.yml`
- [`.github/workflows/docs.yml`](../../.github/workflows/docs.yml) triggers only on `docs/**` (push to `master` only, no `pull_request`); its own "Check `--json` doc placement" step still runs `bun run lint:docs` ([`scripts/check-flag-placement.sh`](../../scripts/check-flag-placement.sh)), so a docs-only change can fail that check even though `ci.yml` never runs
- `docs.yml` deploys `docs/.vitepress/dist` to the `gh-pages` branch and writes a `noorm.dev` [`CNAME`](../../CNAME) file into it at deploy time (separate from the root-level [`CNAME`](../../CNAME) file, which is `noorm.dev` as well)
- [`.github/workflows/publish.yml`](../../.github/workflows/publish.yml) triggers on `.changeset/**` and `packages/*/package.json`; a successful `@noormdev/cli` publish additionally triggers its `build-binaries` job, which runs the same `bun run build:binary` as [`.github/workflows/release-binary.yml`](../../.github/workflows/release-binary.yml) (that workflow is otherwise manual-only, `workflow_dispatch`)
- [`scripts/build-binary.mjs`](../../scripts/build-binary.mjs) must list every worker entry point explicitly ([`src/workers/connection.ts`](../../src/workers/connection.ts), [`src/workers/compute.ts`](../../src/workers/compute.ts)) — adding a worker in the worker-bridge domain requires updating this list too
- [`examples/todo-db`](../../examples/todo-db) and [`examples/llm-memory-db-mssql`](../../examples/llm-memory-db-mssql) depend on `@noormdev/sdk` and the CLI bundle built by `bun run build:packages` — they act as CI integration/smoke tests for the sdk and cli domains, not just as documentation fixtures
- [`.changeset/config.json`](../../.changeset/config.json) (triggers `publish.yml`) fixes `@noormdev/cli` and `@noormdev/sdk` in one version group — [`packages/cli/package.json`](../../packages/cli/package.json) and [`packages/sdk/package.json`](../../packages/sdk/package.json) always bump together
- root [`package.json`](../../package.json)'s `workspaces` field (`packages/*`, `examples/*`) is what makes the three [`examples/`](../../examples) directories resolve `@noormdev/sdk` as a workspace link rather than a published version
- [`docs/tapes/`](../tapes) tapes run against `dist/cli/index.js` (the `bun run build`/tsc output, not the tsup bundle) and a live Postgres from [`docker-compose.test.yml`](../../docker-compose.test.yml) — recording requires both the core build and the docker-compose services to be current

## Conventions worth knowing

- Bun is pinned to `1.3.11` identically across `ci.yml`, `publish.yml`, and `release-binary.yml`'s `oven-sh/setup-bun` steps
- `ci.yml`'s `build` job runs `bun run test` as 5 separate `bun test --serial` invocations, not one unified run: (1) [`tests/utils`](../../tests/utils)+[`tests/core`](../../tests/core) (excl. [`tests/core/transfer`](../../tests/core/transfer))+[`tests/sdk`](../../tests/sdk), (2) [`tests/core/transfer`](../../tests/core/transfer) alone, (3) [`tests/cli`](../../tests/cli) (excl. `cli-logger-settings.test.ts`), (4) [`tests/cli/cli-logger-settings.test.ts`](../../tests/cli/cli-logger-settings.test.ts) alone, (5) [`tests/integration`](../../tests/integration). Groups (1)/(2) split per a comment citing a GitHub Actions runner-image regression (`ubuntu24/20260406.80`) causing PG connection-state corruption when run together; groups (3)/(4) split because Bun's `mock.module` registry is process-global and never restores
- CI jobs besides `build`: `example-todo-db`, `example-llm-memory-db-mssql`, and `cli-e2e` (sqlite-only fixture asserting headless exit codes: 0 for a clean build, 3 for a partial build with one parse-error file — exit code 2 is reserved for usage errors)
- `example-*` CI jobs mint an ephemeral identity via `noorm ci identity new --json`, mask the private key with `::add-mask::`, then bootstrap state via `noorm ci init --force --json` — no committed identity or `state.enc` is involved
- `NOORM_TEST_PREBUILT=1` tells an example's SDK test harness to skip its own local bootstrap and connect directly against the database state the preceding CLI steps already produced
- the `example-llm-memory-db-mssql` job runs `noorm run build` instead of `noorm db reset`, because schema-bound validator UDFs in that project lock the tables they reference and block teardown (documented in [`examples/llm-memory-db-mssql/mssql-problems.md`](../../examples/llm-memory-db-mssql/mssql-problems.md))
- [`docs/.vitepress/config.mts`](../.vitepress/config.mts) sets `markdown.image.lazyLoading: true` because the recorded GIFs (`tui.gif` alone is ~1.6 MB) are the heaviest assets on the site and none sit above the fold
- [`docs/tapes/theme.tape`](../tapes/theme.tape) defines the shared VHS look (Geist Mono font, brand palette, `PlaybackSpeed 2`) and is `Source`d by every other tape; [`docs/tapes/env-scrub.sh`](../tapes/env-scrub.sh) strips coding-agent env vars (`CLAUDE*`, `AI_AGENT`, `CURSOR*`, `AIDER*`, `COPILOT*`, `WARP*`, `TERM_PROGRAM*`) before recording so `noorm info` doesn't leak the recording operator's tooling into a published GIF
- [`docs/tapes/sandbox.sh`](../tapes/sandbox.sh) builds an isolated project under `/tmp/noorm-demo` (redirected `HOME`, deliberately short path) and always drops the `noorm_demo` Postgres database before each tape run, but only recreates it when `MODE != "project"` — in `project` mode it's left absent so the TUI walkthrough creates it on camera; it refuses to `rm -rf` any `DEMO_ROOT` not under `/tmp` or `$TMPDIR`
- [`docs/tapes/shots.sh`](../tapes/shots.sh) renders `04-screenshots.tape` at one tall canvas (sized for the tallest TUI screen) then crops each PNG back to its own content with ImageMagick before writing it to [`docs/public/image/tui/`](../public/image/tui)
