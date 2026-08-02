---
reflects_rev: 11c77040fb7470082550e3c22dc6724fc331a384
type: Index
description: Bun workspace monorepo — noorm, a database schema/change manager with Ink/React TUI, Citty CLI, and Kysely SQL layer
---

<wiki-type>repo</wiki-type>
<scan-sha>f4112cdfcca8fa3c44ef2650ffe2943ddc5511f0</scan-sha>
<wiki-schema>1</wiki-schema>

# Project signals

## Framework & runtime

- **Language:** TypeScript (81% LOC, 1031 files), Bun runtime (>=1.2), Node >=22.13
- **SQL layer:** Kysely 0.28 query builder + executor; dialect-aware across PostgreSQL, MySQL, MSSQL, SQLite
- **TUI:** Ink 6.8 + React 19.2 ([`src/tui/`](../../src/tui)); Citty 0.2 for CLI arg parsing ([`src/cli/`](../../src/cli))
- **Event bus:** `@logosdx/observer` (`ObserverEngine`); module-scope singleton in [`src/core/observer.ts`](../../src/core/observer.ts)
- **Templating:** Eta 4.5 for `.sql.tmpl` files; data loaders for JSON5/YAML/CSV/JS side-cars
- **Error handling:** `@logosdx/utils` `attempt`/`attemptSync` tuples — no try-catch in source
- **Encryption:** AES-256-GCM for state ([`src/core/state/encryption/`](../../src/core/state/encryption)), X25519 ECDH keypairs for identity/vault
- **MCP:** `@modelcontextprotocol/sdk` 1.29 wrapping RPC registry over stdio

## Build / test / lint

| Purpose | Command | Source |
|---------|---------|--------|
| Build (tsc) | `bun run build` | [`package.json`](../../package.json) |
| Build packages | `bun run build:packages` | [`scripts/build.mjs`](../../scripts/build.mjs) (tsup) |
| Build binary | `bun run build:binary` | [`scripts/build-binary.mjs`](../../scripts/build-binary.mjs) (bun compile) |
| Dev watch | `bun run dev` | [`package.json`](../../package.json) |
| Test (all, serial) | `bun run test` | [`package.json`](../../package.json) |
| Test CI group 1 (core, non-transfer) | `bun test --serial $(find tests/utils tests/core tests/sdk -name '*.test.ts' \| grep -v tests/core/transfer \| sort \| tr '\n' ' ')` | `.github/workflows/ci.yml:127` |
| Test CI group 2 (transfer, isolated) | `bun test --serial tests/core/transfer` | `.github/workflows/ci.yml:132` |
| Test CI group 3 (CLI, non-logger-settings) | `bun test --serial $(find tests/cli \( -name '*.test.ts' -o -name '*.test.tsx' \) ! -name 'cli-logger-settings.test.ts' \| sort \| tr '\n' ' ')` | `.github/workflows/ci.yml:138` |
| Test CI group 4 (CLI logger settings, isolated) | `bun test --serial tests/cli/cli-logger-settings.test.ts` | `.github/workflows/ci.yml:153` |
| Test CI group 5 (integration) | `bun test --serial tests/integration` | `.github/workflows/ci.yml:158` |
| Lint | `bun run lint` | ESLint, [`eslint.config.js`](../../eslint.config.js) |
| Typecheck | `bun run typecheck` | [`tsconfig.json`](../../tsconfig.json) |

CI gate: lint → typecheck → build → 5 test groups → 3 example jobs. Integration tests require live DB services (docker-compose or CI service containers). [`tests/core/transfer`](../../tests/core/transfer) and [`tests/cli/cli-logger-settings.test.ts`](../../tests/cli/cli-logger-settings.test.ts) are isolated into their own serial groups because Bun's `mock.module` registry is process-global and never actually restores — an `afterAll` cleanup that re-registers the real module is a no-op, so any file that mocks a module poisons every file loaded after it for the life of the process. Two init-screen tests replace the `SettingsManager` class; `getSettingsManager` then constructs a mock instance, so `createCliLogger` reads `settings: {}` instead of `settings.yml`. Which file wins depends on load order (root files before subdirectories on macOS, the reverse on Linux), so a single-process run passes locally and fails only on CI.

## Language breakdown

| Language | LOC | Files | % |
|----------|-----|-------|---|
| TypeScript | 240887 | 1031 | 81% |
| Markdown | 48422 | 147 | 16% |
| JavaScript | 1261 | 22 | 0% |
| YAML | 1158 | 16 | 0% |
| HTML | 1090 | 27 | 0% |
| CSS | 1061 | 3 | 0% |
| Shell | 932 | 7 | 0% |
| JSON | 473 | 22 | 0% |
| Vue | 205 | 3 | 0% |
| TOML | 11 | 3 | 0% |

