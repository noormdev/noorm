# noorm TODO


## Pre-Release

Critical work before public release.


### SDK Finish Line

Core SDK is implemented and packaged (`@noormdev/sdk`). Remaining:

- [x] **SDK test coverage** - Dedicated tests for SDK surface (`createContext`, lifecycle, operations)
- [x] **Test mode enforcement** - When `requireTest: true`, SDK must refuse to connect if `config.isTest !== true`
- [x] **Protected config hard block** - Destructive operations (destroy, truncate, teardown) on protected configs are denied with no override. User must perform manually. Remove `allowProtected` option entirely.


### Headless CLI Gaps

40 handlers implemented. Missing commands:

**Database:**

- [x] `db reset` - Teardown + build (idempotent rebuild)
- [x] `db drop` - Drop entire database
- [x] `db create` - Create database if not exists

**Configuration:**

- [x] `config validate` - Validate config can connect
- [x] `config list` - List available configs

**SQL Execution:**

- [x] `sql <query>` - Execute raw SQL
- [x] `sql -f <file>` - Execute SQL from file

**Changes:**

- [x] `change next` - Apply next pending change

**Runner:**

- [x] `run files <path...>` - Run multiple specific files
- [x] `run exec` - Batch-execute selected SQL files (currently TUI-only `RunExecScreen`)


### TUI Parity Gaps

Surfaces that exist in the TUI but have no headless CLI equivalent. Discovered after the citty migration audit. Blocks CI/CD adoption for anything beyond `change`/`run`/`vault` workflows.

**Identity:** (entire domain TUI-only — no `noorm identity` command)

- [ ] **`identity ci`** - Create/load an identity for CI use via ENV variables (e.g. `NOORM_IDENTITY_PRIVATE_KEY`, `NOORM_IDENTITY_NAME`, `NOORM_IDENTITY_EMAIL`). Requires **core support** to bootstrap an identity from env vars instead of `~/.noorm/identity` on disk, so CI runners can decrypt vault/state without writing secrets to the filesystem.
- [x] `identity init` - Generate or regenerate an identity headlessly
- [x] `identity edit` - Edit identity metadata (name, email)
- [x] `identity export` - Export public key
- [x] `identity list` - List known users

**Init:**

- [x] `noorm init` - Bootstrap a project (identity setup + project setup) from CLI

**Settings:** (entire domain TUI-only — no `noorm settings` command)

- [x] `settings init` - Initialize `settings.yml`
- [x] `settings build` - Build/regenerate settings
- [ ] `settings edit` - Interactive editor. Prompts for a field to edit (paths, strict, logging, stages, rules), applies the change, then loops back to the field picker. Exits on "Done" selection or `Esc`. One command covers everything.
- [ ] `settings secret` - Interactive secret **requirement** declaration (config enforcement, not value storage). Declares that a given secret must be set for a particular stage (or all stages). Loop pattern: pick action (add/edit/rm requirement), pick scope (universal or a stage), apply, loop. Exits on "Done" or `Esc`. Actual secret values live in `secret/*` / vault.

**Secrets:** (entire `secret/*` domain TUI-only — distinct from `vault`)

- [x] `secret list` - List secrets
- [x] `secret set <key> <value>` - Set a secret
- [x] `secret rm <key>` - Remove a secret

**Configuration (additional):**

- [x] `config cp <src> <dest>` - Copy a config
- [x] `config export <name>` - Export a config to file
- [x] `config import <path>` - Import a config from file

**Changes (additional):**

- [x] `change add <name>` - Create a new change
- [ ] `change edit <name>` - Edit an existing change
- [x] `change rm <name>` - Delete a change
- [x] `change rewind <name>` - Rewind to a specific change
- [x] `change history detail <name>` - Show per-file execution history

**Database (additional):**

- [ ] `db dt-modify <path>` - Modify a `.dt` file (currently only TUI `DtModifyScreen`)

**Database Exploration:**

