---
type: Domain
reflects_rev: 69dcabdd38674a56e9b4782d96c5cd379843dea2
description: Package builds, CI, npm and binary distribution, example fixtures, and the VitePress docs site.
tags: [core, cli]
---

# infra

## What it does

Infrastructure turns the repository into installable CLI and SDK packages, standalone executables, and the noorm.dev documentation site. Work here when changing distribution, release automation, CI isolation, example smoke coverage, or documentation publishing.

`bun run build` compiles the development tree with TypeScript. `bun run build:packages` creates the npm artifacts; `bun run build:binary` creates standalone executables. These commands have different output and runtime boundaries.

## How it works

`build:packages` bundles the CLI before the SDK, then generates the SDK declarations independently of tsup.

```mermaid
flowchart TD
    %% source: package.json, scripts/build.mjs, tsup.cli.config.ts, tsup.sdk.config.ts
    B["scripts/build.mjs"] --> C["tsup.cli.config.ts"]
    C --> S["writeFile(cliBundlePath)"]
    S --> K["tsup.sdk.config.ts"]
    K --> T["dts-bundle-generator"]
    C --> CO["packages/cli/dist"]
    K --> KO["packages/sdk/dist"]
    T --> D["packages/sdk/dist/<br/>index.d.ts, index.d.cts"]
```

The CLI bundle targets Node 22, uses ESM, injects the CLI package version, and bundles JavaScript dependencies. Native or runtime-specific modules (`better-sqlite3`, `bun:sqlite`, `pg-native`) and optional `react-devtools-core` remain external.

### SDK installation boundary

The SDK's CommonJS entry and generated ESM facade load one canonical runtime, so both forms share constructors, error classes, and `noormObserver`.

```mermaid
flowchart TD
    %% source: tsup.sdk.config.ts, packages/sdk/package.json, package.json
    P["@noormdev/sdk"] --> E{"exports"}
    E -->|import types| T["dist/index.d.ts"]
    E -->|require types| CT["dist/index.d.cts"]
    T --> CT
    E -->|import| F["dist/index.js"]
    E -->|require or default| R["dist/index.cjs"]
    F --> R
    R -->|bundled| B["tarn"]
    R -->|external| K["kysely"]
    R -->|external| D["pg, mysql2, tedious<br/>better-sqlite3<br/>bun:sqlite"]
```

[`tsup.sdk.config.ts`](../../tsup.sdk.config.ts) bundles internal dependencies, including Tarn for MySQL and MSSQL pools, enables sourcemaps and tree-shaking, and aliases `ansis` to the SDK color stub. Its external list contains `kysely`, `pg`, `mysql2`, `tedious`, `better-sqlite3`, and `bun:sqlite`. The manifest requires Kysely and marks the installable dialect drivers as optional peers. Consumers install the driver for their database; Tarn is not a consumer peer. Published package contents include `dist` and [`NOTICE`](../../NOTICE), with sourcemaps excluded.

The manifest requires Node `>=22.13`. CommonJS consumers load the `.cjs` runtime directly; ESM consumers load its generated named-export facade. Driver wrappers defer `require()` until their lazy dialect initializers run; nonliteral template file-URL imports retain native ESM loading. The facade is generated from the bundle's exports on every SDK build, including direct tsup invocation.

Declarations share the same boundary: `index.d.cts` holds the canonical types, and `index.d.ts` re-exports `./index.cjs`. Mixed CommonJS type imports and dynamic ESM imports therefore refer to the same private members in `Context` and its namespaces.

### CI execution boundary

The example and CLI smoke jobs depend on `build`; they exercise different artifacts rather than sharing its development output.

```mermaid
flowchart TD
    %% source: .github/workflows/ci.yml
    B["build"] --> T["example-todo-db"]
    B --> M["example-llm-memory-db-<br/>mssql"]
    B --> C["cli-e2e"]
    T --> P["bun run build:packages"]
    M --> P
    C --> D["bun run build"]
```

The `build` job provisions PostgreSQL 17, MySQL 8.0, and SQL Server 2022, installs dependencies with the frozen lockfile, and runs lint, type checking, and the TypeScript build. It invokes serial tests in separate processes for core/utils/SDK excluding transfer, transfer alone, CLI excluding logger settings, logger settings alone, and integration. This separation preserves the workflow's test isolation around Bun's process-global module mocks.

