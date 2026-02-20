# noorm TODO


## Priority 2: Documentation Media

Replace ASCII terminal UI representations with screenshots and videos throughout documentation.

**Scope:**

- Future Roadmap wireframes (Schema Diff, Drift Detection, Backups, AI Chat)
- Any TUI mockups in docs/
- README demos

**Format:**

- Screenshots: PNG with terminal theme consistency
- Videos: GIF or MP4 for multi-step workflows
- Store in `docs/assets/` or similar


## Priority 3: Dialect Boilerplates

Starter templates demonstrating the SDK-on-SDK pattern: build your SQL schema and TypeScript client together, deploy as RPC-style database access.

**Structure (PNPM monorepo):**

```
boilerplate-postgres/
├── packages/
│   └── sdk/                    # Consumes SQL, exports typed client
│       ├── src/
│       │   ├── client.ts       # SDK wrapper around noorm context
│       │   └── types.ts        # Generated from schema
│       └── package.json
├── apps/
│   ├── api/                    # Hono REST API using SDK
│   │   ├── src/routes/
│   │   └── package.json
│   ├── cli/                    # CLI tool using SDK
│   │   ├── src/commands/
│   │   └── package.json
│   └── worker/                 # Cloudflare Worker using SDK
│       ├── src/
│       └── wrangler.toml
├── sql/                        # noorm-managed schema
│   ├── schema/
│   └── changes/
├── pnpm-workspace.yaml
└── noorm.config.ts
```

**Deliverables per dialect:**

- [ ] PostgreSQL boilerplate
- [ ] SQLite boilerplate
- [ ] MySQL boilerplate
- [ ] MSSQL boilerplate

Each includes:
- Working SDK with type generation
- Hono API with CRUD routes
- CLI with common operations
- Worker with edge deployment
- Full test coverage
- README with setup instructions


## ✓ Priority 1: Data Transfer (Complete)

Data transfer functionality implemented with full conflict handling and cross-server support.


## SDK Finish Line

Core SDK is implemented and packaged (`@noormdev/sdk`). Remaining:

- [ ] **SDK test coverage** - Dedicated tests for SDK surface (`createContext`, lifecycle, operations)
- [ ] **Test mode enforcement** - When `requireTest: true`, SDK must refuse to connect if `config.isTest !== true`
- [ ] **Protected config hard block** - Destructive operations (destroy, truncate, teardown) on protected configs are denied with no override. User must perform manually. Remove `allowProtected` option entirely.


## Headless CLI Gaps

40 handlers implemented. Missing commands:

**Database:**
- [ ] `db reset` - Teardown + build (idempotent rebuild)
- [ ] `db drop` - Drop entire database
- [ ] `db create` - Create database if not exists

**Configuration:**
- [ ] `config validate` - Validate config can connect
- [ ] `config list` - List available configs

**SQL Execution:**
- [ ] `sql <query>` - Execute raw SQL
- [ ] `sql -f <file>` - Execute SQL from file

**Changes:**
- [ ] `change next` - Apply next pending change

**Runner:**
- [ ] `run files <path...>` - Run multiple specific files

## Manual QA

- [ ] **Full headless command QA** - Run every headless command end-to-end and verify they work correctly. Cover all 40+ implemented handlers.
- [ ] **Change rewind blocks reapply (bug)** - After rewinding a change, it cannot be reapplied. This breaks the test-fix-reapply workflow. Rewound changes should be eligible for reapplication.
- [ ] **Absolute paths stored in database (bug)** - Change file paths are being stored as absolute paths instead of relative to the project root. This leaks the user's local directory structure. Paths should be stripped of the project root prefix before insertion.


## Bugs

- [x] **Config Import focus broken** - Fixed: guarded `useInput` with `isActive` so it only fires during complete/error steps.
- [x] **Config edit screen too large** - Fixed: added terminal-height-aware `overflowY="hidden"` constraint to the form wrapper.
- [x] **Shift+Tab navigation broken** - Fixed: added `key.shift && key.tab` check before `key.tab` in Form.tsx.
- [x] **Transfer progress inaccurate** - Fixed: aggregate `rowsTransferred` now updates in real-time via delta tracking in `transfer:table:progress`, `dt:import:progress`, and `dt:import:complete` handlers. Same-server transfers show spinner instead of misleading 0% bar.
- [x] **Change add ignores changes folder setting** - Fixed: all 6 change screens now resolve paths with `path.join(projectRoot, config.paths.changes)`, matching the SDK pattern.


