---
reflects_rev: cf0d4c3b4b5d4ce5c54e12436ce3cfbefdb59191
type: Index
---

<wiki-type>repo</wiki-type>
<scan-sha></scan-sha>
<wiki-schema>1</wiki-schema>

# Project signals

## Framework & runtime

- **Language:** TypeScript (80% LOC, 872 files), Bun runtime (>=1.2), Node >=22.13
- **SQL layer:** Kysely query builder + executor; dialect-aware across PostgreSQL, MySQL, MSSQL, SQLite
- **TUI:** Ink 6 + React 19 (`src/tui/`); Citty for CLI arg parsing (`src/cli/`)
- **Event bus:** `@logosdx/observer` (`ObserverEngine`); module-scope singleton in `src/core/observer.ts`
- **Templating:** Eta 4 for `.sql.tmpl` files; data loaders for JSON5/YAML/CSV/JS side-cars
- **Error handling:** `@logosdx/utils` `attempt`/`attemptSync` tuples — no try-catch in source
- **Encryption:** AES-256-GCM for state (`src/core/state/encryption/`), Ed25519-like keypairs for identity
- **MCP:** `@modelcontextprotocol/sdk` wrapping RPC registry over stdio

## Build / test / lint

| Purpose | Command | Source |
|---------|---------|--------|
| Build (tsc) | `bun run build` | `package.json` |
| Build packages | `bun run build:packages` | `scripts/build.mjs` (tsup) |
| Build binary | `bun run build:binary` | `scripts/build-binary.mjs` (bun compile) |
| Dev watch | `bun run dev` | `package.json` |
| Test (all, serial) | `bun run test` | `package.json` |
| Test CI group 1 | `bun test --serial $(find tests/utils tests/core tests/sdk -name '*.test.ts' \| grep -v tests/core/transfer \| sort \| tr '\n' ' ')` | `.github/workflows/ci.yml:127` |
| Test CI group 2 | `bun test --serial tests/core/transfer` | `.github/workflows/ci.yml:132` |
| Test CI group 3 | `bun test --serial tests/cli` | `.github/workflows/ci.yml:137` |
| Test CI group 4 | `bun test --serial tests/integration` | `.github/workflows/ci.yml:142` |
| Lint | `bun run lint` | ESLint, `eslint.config.js` |
| Typecheck | `bun run typecheck` | `tsconfig.json` |

CI gate: lint → typecheck → build → 4 test groups → 3 example jobs. Integration tests require live DB services (docker-compose or CI service containers).

## Language breakdown

| Language | LOC | Files | % |
|----------|-----|-------|---|
| TypeScript | 199535 | 872 | 80% |
| Markdown | 42464 | 186 | 17% |
| YAML | 1114 | 16 | 1% |
| JavaScript | 1005 | 22 | 1% |
| HTML | 955 | 26 | 2% |
| CSS | 913 | 3 | <1% |
| Shell | 726 | 4 | <1% |

## DevOps & CI

- **CI:** GitHub Actions (`ubuntu-24.04`), Bun 1.3.11 pinned; 4 test groups + 3 example jobs per push to master/main
- **DB services (CI):** Postgres 17 on 15432, MySQL 8.0 on 13306, MSSQL 2022 on 11433
- **DB services (local):** `docker-compose.yml` at repo root (same ports)
- **Publish:** Changesets-driven (`changeset publish`) via `.github/workflows/publish.yml`; packages: `@noormdev/cli` and `@noormdev/sdk`
- **Binary release:** `bun build --compile` → GitHub Releases via `.github/workflows/release-binary.yml`
- **Docs:** VitePress, deployed via `.github/workflows/docs.yml`

## Domains