The workflow records separate reasons for isolation: transfer tests exposed PostgreSQL connection-state corruption with runner image `ubuntu24/20260406.80`, while logger-settings tests encounter init-screen `SettingsManager` mocks that Bun does not restore. Re-registering a module in `afterAll` is not reliable isolation; platform-dependent load order can hide the leaked class locally.

| CI test process | Invocation |
|---|---|
| Core, utils, and SDK excluding transfer | `bun test --serial $(find tests/utils tests/core tests/sdk -name '*.test.ts' \| grep -v tests/core/transfer \| sort \| tr '\n' ' ')` |
| Transfer | `bun test --serial tests/core/transfer` |
| CLI excluding logger settings | `bun test --serial $(find tests/cli \( -name '*.test.ts' -o -name '*.test.tsx' \) ! -name 'cli-logger-settings.test.ts' \| sort \| tr '\n' ' ')` |
| CLI logger settings | `bun test --serial tests/cli/cli-logger-settings.test.ts` |
| Integration | `bun test --serial tests/integration` |

CI uses `ubuntu-24.04` for the build job. CI, documentation, publishing, and manual binary workflows pin Bun `1.4.4`. Local Bun tests preload [`tests/preload.ts`](../../tests/preload.ts), use a `30,000 ms` timeout and [`tests`](../../tests) root, and set concurrency to `1` in [`bunfig.toml`](../../bunfig.toml).

| Database service | Host port | Local storage |
|---|---|---|
| PostgreSQL 17 | `15432` | `tmpfs` |
| MySQL 8.0 | `13306` | `tmpfs` |
| MSSQL 2022 | `11433` | Not `tmpfs` |

The non-default ports match CI services and avoid collisions with ordinary local installations. Local startup uses `docker compose -f docker-compose.test.yml up -d --wait`.

Example jobs build packages, expose the CLI bundle through a Node wrapper, mint an ephemeral identity, mask its private key, and initialize encrypted state from environment variables. The PostgreSQL todo example creates and resets its database, applies changes, and runs SDK tests with `NOORM_TEST_PREBUILT=1`. The MSSQL example uses `run build` instead of teardown, applies changes, typechecks, and runs its tests. Its schema-bound validators prevent the reset pattern used by the todo job. `cli-e2e` uses SQLite fixtures and asserts success or partial-build exit behavior.

| Example | Coverage and dependencies |
|---|---|
| [`examples/todo-db`](../../examples/todo-db) | PostgreSQL soft deletes, JSONB, TVFs, and transactional procedures; depends on the workspace SDK, Kysely, and `pg`. |
| [`examples/llm-memory-db-mssql`](../../examples/llm-memory-db-mssql) | MSSQL TVPs and schema-bound validator functions; depends on the workspace SDK, Kysely, `tedious`, Tarn, and Zod. |
| [`examples/llm-memory-db-pg`](../../examples/llm-memory-db-pg) | PostgreSQL memory/task schema and SDK tests; depends on the workspace SDK, Kysely, `pg`, and Zod. It has no corresponding CI example job. |

`NOORM_TEST_PREBUILT=1` tells example SDK tests to use the database state prepared by preceding CLI steps instead of bootstrapping it again. The MSSQL teardown limitation is documented in [`examples/llm-memory-db-mssql/mssql-problems.md`](../../examples/llm-memory-db-mssql/mssql-problems.md).

The example jobs run `noorm ci identity new --json`, mask the resulting private key with `::add-mask::`, and run `noorm ci init --force --json`. No committed identity or encrypted state file is needed.

### npm and binary distribution

A published CLI package enables the release workflow's binary build and upload job.

```mermaid
flowchart TD
    %% source: .github/workflows/publish.yml, scripts/build-binary.mjs, .changeset/config.json
    R[".github/workflows/<br/>publish.yml"] --> P["changesets/action@v1"]
    P --> N["@noormdev/cli<br/>@noormdev/sdk"]
    P --> Q{"publishedPackages<br/>@noormdev/cli?"}
    Q -->|yes| B["build-binaries"]
    B --> A["scripts/smoke-alpine.sh"]
    A --> C["packages/cli/bin/<br/>checksums.txt"]
    C --> U["softprops/<br/>action-gh-release@v2"]
```

Changesets keeps CLI and SDK versions in a fixed group. The binary builder embeds the Bun runtime, the CLI entry, and the connection and compute worker entries. Targets cover macOS ARM64/x64, Linux ARM64/x64 with glibc or musl, and Windows x64. It reads the CLI package version and disables compiled dotenv autoloading. Release automation smoke-tests Alpine binaries and uploads executables with SHA-256 checksums.