- [x] `db explore views` + `db explore views <name>` - List and inspect views
- [x] `db explore procedures` + `db explore procedures <name>` - List and inspect stored procedures
- [x] `db explore functions` + `db explore functions <name>` - List and inspect functions
- [x] `db explore types` + `db explore types <name>` - List and inspect custom types
- [x] `db explore indexes` - List indexes
- [x] `db explore fks` - List foreign keys

**SQL Terminal:** (CLI `sql` is one-shot only)

- [x] `sql repl` - Interactive SQL REPL (currently TUI-only `SqlTerminalScreen`)
- [x] `sql history` - Show SQL execution history
- [x] `sql clear` - Clear SQL execution history


### CI/CD Integration

- [ ] **Slack notifications on command failure** - Add ENV variables (e.g. `NOORM_SLACK_WEBHOOK_URL`, `NOORM_SLACK_CHANNEL`) to publish failure messages to Slack when a command fails in CI (e.g. `noorm change ff`). Should include command name, exit code, error summary, and config name.


### Open Bugs

- [ ] **Change rewind blocks reapply** - After rewinding a change, it cannot be reapplied. This breaks the test-fix-reapply workflow. Rewound changes should be eligible for reapplication.
- [x] **Absolute paths stored in database** - Change file paths are being stored as absolute paths instead of relative to the project root. This leaks the user's local directory structure. Paths should be stripped of the project root prefix before insertion.


### Manual QA

- [ ] **Full headless command QA** - Run every headless command end-to-end and verify they work correctly. Cover all 40+ implemented handlers.


### Release Checklist

- [x] **Change table CLI version** - Ensure change rows include CLI version (currently null)
- [x] **Events audit** - Revisit all observer events, ensure uniform naming, verify all typed in `NoormEvents`
- [ ] **Test coverage** - Write tests for core modules (see `TODO-tests.md`)
- [x] **Cleanup plans** - Remove or archive `plan/` directory contents
- [ ] **Public documentation** - Create user-facing docs:
  - TUI usage (getting started, screens, workflows)
  - CLI commands (headless mode reference)
  - SDK API (programmatic usage, testing patterns)


## Documentation Media

Replace ASCII terminal UI representations with screenshots and videos throughout documentation.

**Scope:**

- Future Roadmap wireframes (Schema Diff, Drift Detection, Backups, AI Chat)
- Any TUI mockups in docs/
- README demos

**Format:**

- Screenshots: PNG with terminal theme consistency
- Videos: GIF or MP4 for multi-step workflows
- Store in `docs/assets/` or similar


## Dialect Boilerplates

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


## Investigations

- [ ] **Transfer slowness** - Profile and identify bottlenecks in data transfer operations
- [ ] **Migrate to OpenTUI** - Replace Ink/React TUI with OpenTUI framework. **Note:** consider doing this before the AI/OpenCode integration — if the AI chat becomes a TUI screen rather than a separate mode, the rendering layer matters. Migrating after means porting AI features twice.


## Post-Release Features


### Data Transfer & Export

- [ ] **Export query folder** - Dedicated folder (e.g., `export/` or `sql/export/`) for reusable SQL files that define dt exports. Each file contains a SELECT query whose results get serialized to dt format. Front matter (YAML block at top) provides metadata for the TUI: name, description, target filename, schedule hints. Run one or many from the TUI or CLI (`noorm export run <name>`). Supports the template engine for dynamic filters.
- [ ] **SQL query view to dt export** - Allow exporting a SQL query result view to a `.dt` file (e.g., export a subset of a table from prod to dev)
- [ ] **Dedicated transfers folder** - Explore a `transfers/` folder structure similar to changes but without up/down — just a dated folder with SQL and data files (like seeds)
- [ ] **Seed command** - `noorm seed apply --config dev` — runs SQL templates and imports dt files from the transfers/seeds folder in order. Closes the loop between "exported subset from prod" and "hydrate dev database." Leverages existing template engine and dt format.
- [ ] **AI-assisted dt export** - With the AI integration's read-only DB access, the AI can propose and generate dt exports based on user criteria (e.g., "export users matching X to a dt file for dev"). Non-destructive, fits within existing guard rails.


### Database Security & Multi-Tenancy