| Domain | Repo paths | One-liner | Detail |
|--------|------------|-----------|--------|
| core-change | `src/core/change/`, `src/cli/change/`, `tests/core/change/` | Versioned DB changes: scaffold, parse, execute, history | .claude/project/signals/core-change.md |
| core-runner | `src/core/runner/`, `src/core/template/`, `src/cli/run/`, `tests/core/runner/`, `tests/core/template/` | SQL file execution with checksum dedup and Eta templating | .claude/project/signals/core-runner.md |
| core-db | `src/core/db/`, `src/core/connection/`, `src/core/explore/`, `src/core/teardown/`, `src/core/transfer/`, `src/cli/db/`, `tests/core/connection/`, `tests/core/explore/`, `tests/core/teardown/`, `tests/core/transfer/`, `tests/integration/` | DB lifecycle: create/drop, explore schema, teardown, cross-DB transfer | .claude/project/signals/core-db.md |
| core-state | `src/core/state/`, `src/core/settings/`, `src/core/config/`, `src/core/lifecycle/`, `src/core/version/`, `src/core/project.ts`, `src/core/project-init.ts`, `src/core/environment.ts`, `src/core/observer.ts`, `tests/core/state/`, `tests/core/settings/`, `tests/core/config/`, `tests/core/lifecycle/`, `tests/core/version/` | Encrypted state, settings.yml, config resolution, lifecycle, version migration | .claude/project/signals/core-state.md |
| core-identity | `src/core/identity/`, `src/core/vault/`, `src/core/logger/`, `src/core/sql-terminal/`, `src/cli/identity/`, `src/cli/secret/`, `src/cli/vault/`, `src/cli/sql/`, `tests/core/identity/`, `tests/core/vault/`, `tests/core/logger/`, `tests/core/sql-terminal/` | Identity keypairs, vault secrets, structured logger, SQL terminal history | .claude/project/signals/core-identity.md |
| sdk | `src/sdk/`, `src/core/dt/`, `packages/sdk/`, `tests/sdk/`, `tests/integration/sdk/` | Programmatic API (`createContext`) + DT binary serialization format | .claude/project/signals/sdk.md |
| cli | `src/cli/`, `packages/cli/`, `skills/noorm/`, `tests/cli/` | Citty CLI with 17 command groups, headless mode, binary distribution | .claude/project/signals/cli.md |
| tui | `src/tui/`, `src/hooks/`, `.claude/rules/tui-development.md`, `tests/cli/components/`, `tests/cli/hooks/`, `tests/cli/screens/` | Ink/React TUI with focus manager, keyboard routing, per-domain screens | .claude/project/signals/tui.md |
| mcp-rpc | `src/mcp/`, `src/rpc/`, `src/cli/mcp/`, `tests/core/mcp/`, `tests/core/rpc/` | MCP server over stdio wrapping flat RPC command registry | .claude/project/signals/mcp-rpc.md |
| worker-bridge | `src/core/worker-bridge/`, `src/workers/`, `tests/core/worker-bridge/`, `tests/workers/` | Hub-and-spoke worker threads for DT serialization and DB connection worker | .claude/project/signals/worker-bridge.md |
| infra | `.github/`, `scripts/`, `examples/`, `docs/`, `tsup.*.config.ts`, `docker-compose.yml`, `bunfig.toml` | CI, build pipeline, binary release, example projects, VitePress docs | .claude/project/signals/infra.md |

## Cross-cutting

**Test layout:** Tests mirror `src/` under `tests/`. `tests/utils/` holds shared DB helpers. `tests/fixtures/` has SQL fixtures per dialect. `tests/integration/` requires live databases. `tests/global-setup.ts` / `tests/global-teardown.ts` coordinate integration DB bootstrap.

**Known contamination:** `src/core/config/index.ts:34` calls `makeNestedConfig(process.env, …)` at module scope — snaps env at first import. This causes test cross-contamination when running the full suite in one process. Workaround: run test groups in separate `bun test --serial` invocations (same as CI).

**Convention pointers:** `.claude/rules/typescript.md` (4-block function structure, `attempt` over try-catch), `.claude/rules/tui-development.md` (focus system, Ink layout), `.claude/rules/testing.md` (test naming, coverage), `.claude/rules/documentation.md` (three-pillar structure).

**Domain partitioning basis:** Domains are functional vertical slices. `core-state` groups the startup/persistence concerns (state, settings, config, lifecycle, version) because they all initialize together in `project-init.ts`. `core-identity` groups crypto identity, vault, logger, and SQL terminal because they share the "user-facing sensitive data" concern. `core-db` groups connection, explore, transfer, and teardown because they all operate against a live database connection. `core-change` and `core-runner` are separate because changes are versioned operations while runner handles idempotent file execution — they share `runFile` but have distinct lifecycles.

**Deterministic substrate:** `.claude/project/deterministic-signals.md` (generated 2026-06-01T02:30:22Z, atomic 3.0.0)