Publishing selects pushes to `master` touching `.changeset/**`, `packages/*/package.json`, or the publish workflow, and supports manual dispatch. The separate `release-binary.yml` is manual-only and runs the same `bun run build:binary`. Both derive the release tag `@noormdev/cli@<version>` from [`packages/cli/package.json`](../../packages/cli/package.json).

### Documentation deployment

The docs workflow builds a separate VitePress package and publishes its output to `gh-pages`.

```mermaid
flowchart TD
    %% source: .github/workflows/docs.yml, docs/package.json, docs/.vitepress/config.mts
    W[".github/workflows/<br/>docs.yml"] --> I["bun install<br/>--frozen-lockfile"]
    I --> DI["cd docs && bun install<br/>--frozen-lockfile"]
    DI --> L["bun run lint:docs"]
    L --> V["vitepress build"]
    V --> D["docs/.vitepress/dist"]
    D --> G["gh-pages<br/>CNAME: noorm.dev"]
```

VitePress excludes wiki, spec, design, superpowers, tmp, tapes, models, and parts sources from page compilation. The theme extends `DefaultTheme`, registers Font Awesome and `ModelViewer`, and loads brand and landing CSS. It delays Mermaid rendering until the Geist font-loading wait completes. Images use lazy loading.

`config.mts` owns the navigation/sidebar, static Open Graph/Twitter metadata, and analytics setup. Contributor pages use a separate `/dev/` sidebar and footer link. The home page lives in [`docs/index.md`](../index.md); historical Hero Vue components are not part of the current theme.

### Recording fixtures

`vhs 01-install.tape` runs the sandbox before recording the public installer and writes [`docs/public/image/install.gif`](../public/image/install.gif). The sandbox requires the development CLI and a live PostgreSQL service, independently of package publishing.

```mermaid
flowchart TD
    %% source: docs/tapes/README.md, docs/tapes/01-install.tape, docs/tapes/sandbox.sh
    V["vhs 01-install.tape"] --> T["docs/tapes/<br/>01-install.tape"]
    T -->|invokes fresh| S["docs/tapes/sandbox.sh"]
    S -->|requires| C["dist/cli/index.js"]
    S -->|copies schema| D["docs/tapes/demo-project<br/>examples/todo-db"]
    S -->|resets database| P["noorm-test-postgres"]
    T --> I["curl -fsSL<br/>https://noorm.dev/<br/>install.sh | sh"]
    T --> O["docs/public/image/<br/>install.gif"]
```

The sandbox redirects `HOME`, recreates isolated project state, and normally provides a wrapper for the working-tree CLI. The install tape instead runs the public installer inside the sandbox. The default schema comes from [`docs/tapes/demo-project`](../tapes/demo-project); `NOORM_DEMO_SCHEMA=todo-db` selects the todo example.

| Recording source | Operational detail |
|---|---|
| [`docs/tapes/demo-project`](../tapes/demo-project) | Recording-only `app_user`, `project`, `task`, and `open_task` schema with tracked changes, separate from executable CI examples. |
| [`docs/tapes/theme.tape`](../tapes/theme.tape) | Shared Geist Mono, brand palette, and `PlaybackSpeed 2`. Install Geist Mono explicitly; VHS otherwise falls back to a wider font and changes wrapping. Playback speed does not shorten the recording's actual waits. |
| [`docs/tapes/env-scrub.sh`](../tapes/env-scrub.sh) | Removes `CLAUDE*`, `AI_AGENT`, `CURSOR*`, `AIDER*`, `COPILOT*`, `WARP*`, and `TERM_PROGRAM*` before recording so `noorm info` does not publish the operator's agent environment. |
| [`docs/tapes/shots.sh`](../tapes/shots.sh), [`docs/tapes/04-screenshots.tape`](../tapes/04-screenshots.tape) | Renders stills and trims/pads them with ImageMagick into [`docs/public/image/tui`](../public/image/tui). The alternate-screen TUI fills the canvas vertically, so trimming cannot recover excess canvas height. |
| [`docs/tapes/README.md`](../tapes/README.md) | Recording prerequisites, tape commands, and output locations for install, build/change, TUI, screenshots, and row recordings. |

## Where it lives

