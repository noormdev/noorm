# noorm TODO


## Priority 1: TypeScript SDK

JavaScript/TypeScript SDK for programmatic access to noorm-managed databases. Use cases include test suites, scripts, migrations, data pipelines, and building application SDKs.

**Packaging:** Must be bundleable as a standalone package without TUI dependencies (ink, react, etc.). Users who only need the SDK shouldn't pull in terminal UI code.

```
noorm                  # Full package (CLI + TUI + SDK)
noorm/sdk              # SDK-only entrypoint (no TUI dependencies)
```

**Architecture:** SDK context should be an `ObservableChild` of the `ObserverEngine` instance. See <https://logosdx.dev/packages/observer.html#observe>

```typescript
const ctx = observer.observe(createContext({ config: 'dev' }))
// ctx now emits events through the observer system
```


### API Design

```typescript
import { createContext } from 'noorm'

// General usage - load config and connect
const ctx = await createContext({
    config: 'dev',                // Config name
    projectRoot: process.cwd(),   // Optional, defaults to cwd
})

// For tests - require isTest flag on config (safety guard)
const ctx = await createContext({
    config: 'test',
    requireTest: true,            // Refuses if config.isTest !== true
})

// With typed database schema (Kysely generics)
interface Database {
    users: {
        id: number
        name: string
        email: string
    }
    posts: {
        id: number
        user_id: number
        title: string
    }
}

const ctx = await createContext<Database>({ config: 'dev' })

// ctx.kysely is now Kysely<Database> - full type safety
const users = await ctx.kysely
    .selectFrom('users')
    .select(['id', 'name'])       // Autocomplete works
    .where('email', '=', email)   // Type-checked
    .execute()

// Lifecycle
await ctx.connect()           // Establish connection
await ctx.disconnect()        // Close connection

// Database operations
await ctx.truncate()          // Wipe all data, keep schema
await ctx.teardown()          // Drop all user objects
await ctx.build()             // Run full schema build
await ctx.reset()             // teardown + build (idempotent rebuild)

// Changesets
await ctx.applyChangeset('2024-01-15-add-users')
await ctx.revertChangeset('2024-01-15-add-users')
await ctx.fastForward()       // Apply all pending changesets

// SQL execution
const rows = await ctx.query('SELECT * FROM users WHERE active = $1', [true])
await ctx.execute('INSERT INTO users (name) VALUES ($1)', ['Alice'])

// Explore (assertions on schema)
const tables = await ctx.listTables()
const table = await ctx.describeTable('users')
const overview = await ctx.overview()

// Run specific files (relative to sqlDir or absolute paths)
await ctx.runFile('seeds/test-data.sql')                        // Relative to sqlDir
await ctx.runFile('/absolute/path/to/test/fixtures/seed.sql')   // Absolute path for test-local seeds
await ctx.runFiles(['functions/utils.sql', 'triggers/audit.sql'])

// Transaction helpers
await ctx.transaction(async (tx) => {
    await tx.execute('INSERT INTO users (name) VALUES ($1)', ['Bob'])
    await tx.execute('INSERT INTO posts (user_id, title) VALUES ($1, $2)', [1, 'Hello'])
})

// Direct Kysely access for complex queries
const db = ctx.kysely
const result = await db.selectFrom('users').selectAll().execute()
```


### Use Cases

**Test suites (Jest/Vitest):**

```typescript
import { createContext, Context } from 'noorm'

describe('User API', () => {
    let ctx: Context

    beforeAll(async () => {
        ctx = await createContext({ config: 'test', requireTest: true })
        await ctx.connect()
        await ctx.reset()  // Clean slate
    })

    afterAll(async () => {
        await ctx.disconnect()
    })

    beforeEach(async () => {
        await ctx.truncate()  // Wipe between tests
    })

    it('creates a user', async () => {
        await ctx.execute('INSERT INTO users (name) VALUES ($1)', ['Alice'])
        const rows = await ctx.query('SELECT * FROM users')
        expect(rows).toHaveLength(1)
    })
})
```

**Scripts and tooling:**