## Investigations

- [ ] **Transfer slowness** - Profile and identify bottlenecks in data transfer operations
- [ ] **Migrate to OpenTUI** - Replace Ink/React TUI with OpenTUI framework. **Note:** consider doing this before the AI/OpenCode integration — if the AI chat becomes a TUI screen rather than a separate mode, the rendering layer matters. Migrating after means porting AI features twice.


## Data Transfer & Export

- [ ] **Export query folder** - Dedicated folder (e.g., `export/` or `sql/export/`) for reusable SQL files that define dt exports. Each file contains a SELECT query whose results get serialized to dt format. Front matter (YAML block at top) provides metadata for the TUI: name, description, target filename, schedule hints. Run one or many from the TUI or CLI (`noorm export run <name>`). Supports the template engine for dynamic filters.
- [ ] **SQL query view to dt export** - Allow exporting a SQL query result view to a `.dt` file (e.g., export a subset of a table from prod to dev)
- [ ] **Dedicated transfers folder** - Explore a `transfers/` folder structure similar to changes but without up/down — just a dated folder with SQL and data files (like seeds)
- [ ] **Seed command** - `noorm seed apply --config dev` — runs SQL templates and imports dt files from the transfers/seeds folder in order. Closes the loop between "exported subset from prod" and "hydrate dev database." Leverages existing template engine and dt format.
- [ ] **AI-assisted dt export** - With the AI integration's read-only DB access, the AI can propose and generate dt exports based on user criteria (e.g., "export users matching X to a dt file for dev"). Non-destructive, fits within existing guard rails.


## Database Security & Multi-Tenancy

- [ ] **Authorization via DB roles** - Create authorization mechanisms per database using built-in DB roles for access to sensitive noorm tables. Use stored procedures to get sensitive data; unprivileged roles can never modify directly. Only admin can rotate keys and create tables.
- [ ] **Separate noorm tables to dedicated connection** - Scope noorm internal tables to a separate connection/database. If no central DB is configured, fall back to the current connection. Enables shared encryption keys across environments, shared secrets, secret migration, and permissions — so that the app database doesn't hold sensitive information or historical data. **Sequence: do this before roles/users — it defines the permission surface.**
- [ ] **Service users** - Create service user support for automated/CI connections
- [ ] **Dev users (nonadmin)** - Create noorm dev users with restricted privileges (no admin operations)


## Diagnostics

- [ ] **`noorm doctor` command** - Comprehensive diagnostic that verifies the full setup: connection health, role permissions, noorm table accessibility, encryption key validity, version compatibility. Becomes essential as the security model grows (roles, separate connections, service users).


## Pre-Release Checklist

- [ ] **Change table CLI version** - Ensure change rows include CLI version (currently null)
- [ ] **Events audit** - Revisit all observer events, ensure uniform naming, verify all typed in `NoormEvents`
- [ ] **Test coverage** - Write tests for core modules (see `TODO-tests.md`)
- [ ] **Cleanup plans** - Remove or archive `plan/` directory contents
- [ ] **Public documentation** - Create user-facing docs:
  - TUI usage (getting started, screens, workflows)
  - CLI commands (headless mode reference)
  - SDK API (programmatic usage, testing patterns)


## Future Roadmap


### Near-Term

**Type Generation** - Auto-generate TypeScript interfaces from database schema for Kysely generics.

```bash
noorm generate types [--config <name>] [--output ./types/database.ts]
```

**Watch Mode** - Watch SQL files for changes, auto-rebuild on save.

```bash
noorm watch [--config <name>]
```

**Multi-Config Operations** - Run operations across multiple configs in sequence.

```bash
noorm change ff --configs dev,staging,prod --confirm-each
```


### Medium-Term

**Schema Linting** - Static analysis of SQL files for common issues (missing indexes, naming conventions, reserved words).

**Webhooks** - Notify external systems on operation completion (Slack, email).


### Long-Term

**Schema Diffing** - Compare expected schema (SQL files) vs actual database state using shadow database comparison.

**Drift Detection** - Passive monitoring with snapshots at `.noorm/snapshots/`. Show drift warnings on TUI launch.

**Backup & Restore** - Full database backup and restore to/from local filesystem.