| Path | Role |
|---|---|
| [`package.json`](../../package.json) | Workspace layout and development, package, binary, and release commands. |
| [`scripts/build.mjs`](../../scripts/build.mjs), [`tsup.cli.config.ts`](../../tsup.cli.config.ts), [`tsup.sdk.config.ts`](../../tsup.sdk.config.ts) | npm bundles, shebang, externals, and bundled SDK declarations. |
| [`packages/sdk/package.json`](../../packages/sdk/package.json) | SDK distribution manifest and consumer peer boundary, owned by the SDK domain. |
| [`scripts/build-binary.mjs`](../../scripts/build-binary.mjs), [`scripts/smoke-alpine.sh`](../../scripts/smoke-alpine.sh) | Compiled target selection and Alpine runtime smoke coverage. |
| [`.changeset/config.json`](../../.changeset/config.json), [`.github/workflows/publish.yml`](../../.github/workflows/publish.yml), [`.github/workflows/release-binary.yml`](../../.github/workflows/release-binary.yml) | Version grouping, npm publication, and binary release automation. |
| [`.github/workflows/ci.yml`](../../.github/workflows/ci.yml), [`docker-compose.test.yml`](../../docker-compose.test.yml), [`bunfig.toml`](../../bunfig.toml) | CI jobs, local database services, and Bun test configuration. |
| [`tests/integration/connection/mysql-packed-sdk.test.ts`](../../tests/integration/connection/mysql-packed-sdk.test.ts) | Isolated installed-consumer coverage for the packed SDK. |
| [`tests/integration/connection/postgres-packed-sdk.test.ts`](../../tests/integration/connection/postgres-packed-sdk.test.ts) | Installed plain-Jest CommonJS and ESM consumers, shared export identity, live PostgreSQL queries, rejected credentials, and real `.mts`/`.cts` NodeNext declaration compilation. |
| [`examples/todo-db`](../../examples/todo-db), [`examples/llm-memory-db-mssql`](../../examples/llm-memory-db-mssql), [`examples/llm-memory-db-pg`](../../examples/llm-memory-db-pg) | Example projects; CI explicitly drives the todo and MSSQL examples. |
| [`docs/package.json`](../package.json), [`.github/workflows/docs.yml`](../../.github/workflows/docs.yml), [`docs/.vitepress/config.mts`](../.vitepress/config.mts) | Site build, routing, exclusions, and deployment. |
| [`docs/.vitepress/theme`](../.vitepress/theme) | Theme registration, model viewer, typography, and landing styles. |
| [`docs/models/order-to-cash`](../models/order-to-cash), [`docs/public`](../public), [`docs/tapes`](../tapes) | Model sources, served static assets and installers, and recording fixtures. |
| [`scripts/check-flag-placement.sh`](../../scripts/check-flag-placement.sh) | Documentation flag-placement check invoked by `lint:docs`. |
| [`scripts/Dockerfile`](../../scripts/Dockerfile), [`scripts/ralph-wiggum.sh`](../../scripts/ralph-wiggum.sh) | Node 24/Claude Code development sandbox and bounded loop that stops at the `DONE` promise; separate from build and release automation. |

### Documentation navigation

| Path | Subject |
|---|---|
| [`docs/index.md`](../index.md), [`docs/getting-started`](../getting-started) | Landing page, installation, first build, concepts, and building an SDK. |
| [`docs/dev/index.md`](../dev/index.md), [`docs/dev`](../dev) | Contributor architecture and feature internals. |
| [`docs/guide/sql-files`](../guide/sql-files), [`docs/guide/environments`](../guide/environments), [`docs/guide/changes`](../guide/changes), [`docs/guide/database`](../guide/database), [`docs/guide/automation`](../guide/automation) | User workflows by concern. |
| [`docs/guide/relational-design.md`](../guide/relational-design.md), [`docs/guide/deployment.md`](../guide/deployment.md) | Inherited compound keys and basetype/subtype modeling; deployment workflow. Relational examples now use the order-to-cash model rather than the earlier todo hierarchy. |
| [`docs/cli`](../cli), [`docs/headless.md`](../headless.md), [`docs/reference/sdk.md`](../reference/sdk.md) | CLI command pages, complete headless reference, and SDK API. |
| [`docs/modeling`](../modeling), [`docs/public/video/ignatius.mp4`](../public/video/ignatius.mp4), [`docs/public/video/ignatius-poster.jpg`](../public/video/ignatius-poster.jpg) | Documentation and demo assets for the separate ignatius modeling tool, not noorm implementation. |
| [`docs/why-noorm.md`](../why-noorm.md) | Interface history from minimist through cmd-ts, oclif, Citty/Clack, and Ink; reasons for the CLI/TUI split. |
| [`docs/spec`](../spec), [`docs/design`](../design), [`docs/wiki`](.) | Source-only feature contracts, rationale, and codebase maps; excluded from site publication. |
| [`docs/public/install.sh`](../public/install.sh) | Public installer served at `https://noorm.dev/install.sh`. |