```typescript
import { createContext } from 'noorm'

// Data export script
const ctx = await createContext({ config: 'prod' })
await ctx.connect()

const users = await ctx.query('SELECT * FROM users WHERE active = true')
await writeJson('users-export.json', users)

await ctx.disconnect()
```

**Application SDK generation:**

```typescript
import { createContext } from 'noorm'

// Introspect schema to generate types
const ctx = await createContext({ config: 'dev' })
await ctx.connect()

const tables = await ctx.listTables()
for (const table of tables) {
    const detail = await ctx.describeTable(table.name)
    generateTypeDefinition(detail)
}

await ctx.disconnect()
```

### Core Functions to Expose

| Category | Functions |
|----------|-----------|
| Lifecycle | `connect()`, `disconnect()`, `reset()` |
| Schema | `build()`, `teardown()`, `truncate()` |
| Changesets | `applyChangeset()`, `revertChangeset()`, `fastForward()`, `getChangesetStatus()`, `getPendingChangesets()` |
| SQL | `query()`, `execute()`, `transaction()` |
| Explore | `listTables()`, `describeTable()`, `overview()` |
| Runner | `runFile()`, `runFiles()`, `runDir()` |
| Config | `config` property (read-only), `testConnection()` |
| Secrets | `getSecret(key)` |
| Locks | `acquireLock()`, `releaseLock()`, `getLockStatus()` |
| Templates | `renderTemplate(path)` - returns SQL without executing |
| History | `getHistory()` - query past executions |
| Settings | `settings` property (read-only) - build paths, stages, rules |
| Identity | `identity` property (read-only) - current operator info |
| Utilities | `computeChecksum(file)` - for custom change detection |
| Raw access | `kysely` property for direct Kysely queries |


### Safety Guards

- **Protected config guard:** Destructive operations (`truncate`, `teardown`, `reset`, `execute` with DML) throw on `protected: true` configs
- `requireTest: true` option refuses to create context if config lacks `isTest: true`
- `allowProtected: true` option explicitly opts in to destructive operations on protected configs (requires confirmation)
- Timeout on long-running operations (configurable)
- Auto-disconnect on process exit

```typescript
// Protected config - read-only operations work
const ctx = await createContext({ config: 'prod' })  // protected: true
await ctx.query('SELECT * FROM users')               // ✓ OK
await ctx.listTables()                               // ✓ OK
await ctx.truncate()                                 // ✗ Throws: "Cannot truncate protected config"

// Explicitly opt-in to destructive operations (use with caution)
const ctx = await createContext({ config: 'prod', allowProtected: true })
await ctx.truncate()                                 // ✓ Allowed (you asked for it)
```


### Implementation Order

1. `createContext()` factory with config loading and safety guards
2. `connect()` / `disconnect()` lifecycle
3. `query()` / `execute()` SQL execution
4. `truncate()` / `teardown()` / `build()` / `reset()`
5. `runFile()` / `runFiles()` (supports absolute paths)
6. Explore functions
7. Changeset operations
8. Transaction helpers

## Priority 2: Headless/CI Mode

Non-interactive command execution for CI pipelines and scripted workflows. Focus on operations developers actually use when automating database management.

**Implementation:** Built on top of the TypeScript SDK. Each command is a thin wrapper that parses args, calls the SDK, and formats output.

**Packaging:** CLI must be bundled into a single JavaScript file for release (esbuild/rollup). No runtime dependency resolution—everything inlined except native modules.

**Scope:** Only operations that require no interaction or at most a single `--yes` confirmation flag. Wizard screens (config setup, identity creation) are explicitly out of scope—those require the TUI.


### Infrastructure

Stub exists at `src/cli/headless.ts`.

**What exists:**

- `HeadlessLogger` class with JSON/human-readable output
- `shouldRunHeadless()` detection (CI env vars, TTY check)
- Event logging infrastructure
- `HANDLERS` registry pattern (empty)

**What's needed:**

- Command parser for CLI arguments
- Handler registration for each command
- Exit codes (0 success, 1 error, 2 validation failure)
- `--yes` flag to skip confirmations
- Output to stdout: JSON logs if `CI=1`, otherwise pretty-printed human-readable
- `--json` flag to force JSON output regardless of environment


