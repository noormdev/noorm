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


## Priority 1: Data Transfer

Transfer table data between databases.

```bash
noorm db transfer [--from <config>] [--to <config>] [--tables <list>] [--on-conflict <strategy>]
```

**Conflict handling (`--on-conflict`):**
- `fail` (default) - Abort on first duplicate, safest option
- `skip` - Ignore rows with existing PKs (`INSERT IGNORE`, `ON CONFLICT DO NOTHING`)
- `update` - Upsert existing rows (`ON DUPLICATE KEY UPDATE`, `ON CONFLICT DO UPDATE`, `MERGE`)
- `replace` - Delete + insert (atomic replacement)

**Same-server transfer:**
- Detect when source and target share host/port/credentials
- Use optimized `INSERT INTO target.table SELECT * FROM source.table` statements
- Support table filtering, WHERE clauses

**Cross-server transfer:**
- Connect to two different servers and transfer data between them
- CSV intermediate format for dialect-agnostic transfers
- Dialect-specific optimizations (PostgreSQL `COPY`, SQL Server BCP, MySQL `LOAD DATA`)
- Progress reporting for large transfers
- Transaction support with rollback on failure

**Considerations:**
- Foreign keys (insertion order, disable FK checks)
- Identity columns (preserve IDs, sequence resync)
- Large datasets (batching, streaming, resume)
- Schema mismatches (`--dry-run` validation)
- Triggers (option to disable)


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

## Bugs

- [ ] **Config Import focus broken** - Configurations › More › Import Config has broken keyboard focus. Needs investigation and fix.


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

**AI Database Chat** - Interactive chat against schema and data with tool-based exploration. Model configured in `noorm.config.ts`.

**llms.txt for Context7** - Publish noorm documentation in llms.txt format for LLM context providers (context7, etc.). Enables AI assistants to understand noorm commands, workflows, and patterns.

**MCP Server for Database Access** - TUI spawns an MCP server giving LLMs read-only access to the connected database. Schema introspection, sample queries, data exploration - all through the MCP protocol.

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
