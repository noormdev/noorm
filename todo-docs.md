# Public Documentation Plan (VitePress)


## Core Positioning

**noorm is NOT an ORM.** That's the hook. While ORMs abstract away SQL, noorm embraces it.

> "Write SQL for your database. noorm handles the plumbing—tracking what ran, securing credentials, coordinating your team."

This anti-ORM positioning differentiates immediately in a crowded market.


## Recommended Structure

```
.
├── index.md                          # Hero + quick value props
├── getting-started/
│   ├── installation.md
│   ├── first-build.md               # 5-minute success path
│   └── concepts.md                  # Mental model primer
├── guide/
│   ├── writing-sql/
│   │   ├── file-organization.md
│   │   ├── templates.md             # Eta templating
│   │   └── best-practices.md
│   ├── managing-environments/
│   │   ├── configs.md
│   │   ├── stages.md
│   │   └── secrets.md
│   ├── migrations/
│   │   ├── changesets.md
│   │   ├── rollbacks.md
│   │   └── team-workflows.md
│   ├── team-collaboration/
│   │   ├── identity.md
│   │   ├── secure-sharing.md
│   │   └── locks.md
│   └── ci-cd/
│       ├── headless-mode.md
│       └── github-actions.md
├── reference/
│   ├── cli-commands.md
│   ├── sdk-api.md
│   ├── settings-yml.md
│   └── environment-variables.md
├── tutorials/
│   ├── test-database-setup.md       # Vitest integration
│   ├── production-deploy.md
│   └── multi-environment-workflow.md
└── why-noorm.md                      # Philosophy page
```


## Common Themes

### 1. SQL-First Philosophy

- "You know SQL. Use it."
- No query builders abstracting your intent
- Full power of your dialect (PostgreSQL, MySQL, MSSQL, SQLite)

### 2. Safety Without Friction

- Protected configs prevent accidental prod disasters
- Change detection means idempotent builds
- Dry-run everything before committing

### 3. Team-Ready from Day One

- Encrypted credentials never leak
- Identity tracking shows who did what
- Locks prevent concurrent migration collisions

### 4. Works Where You Work

- Beautiful TUI when you're exploring
- Headless mode for CI/CD
- SDK for test suites and scripts


## Landing Page Structure

```
┌─────────────────────────────────────────────────────────────────┐
│  [Hero]                                                          │
│  "Database Schema Management That Respects Your SQL"            │
│                                                                  │
│  • No ORM abstractions                                          │
│  • Encrypted credential management                              │
│  • Team coordination built-in                                   │
│                                                                  │
│  [Get Started] [GitHub]                                         │
├─────────────────────────────────────────────────────────────────┤
│  [Terminal GIF/Video: running noorm, showing TUI]               │
│  Caption: "A real database tool, not another config file."      │
├─────────────────────────────────────────────────────────────────┤
│  [Three Pillars - with icons]                                   │
│                                                                  │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐                      │
│  │  Track   │  │  Secure  │  │  Team    │                      │
│  │ Changes  │  │  Creds   │  │  Sync    │                      │
│  └──────────┘  └──────────┘  └──────────┘                      │
├─────────────────────────────────────────────────────────────────┤
│  [Code Snippet: Basic workflow]                                 │
│                                                                  │
│  # Structure your SQL                                           │
│  sql/                                                           │
│    tables/users.sql                                             │
│    views/active_users.sql                                       │
│                                                                  │
│  # Run it                                                       │
│  noorm run build                                                │
│  ✓ Executed 2 files                                            │
│  ✓ Skipped 0 (unchanged)                                       │
├─────────────────────────────────────────────────────────────────┤
│  [Use Cases Grid - 4 boxes]                                     │
│                                                                  │
│  "For Development"     "For Testing"                            │
│   Quick schema          Vitest                                  │
│   iteration            integration                              │
│                                                                  │
│  "For CI/CD"           "For Teams"                              │
│   Headless mode,        Secure config                           │
│   JSON output          sharing                                   │
└─────────────────────────────────────────────────────────────────┘
```


## Visual/Media Opportunities

| Location | Media Type | Content |
|----------|------------|---------|
| Landing hero | **Animated terminal** | `noorm` TUI launching, navigating screens |
| Getting Started | **Short video (60s)** | From `npm install` to first successful build |
| Config management | **Screenshot** | TUI config list with stages, status indicators |
| Changesets | **Diagram** | Forward/revert lifecycle flowchart |
| Team workflow | **Diagram** | Alice encrypts → Bob decrypts flow |
| CI/CD section | **Code snippet** | GitHub Actions YAML with annotations |
| Explore section | **Screenshot** | Schema browser TUI showing table detail |
| SQL Terminal | **GIF** | Interactive query, results, history |


## Progressive Disclosure Strategy

### Layer 1 - Landing + Getting Started (2 minutes)

- What is noorm?
- `npm install`, `noorm init`, `noorm run build`
- Success = they ran something

### Layer 2 - Guide sections (30 minutes)

- Writing SQL files
- Managing environments
- Basic migrations

### Layer 3 - Advanced topics (as needed)

- Team identity/sharing
- Custom settings rules
- SDK integration


## Key Pages to Write Differently

### "Why noorm?" page

This should be editorial, not technical:

- ORMs promise productivity but deliver abstraction tax
- You already know SQL—why learn a query DSL?
- The real problems: tracking, credentials, coordination
- noorm solves those without replacing your SQL

### "Getting Started: First Build"

This must be a 5-minute victory:

1. Install
2. Create one SQL file
3. Run build
4. See it tracked
5. Change file, run again, see change detection
6. Done—they understand the value prop

### "Test Database Setup"

Tutorial that shows SDK integration with Vitest:

```typescript
import { createContext, Context } from 'noorm'
import { beforeAll, afterAll, beforeEach, describe, it, expect } from 'vitest'

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

This demonstrates practical value beyond the TUI.


## What to Omit or Minimize

- Internal architecture (observer events, module organization)
- TypeScript interface definitions (put in Reference, not guides)
- Deep dives on encryption implementation
- Code examples showing internal APIs

The existing docs are excellent for contributors/maintainers. Public docs should focus on **outcomes**, not implementation.


## Hero Tagline Options

1. "SQL without the ceremony"
2. "Database schema management for teams that write real SQL"
3. "Track changes. Secure credentials. Stay in your terminal."
4. "The database tool that doesn't replace your SQL"
