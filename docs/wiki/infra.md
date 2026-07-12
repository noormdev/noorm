---
type: Domain
---

# infra

## What it does

Build pipeline, CI, binary release, package publishing, and reference examples. The monorepo root orchestrates two publishable packages (`@noormdev/cli`, `@noormdev/sdk`) and three examples. CI runs four isolated test groups. Binary release produces a standalone `noorm` executable via `bun build --compile`.

## Artifacts

- [`examples/llm-memory-db-pg/`](../../examples/llm-memory-db-pg) — PostgreSQL LLM memory DB example with SDK, CLI, and MCP coverage
- [`examples/llm-memory-db-mssql/`](../../examples/llm-memory-db-mssql) — MSSQL equivalent with TVP patterns
- [`examples/todo-db/`](../../examples/todo-db) — reference CI target: soft-deletes, JSONB, TVFs, transactional SPs; used as CI stress test

## CLI code

- [`scripts/build.mjs`](../../scripts/build.mjs) — builds both `@noormdev/cli` and `@noormdev/sdk` packages via tsup
- [`scripts/build-binary.mjs`](../../scripts/build-binary.mjs) — `bun build --compile` to produce standalone binary
- [`scripts/Dockerfile`](../../scripts/Dockerfile) — Docker image for binary builds
- [`scripts/install.sh`](../../scripts/install.sh) — shell installer for binary distribution
- [`scripts/ralph-wiggum.sh`](../../scripts/ralph-wiggum.sh) — release automation helper
- [`tsup.cli.config.ts`](../../tsup.cli.config.ts) — tsup config for CLI package build
- [`tsup.sdk.config.ts`](../../tsup.sdk.config.ts) — tsup config for SDK package build
- [`tsconfig.json`](../../tsconfig.json) — root TypeScript config
- [`tsconfig.sdk-types.json`](../../tsconfig.sdk-types.json) — SDK type extraction config
- [`tsconfig.test.json`](../../tsconfig.test.json) — test TypeScript config
- [`bunfig.toml`](../../bunfig.toml) — Bun runtime config
- [`docker-compose.test.yml`](../../docker-compose.test.yml) — local dev databases: PostgreSQL (15432), MySQL (13306), MSSQL (11433)

## Docs

- [`.github/workflows/ci.yml`](../../.github/workflows/ci.yml) — CI: lint → typecheck → build → 4 test groups → 3 example jobs (445L)
- [`.github/workflows/publish.yml`](../../.github/workflows/publish.yml) — changesets-driven publish to npm
- [`.github/workflows/release-binary.yml`](../../.github/workflows/release-binary.yml) — binary release to GitHub Releases
- [`.github/workflows/docs.yml`](../../.github/workflows/docs.yml) — VitePress docs deployment
- [`docs/getting-started/installation.md`](../getting-started/installation.md) — install instructions
- [`docs/.vitepress/config.mts`](../.vitepress/config.mts) — VitePress site config (192L)

## Coupling

- Binary build (`build-binary.mjs`) must list all worker entry points explicitly — worker-bridge domain path conventions must be stable.
- CI test split (4 groups) is a workaround for `mock.module` cross-contamination + runner image regression — see CLAUDE.md for the known contamination source.
- Examples use `@noormdev/sdk` and CLI — they serve as integration smoke tests in CI.
- Changeset config ([`.changeset/config.json`](../../.changeset/config.json)) references `@noormdev/cli` and `@noormdev/sdk` — only these two are publishable.
- [`packages/cli/package.json`](../../packages/cli/package.json) and [`packages/sdk/package.json`](../../packages/sdk/package.json) carry the published versions and peer deps.

## Conventions worth knowing

- CI services: Postgres 17 on port 15432, MySQL 8.0 on port 13306, MSSQL 2022 on port 11433.
- CI runs on `ubuntu-24.04`.
- Test split: (1) utils+core(no transfer)+sdk, (2) core/transfer, (3) cli, (4) integration. All use `--serial`.
- Integration tests need live DB services — not runnable locally without `docker-compose up`.
- Examples run as separate CI jobs (`example-todo-db`, `example-llm-memory-db-pg`, `example-llm-memory-db-mssql`).
- `NOORM_TEST_PREBUILT=1` tells example test harness to skip local bootstrap and use CLI-generated DB state.
- Bun pinned to `1.3.11` in CI (see [`.github/workflows/ci.yml`](../../.github/workflows/ci.yml)); local dev uses `>=1.2`.
- `@noormdev/main` (root [`package.json`](../../package.json)) is private and not published.