- `noorm db backup [--config <name>] [--output <path>]` - Backup database to local file
- `noorm db restore [--config <name>] [--input <path>]` - Restore database from backup file
- Use native tools per dialect: `pg_dump`/`pg_restore` for PostgreSQL, `mysqldump` for MySQL, `.backup` for SQLite, `BACKUP DATABASE` for MSSQL
- Automatic compression (gzip)
- Snapshot before destructive operations (optional)

**AI Integration via OpenCode** - Build on [OpenCode](https://github.com/sst/opencode) SDK to give users an AI-powered database assistant within their own CLI. User must opt in to enable AI features.

Capabilities:

- **Read-only database exploration** - AI can generate and execute its own SQL to inspect the active database (schema, data, relationships). All AI-generated SQL is validated through [`sql-parser-cst`](https://github.com/nene/sql-parser-cst) to ensure only CTEs and SELECT statements are allowed — no DDL or DML passes the guard.
- **Safe SDK tool access** - AI can invoke non-destructive noorm SDK operations: migrations, build, run, change apply, explore, etc. Destructive operations (destroy, teardown, drop) are excluded from the AI toolset entirely.
- **Schema-aware SQL generation** - AI uses live schema introspection to generate accurate, contextual SQL queries and migration scripts.

Architecture (OpenTUI + OpenCode):

- **Embedded AI screen** - With OpenTUI as the rendering layer, the AI chat is just another TUI screen/route — not a separate process or modal. It lives alongside every other screen in the app.
- **Background agent** - The AI agent runs in the background of the TUI. While you're browsing schemas, reviewing changes, or running queries, the agent can be working: writing SQL files, generating migrations, preparing exports, scaffolding changes. Its activity flows through the same observer event system, so progress shows up in the log viewer overlay like any other operation.
- **File and SQL operations** - The agent can write SQL files to disk (new queries, migration scripts, export definitions), execute read-only SQL against the active database, run builds and migrations through the SDK, and propose changes for your review — all within the TUI.
- **Conversational workflow** - Ask the agent to "create a migration that adds an index on users.email" and it inspects the schema, writes the SQL file, and optionally applies it. Or "export all orders from last month to dt" and it generates the query and runs the export. The TUI stays interactive throughout.

Guard rails:

- SQL validation via `sql-parser-cst` — parse tree must contain only `select_stmt` and `common_table_expression` nodes; reject everything else
- SDK tool allowlist — only expose safe operations; no `destroy`, `teardown`, `drop`, `truncate`
- Opt-in activation — AI features are disabled by default, user explicitly enables in settings

**skills.sh Skill** - Publish a [skills.sh](https://skills.sh) skill for noorm so AI coding agents (Claude Code, etc.) can install it and work with noorm projects out of the box — schema management, migrations, SQL generation, and safe database exploration.

**llms.txt for Context7** - Publish noorm documentation in llms.txt format for LLM context providers (context7, etc.). Enables AI assistants to understand noorm commands, workflows, and patterns.

**User Project LLM Files** - Generate helper files (`CLAUDE.md`, `.cursorrules`) for user projects describing their noorm setup, SQL structure, and available template variables. Command: `noorm init llm`.


---


## Completed Features

| Feature | Core | UI | Docs |
|---------|------|----|------|
| Config management | ✓ | ✓ 9 screens | ✓ |
| Change management | ✓ | ✓ 11 screens | ✓ |
| Secret management | ✓ | ✓ 3 screens | ✓ |
| Settings/stages/rules | ✓ | ✓ 13 screens | ✓ |
| Lock management | ✓ | ✓ 5 screens | ✓ |
| Identity management | ✓ | ✓ 6 screens | ✓ |
| Database management | ✓ | ✓ 10 screens | ✓ |
| Runner/execution | ✓ | ✓ 5 screens | ✓ |
| Explore (schema browser) | ✓ | ✓ 3 screens | ✓ |
| Teardown (reset/truncate) | ✓ | ✓ 2 screens | ✓ |
| SQL Terminal | ✓ | ✓ 3 screens | ✓ |
| State encryption | ✓ | N/A | ✓ |
| Template engine | ✓ | N/A | ✓ |
| Logger | ✓ | ✓ Log viewer overlay | ✓ |
| **Secrets Vault** | ✓ | ✓ 4 screens | Pending |
| **Auto-Update** | ✓ | ✓ Notification | Pending |
| **TypeScript SDK** | ✓ | N/A | Pending |
| **Headless CLI** | ✓ (80%) | N/A | Pending |