## DevOps & CI

- **CI:** GitHub Actions (`ubuntu-24.04`), Bun 1.3.11 pinned; 5 test groups + 3 example jobs per push to master/main
- **DB services (CI):** Postgres 17 on 15432, MySQL 8.0 on 13306, MSSQL 2022 on 11433
- **DB services (local):** [`docker-compose.test.yml`](../../docker-compose.test.yml) at repo root (same ports); postgres/mysql services are `tmpfs`-backed, mssql is not
- **Publish:** Changesets-driven (`changeset publish`) via [`.github/workflows/publish.yml`](../../.github/workflows/publish.yml); fixed-version group: `@noormdev/cli` and `@noormdev/sdk`
- **Binary release:** `bun build --compile` → GitHub Releases via [`.github/workflows/release-binary.yml`](../../.github/workflows/release-binary.yml)
- **Docs:** VitePress, deployed via [`.github/workflows/docs.yml`](../../.github/workflows/docs.yml); site now includes [`docs/tapes/`](../tapes) (VHS-recorded terminal demos, replacing static screenshots) and [`docs/modeling/`](../modeling) (documents the separate `ignatius` tool)
- **License:** Apache-2.0 — root [`LICENSE`](../../LICENSE)/[`NOTICE`](../../NOTICE), and [`packages/cli/LICENSE`](../../packages/cli/LICENSE)/[`NOTICE`](../../NOTICE), [`packages/sdk/LICENSE`](../../packages/sdk/LICENSE)/[`NOTICE`](../../NOTICE) mirror it. Relicensed from MIT (`df9cb20 chore: relicense to Apache 2.0`, itself following an earlier `4550e99 chore: adopt MIT license across packages`) — [`README.md`](../../README.md)'s license badge and footer match.

## Domains