### Commands to Implement

**Note:** All commands use the active config unless `--config <name>` is specified.

**Database Reset:**

```bash
noorm db truncate [--config <name>] [--yes]     # Wipe all data, keep schema
noorm db teardown [--config <name>] [--yes]     # Drop all objects
noorm db drop [--config <name>] [--yes]         # Drop entire database
noorm db create [--config <name>]               # Create database if not exists
noorm db reset [--config <name>] [--yes]        # teardown + build (full rebuild)
```

**Execution:**

```bash
noorm run build [--config <name>] [--force]     # Run full schema build
noorm run file <path> [--config <name>]         # Run single SQL file
noorm run dir <path> [--config <name>]          # Run all files in directory
noorm run files <path...> [--config <name>]     # Run specific files
```

**Changesets:**

```bash
noorm change ff [--config <name>]               # Fast-forward all pending
noorm change next [--config <name>]             # Apply next pending changeset
noorm change run <name> [--config <name>]       # Run specific changeset
noorm change revert <name> [--config <name>]    # Revert specific changeset
noorm change status [--config <name>]           # List changeset statuses
```

**Config & Status:**

```bash
noorm config use <name>                         # Set active config
noorm config validate [--config <name>]         # Validate config can connect
noorm config list                               # List available configs
noorm lock status [--config <name>]             # Check lock status
noorm lock release <id> [--config <name>]       # Release a lock
```

**Explore (read-only, useful for CI checks):**

```bash
noorm explore overview [--config <name>]        # Object counts
noorm explore tables [--config <name>]          # List tables
noorm explore table <name> [--config <name>]    # Table detail
```

**SQL Execution:**

```bash
noorm sql <query> [--config <name>]             # Execute raw SQL
noorm sql -f <file> [--config <name>]           # Execute SQL from file
```


### Output Modes

Human-readable (default):

```
✓ Truncated 12 tables in 45ms
  Preserved: __noorm_changeset__, __noorm_executions__
```

JSON (`--json`):

```json
{"success": true, "truncated": 12, "preserved": 2, "durationMs": 45}
```


### Implementation Order

1. Command parser and handler registry
2. `run build` - Most common CI operation
3. `db truncate` / `db teardown` - Test setup
4. `change ff` / `change status` - Migration workflows
5. `config validate` - CI health checks
6. Remaining commands



---

# Pre-Release Checklist

Sanity checks and cleanup before release.

- [ ] **Events audit** - Revisit all observer events, ensure uniform naming and placement, verify all are typed in `NoormEvents`
- [ ] **Test coverage** - Write tests for everything in core (see `TODO-tests.md`)
- [ ] **Cleanup plans** - Remove or archive `plan/` directory contents
- [ ] **Public documentation** - Existing docs are internal/developer-facing. Create public-facing docs oriented around:
    - TUI usage (getting started, screens, workflows)
    - CLI commands (headless mode reference)
    - SDK API (programmatic usage, testing patterns)

---

# Future Roadmap

Features planned after core functionality (SDK + Headless CLI) is complete.


## Near-Term

**Type Generation**
Auto-generate TypeScript interfaces from database schema for use with Kysely generics. Low-hanging fruit—Kysely has codegen tools we can integrate or wrap.

```typescript
noorm generate types [--config <name>] [--output ./types/database.ts]
```

**Watch Mode**
Watch SQL files for changes, auto-rebuild on save. Developer experience for rapid schema iteration.

```typescript
noorm watch [--config <name>]
// Or in SDK
ctx.watch({ onChange: () => console.log('rebuilt') })
```

**Multi-Config Operations**
Run operations across multiple configs in sequence with optional approval gates.

```bash
noorm change ff --configs dev,staging,prod --confirm-each
```

**Documentation Generation**
Generate markdown documentation from schema (tables, columns, relationships, comments).

```bash
noorm generate docs [--config <name>] [--output ./docs/sql.md]
```


## Medium-Term

**Schema Linting**
Static analysis of SQL files for common issues. Implementation approach: parse SQL with a library (e.g., node-sql-parser), apply rule checks.

Potential rules:

- Missing indexes on foreign keys
- Naming convention violations (snake_case, prefixes)
- Missing primary keys
- Wide tables (too many columns)
- Reserved word usage

```bash
noorm lint [path]
```

**Webhooks & Notifications**
Notify external systems on operation completion. Useful for CI/CD visibility.

```yaml
# settings.yml
notifications:
    slack:
        webhook: ${SLACK_WEBHOOK_URL}
        events: [build:complete, change:complete, error]
    email:
        smtp: ${SMTP_URL}
        to: team@example.com
        events: [error]
```

**AI Agent Integration** *(TUI only)*
Detect AI coding tools (Claude Code, Cursor, Codex) and provide context for schema changes. When drift detected or changes needed, generate prompts with proper schema context.

TUI screen flow:
- AI Assistant screen accessible from home (`a`)
- Select operation: suggest change, explain schema, generate migration
- Input natural language description
- View generated prompt with schema context
- Copy to clipboard for use in AI tool


## Long-Term

**Schema Diffing**
Compare expected schema (SQL files) vs actual database state.

Implementation approach:

1. Create temporary shadow database
2. Run full build against shadow
3. Explore shadow DB → serialize to sorted JSON
4. Explore current DB → serialize to sorted JSON
5. Diff the two JSON files
6. Drop shadow database

Dialect-specific temp DB creation:

- PostgreSQL: `CREATE DATABASE __noorm_shadow__{timestamp}`
- MySQL: `CREATE DATABASE __noorm_shadow__{timestamp}`
- MSSQL: `CREATE DATABASE __noorm_shadow__{timestamp}`
- SQLite: `:memory:` or temp file

**CLI:**

```bash
noorm diff [--config <name>]
# Shows: tables missing, extra columns, type mismatches, index differences, etc.
```

**TUI:**

```
┌─────────────────────────────────────────────────────────────┐
│  Schema Diff                                   [dev] ●      │
├─────────────────────────────────────────────────────────────┤
│  Comparing: SQL files → dev database                        │
│                                                              │
│  + users.preferences   (new column)                         │
│  ~ posts.status        varchar(20) → varchar(50)            │
│  - legacy_logs         (table removed from schema)          │
│                                                              │
│  3 differences found                                         │
│                                                              │
│  [Enter] View detail  [r] Refresh  [Esc] Back               │
└─────────────────────────────────────────────────────────────┘
```

**Drift Detection (passive)**
Keep a schema snapshot per config at `.noorm/snapshots/{configName}.json`. Update after successful builds. On TUI launch, compare current DB to snapshot—if different, show drift warning on home screen.

```
┌─────────────────────────────────────────────────────────┐
│  noorm                                    [dev] ●       │
│                                                         │
│  ⚠ Schema drift detected                               │
│    2 tables modified, 1 index added since last build   │
│    Press [d] to view diff                              │
│                                                         │
```

**Backup & Restore**
Snapshot database before destructive operations. Wraps native tools (pg_dump, mysqldump, etc.).

**CLI:**

```bash
noorm backup create [--config <name>] [--output ./backups/]
noorm backup restore <snapshot> [--config <name>]
noorm backup list [--config <name>]
```

**TUI:**

```
┌─────────────────────────────────────────────────────────────┐
│  Backups                                       [dev] ●      │
├─────────────────────────────────────────────────────────────┤
│  1. dev_2024-01-15T10-30-00.sql.gz    (2.3 MB)             │
│  2. dev_2024-01-14T08-15-00.sql.gz    (2.1 MB)             │
│  3. dev_2024-01-13T16-45-30.sql.gz    (2.0 MB)             │
│                                                              │
│  [c] Create backup  [r] Restore  [d] Delete  [Esc] Back    │
└─────────────────────────────────────────────────────────────┘
```

**AI Database Chat** *(TUI only)*
Interactive chat against your database schema and data. Model and provider configured in `noorm.config.ts`.

