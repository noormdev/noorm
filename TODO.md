# noorm TODO


## Priority 1: Separate Schema for Internal Tables

Move `__noorm_*` tables to a dedicated `noorm` schema on dialects that support it. Keeps user schema clean and avoids naming collisions.

**Dialect support:**

| Dialect | Schema Support | Action |
|---------|----------------|--------|
| PostgreSQL | ✓ | Create `noorm` schema, move tables |
| MSSQL | ✓ | Create `noorm` schema, move tables |
| MySQL | ✗ (database = schema) | No change needed |
| SQLite | ✗ | No change needed |

**Implementation:**

- [ ] Create schema on first run if not exists
- [ ] Migrate existing `__noorm_*` tables to new schema
- [ ] Update all internal queries to use schema-qualified names
- [ ] Handle upgrade path for existing installations


## Priority 2: Secrets Vault

Encrypted secrets storage for shared databases and team environments. When multiple developers work against a shared database, they need access to secrets (API keys, service credentials) without manual distribution.

**Architecture:**

- New `__noorm_secrets__` table stores encrypted secrets per-user
- Secrets encrypted using recipient's cryptographic identity (keypair)
- Two-level model:
  - **Configuration**: Declares required secret keys in `settings.yml`
  - **Setting**: Actual secret values, encrypted per-user
- **Staleness detection**: Store SHA of entire secrets object; on TUI launch, compare against user's local secrets SHA. If different and user has entrusted secrets, show warning: "Your secrets are out of sync"

**Workflow:**

```bash
# Admin sets a secret (encrypts for all team members)
noorm secrets set API_KEY "sk-live-..." --recipients alice,bob,carol

# Team member syncs secrets to their local environment
noorm secrets sync

# Re-run after key rotation or new team members
noorm secrets set API_KEY "sk-live-new..." --recipients alice,bob,carol,dave
```

**Implementation:**

1. Create `__noorm_secrets__` table schema (key, encrypted_value, recipient_hash, created_at)
2. Add secrets encryption using existing cryptographic identity system
3. Build `noorm secrets set` command with recipient selection
4. Build `noorm secrets sync` command to pull and decrypt user's secrets
5. Integrate with existing stage secrets (auto-populate from vault)


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


## CLI Auto-Update

Check for updates on CLI startup and prompt user to update.


## NVM Node Version Persistence

Global npm packages don't persist when switching Node versions with nvm. Users lose their `noorm` installation.

**Research findings:**

Our database drivers (`pg`, `tedious`, `mysql2`, `tarn`) are pure JavaScript - bundling is technically feasible. The problem child is `better-sqlite3` which requires native C++ bindings.

| Bundling Tool | Status | Native Module Support |
|---------------|--------|----------------------|
| Bun compile | Active | Built-in `Bun.sql` for Postgres/MySQL/SQLite (Zig) - would require Kysely migration |
| vercel/pkg | Archived Jan 2024 | Ships alongside executable, not embedded |
| Node.js SEA | Experimental | Ships alongside executable, not embedded |

**Practical options (in order of effort):**

1. Document `npx noorm` as primary usage (zero effort)
2. Document `nvm reinstall-packages` in install instructions
3. Publish to Homebrew for macOS users (nvm-independent)
4. Investigate Bun compile if/when migrating to `Bun.sql` makes sense

**Behavior:**

- On TUI launch, check NPM registry for latest version (if online)
- If newer version available, show prompt: "Update available (v1.2.3 → v1.3.0). Update now? [y/n]"
- Option to enable auto-update in settings (skip prompt, update automatically)
- Respect offline mode / skip if no network

**Settings:**

```yaml
# settings.yml
cli:
    autoUpdate: false      # true = update without asking
    checkUpdates: true     # false = disable update checks entirely
```


## SDK Finish Line

Core SDK is implemented and packaged (`@noormdev/sdk`). Remaining:

- [ ] **SDK test coverage** - Dedicated tests for SDK surface (`createContext`, lifecycle, operations)
- [ ] **Test mode enforcement** - When `requireTest: true`, SDK must refuse to connect if `config.isTest !== true`
- [ ] **Protected config hard block** - Destructive operations (destroy, truncate, teardown) on protected configs are denied with no override. User must perform manually. Remove `allowProtected` option entirely.


## Headless CLI Gaps

32 handlers implemented. Missing commands:

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

**Backup & Restore** - Snapshot database before destructive operations using native tools (pg_dump, mysqldump).

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
| **TypeScript SDK** | ✓ | N/A | Pending |
| **Headless CLI** | ✓ (70%) | N/A | Pending |