- [ ] **SQL permission model via [`node-sql-parser`](https://github.com/taozhi8833998/node-sql-parser)** - Parse and classify SQL statements before execution to enforce permission boundaries. Supports MySQL, PostgreSQL, MSSQL, SQLite dialects. Use cases: block DDL/DML for read-only roles, restrict which tables a user/service can touch, validate AI-generated SQL before execution, enforce query-only mode in CI. Replaces or complements `sql-parser-cst` for guard rails since it covers all four noorm dialects and provides AST-level table/column extraction.
- [ ] **Authorization via DB roles** - Create authorization mechanisms per database using built-in DB roles for access to sensitive noorm tables. Use stored procedures to get sensitive data; unprivileged roles can never modify directly. Only admin can rotate keys and create tables.
- [ ] **Separate noorm tables to dedicated connection** - Scope noorm internal tables to a separate connection/database. If no central DB is configured, fall back to the current connection. Enables shared encryption keys across environments, shared secrets, secret migration, and permissions — so that the app database doesn't hold sensitive information or historical data. **Sequence: do this before roles/users — it defines the permission surface.**
- [ ] **Service users** - Create service user support for automated/CI connections
- [ ] **Dev users (nonadmin)** - Create noorm dev users with restricted privileges (no admin operations)


### Diagnostics

- [ ] **`noorm doctor` command** - Comprehensive diagnostic that verifies the full setup: connection health, role permissions, noorm table accessibility, encryption key validity, version compatibility. Becomes essential as the security model grows (roles, separate connections, service users).


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

- **Read-only database exploration** - AI can generate and execute its own SQL to inspect the active database (schema, data, relationships). All AI-generated SQL is validated through [`node-sql-parser`](https://github.com/taozhi8833998/node-sql-parser) to ensure only CTEs and SELECT statements are allowed — no DDL or DML passes the guard.
- **Safe SDK tool access** - AI can invoke non-destructive noorm SDK operations: migrations, build, run, change apply, explore, etc. Destructive operations (destroy, teardown, drop) are excluded from the AI toolset entirely.
- **Schema-aware SQL generation** - AI uses live schema introspection to generate accurate, contextual SQL queries and migration scripts.

Architecture (OpenTUI + OpenCode):

- **Embedded AI screen** - With OpenTUI as the rendering layer, the AI chat is just another TUI screen/route — not a separate process or modal. It lives alongside every other screen in the app.
- **Background agent** - The AI agent runs in the background of the TUI. While you're browsing schemas, reviewing changes, or running queries, the agent can be working: writing SQL files, generating migrations, preparing exports, scaffolding changes. Its activity flows through the same observer event system, so progress shows up in the log viewer overlay like any other operation.
- **File and SQL operations** - The agent can write SQL files to disk (new queries, migration scripts, export definitions), execute read-only SQL against the active database, run builds and migrations through the SDK, and propose changes for your review — all within the TUI.
- **Conversational workflow** - Ask the agent to "create a migration that adds an index on users.email" and it inspects the schema, writes the SQL file, and optionally applies it. Or "export all orders from last month to dt" and it generates the query and runs the export. The TUI stays interactive throughout.

Guard rails:

- SQL validation via [`node-sql-parser`](https://github.com/taozhi8833998/node-sql-parser) — parse SQL, inspect AST type and table references, reject anything beyond SELECT/CTE. Covers all four dialects (replaces `sql-parser-cst` which only handles a subset).
- SDK tool allowlist — only expose safe operations; no `destroy`, `teardown`, `drop`, `truncate`
- Opt-in activation — AI features are disabled by default, user explicitly enables in settings

**skills.sh Skill** - Publish a [skills.sh](https://skills.sh) skill for noorm so AI coding agents (Claude Code, etc.) can install it and work with noorm projects out of the box — schema management, migrations, SQL generation, and safe database exploration.

**llms.txt for Context7** - Publish noorm documentation in llms.txt format for LLM context providers (context7, etc.). Enables AI assistants to understand noorm commands, workflows, and patterns.

**User Project LLM Files** - Generate helper files (`CLAUDE.md`, `.cursorrules`) for user projects describing their noorm setup, SQL structure, and available template variables. Command: `noorm init llm`.