```
┌─────────────────────────────────────────────────────────────┐
│  AI Chat                                       [dev] ●      │
├─────────────────────────────────────────────────────────────┤
│  You: What tables reference users?                          │
│                                                              │
│  AI: The users table is referenced by:                      │
│      • posts.user_id (FK)                                   │
│      • comments.author_id (FK)                              │
│      • sessions.user_id (FK)                                │
│                                                              │
│  You: Show me the most recent orders                        │
│  AI: [generating...]                                        │
│                                                              │
│  ──────────────────────────────────────────────────────────│
│  > Why might this query be slow?█                           │
│                                                              │
│  [Enter] Send  [Shift+O] Open in browser  [Esc] Back        │
└─────────────────────────────────────────────────────────────┘
```

**Browser Export (Shift+O):**
Renders chat as styled HTML and opens in default browser for sharing/printing.

1. Parse markdown file, extract `<user>` and `<agent>` blocks
2. Render markdown to HTML via GitHub API (`POST /markdown`)
3. Wrap in HTML template with CDN stylesheet (e.g., github-markdown-css) + inline styles for user/agent bubbles
4. Write to `/tmp/noorm-chat-{id}.html` (discarded on system restart)
5. Open with `open` (macOS) / `xdg-open` (Linux) / `start` (Windows)

**Agent Tools:**

| Tool | Description |
|------|-------------|
| `explore_overview` | Get database object counts and summary |
| `explore_tables` | List all tables with row counts |
| `explore_table` | Get table detail (columns, indexes, FKs) |
| `query_table` | Sample data from a table (with limit) |
| `list_changesets` | Get changeset status and history |
| `list_configs` | Get available configs (names only, no credentials) |
| `get_secret_keys` | List secret keys (values masked) |
| `read_schema_file` | Read SQL file from schema directory |
| `list_schema_files` | List files in schema directory |
| `get_settings` | Get build rules, stages, paths |
| `get_execution_history` | Recent file/changeset executions |
| `run_query` | Execute read-only SQL (SELECT only) |

The agent has full context about noorm's architecture, commands, and workflows baked into its system prompt. It can guide users through operations, explain schema decisions, and suggest migrations.

**Storage:** Chats saved to `.noorm/chats/{timestamp}-{slug}.md` for history and parsing:

```markdown
# Chat: 2024-01-15 10:30

Config: dev
Database: myapp_dev (postgres)

---

<user>
What tables reference users?
</user>

<agent>
The users table is referenced by:
- posts.user_id (FK)
- comments.author_id (FK)
- sessions.user_id (FK)
</agent>

<user>
Show me the most recent orders
</user>

<agent>
Here's a query to get recent orders:

```sql
SELECT * FROM orders ORDER BY created_at DESC LIMIT 10;
```
</agent>
```

**Plugin System & Configuration**
Extensibility for custom dialects, operations, and integrations. Also serves as the home for AI and advanced feature configuration.

```typescript
// noorm.config.ts
import { defineConfig } from 'noorm'

export default defineConfig({
    // AI feature configuration
    ai: {
        provider: 'anthropic',  // 'anthropic' | 'openai' | 'ollama'
        model: 'claude-sonnet-4-20250514',
        apiKey: process.env.ANTHROPIC_API_KEY,
        // Provider-specific options
        baseUrl: undefined,     // For ollama or custom endpoints
        maxTokens: 4096,
    },

    // Plugin system
    plugins: [
        '@noormdev/plugin-redshift',
        './my-custom-plugin',
    ],

    // Hook into lifecycle events
    hooks: {
        'build:before': async (ctx) => { /* ... */ },
        'build:after': async (ctx) => { /* ... */ },
    },
})
```

The config file is optional—noorm works without it. When present, it's loaded at startup and merged with settings.yml.


---

## Completed Features

| Feature | Core | UI | Docs |
|---------|------|----|------|
| Config management | ✓ | ✓ 9 screens | ✓ |
| Changeset management | ✓ | ✓ 11 screens | ✓ |
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


## Implementation History

Core modules were implemented in phases:

1. **Utilities** - Observer, logger, lifecycle
2. **Foundation** - State, connection, config, settings, version
3. **Core Features** - Identity, lock, template
4. **Execution** - Runner, changeset
5. **CLI** - All screens implemented
6. **Database Tools** - Explore, teardown, SQL terminal, log viewer

See `plan/` directory for detailed implementation plans used during development.