| Domain | Repo paths | One-liner | Detail |
|--------|------------|-----------|--------|
| core-change | [`src/core/change/`](../../src/core/change), [`src/cli/change/`](../../src/cli/change), [`tests/core/change/`](../../tests/core/change) | Versioned DB changes: scaffold, parse, execute, revert, history (timestamps hydrated as UTC on pg/mysql) | [`docs/wiki/core-change.md`](core-change.md) |
| core-runner | [`src/core/runner/`](../../src/core/runner), [`src/core/template/`](../../src/core/template), [`src/cli/run/`](../../src/cli/run), [`tests/core/runner/`](../../tests/core/runner), [`tests/core/template/`](../../tests/core/template) | SQL file execution with checksum dedup and Eta templating | [`docs/wiki/core-runner.md`](core-runner.md) |
| core-db | [`src/core/db/`](../../src/core/db), [`src/core/connection/`](../../src/core/connection), [`src/core/explore/`](../../src/core/explore), [`src/core/teardown/`](../../src/core/teardown), [`src/core/transfer/`](../../src/core/transfer), [`src/cli/db/`](../../src/cli/db), [`tests/core/connection/`](../../tests/core/connection), [`tests/core/explore/`](../../tests/core/explore), [`tests/core/teardown/`](../../tests/core/teardown), [`tests/core/transfer/`](../../tests/core/transfer), [`tests/integration/`](../../tests/integration) | DB lifecycle: create/drop, explore schema, teardown, cross-DB transfer | [`docs/wiki/core-db.md`](core-db.md) |
| core-state | [`src/core/state/`](../../src/core/state), [`src/core/settings/`](../../src/core/settings), [`src/core/config/`](../../src/core/config), [`src/core/lifecycle/`](../../src/core/lifecycle), [`src/core/version/`](../../src/core/version), [`src/core/project.ts`](../../src/core/project.ts), [`src/core/project-init.ts`](../../src/core/project-init.ts), [`src/core/environment.ts`](../../src/core/environment.ts), [`src/core/observer.ts`](../../src/core/observer.ts), [`tests/core/state/`](../../tests/core/state), [`tests/core/settings/`](../../tests/core/settings), [`tests/core/config/`](../../tests/core/config), [`tests/core/lifecycle/`](../../tests/core/lifecycle), [`tests/core/version/`](../../tests/core/version) | Encrypted state, settings.yml, config resolution, lifecycle, version migration | [`docs/wiki/core-state.md`](core-state.md) |
| core-identity | [`src/core/identity/`](../../src/core/identity), [`src/core/vault/`](../../src/core/vault), [`src/core/logger/`](../../src/core/logger), [`src/core/sql-terminal/`](../../src/core/sql-terminal), [`src/cli/identity/`](../../src/cli/identity), [`src/cli/secret/`](../../src/cli/secret), [`src/cli/vault/`](../../src/cli/vault), [`src/cli/sql/`](../../src/cli/sql), [`tests/core/identity/`](../../tests/core/identity), [`tests/core/vault/`](../../tests/core/vault), [`tests/core/logger/`](../../tests/core/logger), [`tests/core/sql-terminal/`](../../tests/core/sql-terminal) | Identity keypairs, vault secrets, structured logger, SQL terminal history | [`docs/wiki/core-identity.md`](core-identity.md) |
| core-policy | [`src/core/policy/`](../../src/core/policy), [`tests/core/policy/`](../../tests/core/policy) | Access-control policy: role×permission matrix, SQL statement classifier, legacy `protected`→`access` migration | [`docs/wiki/core-policy.md`](core-policy.md) |
| sdk | [`src/sdk/`](../../src/sdk), [`src/core/dt/`](../../src/core/dt), [`packages/sdk/`](../../packages/sdk), [`tests/sdk/`](../../tests/sdk), [`tests/integration/sdk/`](../../tests/integration/sdk) | Programmatic API (`createContext`) + DT binary serialization format | [`docs/wiki/sdk.md`](sdk.md) |
| cli | [`src/cli/`](../../src/cli), [`packages/cli/`](../../packages/cli), [`skills/noorm/`](../../skills/noorm), [`tests/cli/`](../../tests/cli) | Citty CLI with 12 domain-owning command groups + 6 leaf commands, headless mode, binary distribution | [`docs/wiki/cli.md`](cli.md) |
| tui | [`src/tui/`](../../src/tui), [`.claude/rules/tui-development.md`](../../.claude/rules/tui-development.md), [`tests/cli/components/`](../../tests/cli/components), [`tests/cli/hooks/`](../../tests/cli/hooks), [`tests/cli/screens/`](../../tests/cli/screens) | Ink/React TUI with focus manager, keyboard routing, ~94 registered screens | [`docs/wiki/tui.md`](tui.md) |
| mcp-rpc | [`src/mcp/`](../../src/mcp), [`src/rpc/`](../../src/rpc), [`src/cli/mcp/`](../../src/cli/mcp), [`tests/core/mcp/`](../../tests/core/mcp), [`tests/core/rpc/`](../../tests/core/rpc) | MCP server over stdio wrapping flat RPC command registry, permission-gated dispatch | [`docs/wiki/mcp-rpc.md`](mcp-rpc.md) |
| worker-bridge | [`src/core/worker-bridge/`](../../src/core/worker-bridge), [`src/workers/`](../../src/workers), [`tests/core/worker-bridge/`](../../tests/core/worker-bridge), [`tests/workers/`](../../tests/workers) | Hub-and-spoke worker threads for DT serialization and DB connection worker | [`docs/wiki/worker-bridge.md`](worker-bridge.md) |
| infra | [`.github/`](../../.github), [`scripts/`](../../scripts), [`examples/`](../../examples), [`docs/`](..), `tsup.*.config.ts`, [`docker-compose.test.yml`](../../docker-compose.test.yml), [`bunfig.toml`](../../bunfig.toml) | CI, build pipeline, binary release, example projects, VitePress docs (incl. [`docs/tapes/`](../tapes) VHS demo recordings, [`docs/modeling/`](../modeling)) | [`docs/wiki/infra.md`](infra.md) |

## Cross-cutting

**Test layout:** Tests mirror [`src/`](../../src) under [`tests/`](../../tests). [`tests/utils/`](../../tests/utils) holds shared DB helpers. [`tests/fixtures/`](../../tests/fixtures) has SQL fixtures per dialect. [`tests/integration/`](../../tests/integration) requires live databases. [`tests/global-setup.ts`](../../tests/global-setup.ts) / [`tests/global-teardown.ts`](../../tests/global-teardown.ts) coordinate integration DB bootstrap.