## Constraints

- `build` does not produce the npm distribution. Publishing or testing workspace package imports without `build:packages` can consume absent or stale package artifacts.
- SDK externals and manifest peers must agree. Externalizing Tarn would make MySQL or MSSQL consumers depend on an undeclared installation; bundling dialect drivers would cross the optional-driver installation boundary.
- `import` selects `dist/index.js` with `index.d.ts` declarations; `require` selects `dist/index.cjs` with `index.d.cts` declarations. `default` selects the CommonJS runtime. Independently bundling both formats would split constructor and observer identity.
- Compiled binaries still require OS shared libraries. The builder names worker entries explicitly; a worker omitted from that command is not an embedded entry point.
- Compiled binaries disable automatic `.env` loading. Re-enabling it lets Bun expand or truncate password characters before the connection layer receives the environment.
- CI's path filters cover source, tests, packages, examples, [`bun.lockb`](../../bun.lockb), TypeScript configs, and the CI workflow. A docs-only change does not select that workflow; `docs.yml` independently checks documentation and builds the site.
- The flag-placement checker scans [`README.md`](../../README.md), [`docs`](..), [`skills`](../../skills), and [`examples`](../../examples), exempting explicit contrast/repro documents. A docs-only deployment can fail `lint:docs` even when source CI is not selected.
- The docs workflow selects pushes to `master` affecting `docs/**` or its own workflow, plus manual dispatch. An example-only change does not select a site deployment.
- Documentation deployment writes its own [`CNAME`](../../CNAME) for `noorm.dev` into the deployed branch, independently of the root [`CNAME`](../../CNAME). The docs workflow has no pull-request trigger.
- Source-only documentation directories must remain excluded from VitePress routing. Compiling tooling prose as Vue markdown can fail on angle-bracket content; model and fragment sources otherwise become unintended pages.
- Recording requires `dist/cli/index.js` and the PostgreSQL container. The sandbox refuses removal outside its temporary-root guard and drops the demo database before a recording; `project` mode leaves database creation to the recorded walkthrough.
- Recorded GIFs are lazy-loaded because they are large, below-the-fold assets. Do not remove environment scrubbing when rebuilding them; the sandbox's redirected `HOME` does not itself remove agent-detection environment variables.

## Coupling

- The SDK domain ([`docs/wiki/sdk.md`](sdk.md)) owns the public API and package manifest in [`packages/sdk/package.json`](../../packages/sdk/package.json). Infrastructure owns bundling that API without turning internal dependencies into consumer requirements. The packed MySQL test installs only the tarball, `mysql2`, and Kysely outside the workspace, removes inherited noorm environment settings and `NODE_PATH`, asserts that Tarn cannot be resolved, and exercises rotating credentials under Node.
- The CLI ([`docs/wiki/cli.md`](cli.md)) and worker-bridge ([`docs/wiki/worker-bridge.md`](worker-bridge.md)) domains supply the entry points consumed by the package and compiled-binary builders. Worker entry changes must reach [`scripts/build-binary.mjs`](../../scripts/build-binary.mjs).
- The core-db domain ([`docs/wiki/core-db.md`](core-db.md)) owns connection behavior exercised by packaged-consumer integration coverage. The core-state ([`docs/wiki/core-state.md`](core-state.md)) and core-identity ([`docs/wiki/core-identity.md`](core-identity.md)) domains supply environment bootstrap and identity/state behavior consumed by the example jobs.
- Root workspaces include `packages/*` and `examples/*`, so example imports resolve the local SDK package. The example jobs therefore cover CLI-to-SDK coordination with built workspace artifacts, while the packed-consumer test covers an installed dependency boundary.
- The docs site hosts user, contributor, and ignatius modeling documentation. Its models and recording fixtures remain separate from executable examples; the proposed shared running-example pipeline stays in [`docs/design/site-running-example.md`](../design/site-running-example.md).