**Test isolation (updated 2026-08):** the previously-documented contamination source — `src/core/config/index.ts:34` calling `makeNestedConfig(process.env, …)` at module scope — does not reproduce; the call passes `memoizeOpts: false`, so lookups re-read `process.env` live rather than snapshotting at import (see [`docs/wiki/core-state.md`](core-state.md)'s Conventions section for the mechanism). The real isolation driver, confirmed in root [`CLAUDE.md`](../../CLAUDE.md), is that Bun's `mock.module` registry is process-global and never restores — see the Build/test/lint section above for the CI-group rationale.

**Convention pointers:** [`.claude/rules/typescript.md`](../../.claude/rules/typescript.md) (4-block function structure, `attempt` over try-catch), [`.claude/rules/tui-development.md`](../../.claude/rules/tui-development.md) (focus system, Ink layout), [`.claude/rules/testing.md`](../../.claude/rules/testing.md) (test naming, coverage), [`.claude/rules/documentation.md`](../../.claude/rules/documentation.md) (three-pillar structure).

**Domain partitioning basis:** Domains are functional vertical slices. `core-state` groups the startup/persistence concerns (state, settings, config, lifecycle, version) because they all initialize together in `project-init.ts`. `core-identity` groups crypto identity, vault, logger, and SQL terminal because they share the "user-facing sensitive data" concern. `core-db` groups connection, explore, transfer, and teardown because they all operate against a live database connection. `core-change` and `core-runner` are separate because changes are versioned operations while runner handles idempotent file execution — they do not share an execution path (core-change implements its own `executeFiles`/`needsRun`, distinct from the core runner's same-named functions). `core-policy` is a cross-cutting domain ([`src/core/policy/`](../../src/core/policy)): domains that enforce a config-scoped action via `assertPolicy`/`checkConfigPolicy` (`core-change`, `core-runner`, `core-db`, `core-identity`, `sdk`, `cli`, `tui`, `mcp-rpc`) import from it directly, and `core-state` imports it too but only for `resolveLegacyAccess`/`guarded` — data resolution and display styling, not enforcement. `infra` absorbs the entire [`docs/`](..) tree (including the new [`docs/tapes/`](../tapes) VHS demo-recording sources, [`docs/guide/relational-design.md`](../guide/relational-design.md), and [`docs/modeling/`](../modeling) — which documents `ignatius`, a separate information-modeling tool in a separate repo, not noorm's own code) rather than splitting docs out per-domain, since the docs site is built/deployed as one VitePress unit.

**Access-control policy (2026-07, config-access-roles feature):** `Config.protected: boolean` was replaced by `Config.access: ConfigAccess` (per-channel `user`/`agent` roles), enforced through the `core-policy` domain. `src/core/config/protection.ts` and `src/rpc/protection.ts` were both deleted — their rule-checking is absorbed into `core/policy`. The runner/change/transfer/sql-terminal executors gate at their core seam via `assertPolicy`, so SDK/CLI/TUI/MCP callers all inherit one enforcement path. `StateManager.load()` runs the schemaVersion-keyed migration (`core/version/state/`, v2 maps `protected`→`access`, v3 maps `access.mcp`→`access.agent`) ahead of the pre-existing package-semver migration.

**Schema migration v2 (noorm schema isolation):** [`src/core/version/schema/migrations/v2.ts`](../../src/core/version/schema/migrations/v2.ts) moves the six tracking tables into a dedicated `noorm` schema on postgres/mssql (prefix stripped: `change`, not `__noorm_change__`); a no-op on mysql/sqlite, which keep the `__noorm_*__` prefixed names. [`src/core/shared/tables.ts`](../../src/core/shared/tables.ts)'s `getNoormTables(dialect)`/`noormDb(db, dialect)` are the dialect-aware accessors; the un-dialected `NOORM_TABLES` constant is `@deprecated`. See [`docs/wiki/core-state.md`](core-state.md)'s Conventions section.

**Recent change (2026-08, local):** [`src/core/change/history.ts`](../../src/core/change/history.ts) now hydrates `executed_at` as UTC on pg/mysql — `pg`/`mysql2` were parsing noorm's naive UTC text through the host's local timezone, so a change applied moments ago could render as "in 4 hours" on a UTC-negative host. mssql is deliberately left alone (tedious was not measured). See [`docs/wiki/core-change.md`](core-change.md)'s Conventions section.

**Unresolved review findings (informational):** `core-change.md` and `core-identity.md` each required a targeted post-review correction beyond the standard reviewer loop (a dead-code/out-of-domain doc claim in core-change's Docs section, and a gzip/permission-model misattribution to vault in core-identity's Conventions section) — both were fixed directly rather than re-dispatching a 4th sub-agent iteration; content is now accurate as of this refresh.

**Deterministic substrate:** [`docs/wiki/scan.md`](scan.md) (regenerated this refresh via `atomic signals scan`)
