# noorm Documentation


## What is noorm?

noorm is a database schema and changeset manager. It tracks which SQL files have run, manages database credentials securely, and coordinates team access to shared databases.

Unlike ORMs that abstract away SQL, noorm embraces it. You write SQL for your target database. noorm handles the plumbing: tracking execution, managing credentials, coordinating team access.


## Core Concepts


### Identity

Every database operation records who performed it. noorm supports two identity modes:

- **Audit identity** - Simple name/email for tracking (auto-detected from git)
- **Cryptographic identity** - X25519 keypair for secure credential sharing

[Read more about Identity](./identity.md)


### State

All sensitive data lives in an encrypted state file. This includes database credentials, secrets for SQL templates, and your cryptographic identity.

- AES-256-GCM encryption
- Identity-based or machine-based key derivation
- Automatic schema migrations

[Read more about State Management](./state.md)


### Configuration

Configs define database connections. They merge from multiple sources with clear precedence:

```
CLI flags > Environment > Stored config > Stage defaults > Defaults
```

Protected configs require confirmation for dangerous operations. Stages enforce team-wide constraints.

[Read more about Configuration](./config.md)


## Quick Start

```typescript
import { StateManager } from './core/state'
import { resolveConfig } from './core/config'
import { resolveIdentity } from './core/identity'

// Load encrypted state
const state = new StateManager(process.cwd())
await state.load()

// Resolve current identity
const identity = await resolveIdentity()
console.log(`Running as: ${identity.name}`)

// Get active config
const config = resolveConfig(state)
if (!config) {
    console.error('No config found. Run: noorm config add')
    process.exit(1)
}

console.log(`Using database: ${config.connection.database}`)
```


## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                        CLI (Ink/React)                   │
│  Commands, UI components, user interaction               │
└────────────────────────────┬────────────────────────────┘
                             │ subscribes to events
                             ▼
┌─────────────────────────────────────────────────────────┐
│                     Observer (Events)                    │
│  file:*, build:*, config:*, state:*, template:*, lock:* │
│  teardown:*, sql-terminal:*, changeset:*, explore:*     │
└────────────────────────────┬────────────────────────────┘
                             │ emits events
                             ▼
┌─────────────────────────────────────────────────────────┐
│                      Core Modules                        │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌────────┐ │
│  │ Identity │  │  State   │  │  Config  │  │  Lock  │ │
│  │ X25519   │  │ Encrypted│  │ Merge &  │  │Concur- │ │
│  │ Keypairs │  │ Storage  │  │ Validate │  │ rency  │ │
│  └──────────┘  └──────────┘  └──────────┘  └────────┘ │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌────────┐ │
│  │ Template │  │  Runner  │  │Changeset │  │ Logger │ │
│  │ Eta, SQL │  │ Execute, │  │ Versioned│  │ Events │ │
│  │ Helpers  │  │ Tracking │  │ Migrations│  │Rotation│ │
│  └──────────┘  └──────────┘  └──────────┘  └────────┘ │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐             │
│  │ Explore  │  │ Teardown │  │   SQL    │             │
│  │ Schema   │  │ Truncate │  │ Terminal │             │
│  │ Browser  │  │  & Drop  │  │   REPL   │             │
│  └──────────┘  └──────────┘  └──────────┘             │
└─────────────────────────────────────────────────────────┘
```

Core modules emit events. The CLI subscribes. This keeps business logic separate from UI concerns.


## File Structure

```
.noorm/
├── state.enc         # Encrypted configs, secrets, identity (gitignored)
├── settings.yml      # Build rules, stages (version controlled)
├── noorm.log         # Operation log (gitignored)
└── sql-history/      # SQL terminal history (gitignored)
    ├── dev.json      # History index per config
    └── dev/          # Gzipped query results
        └── *.results.gz

~/.noorm/
├── identity.key      # Private key (mode 600)
└── identity.pub      # Public key (mode 644)
```


## Documentation Index


### Core

| Document | Description |
|----------|-------------|
| [Data Model](./datamodel.md) | Complete type reference, database schemas, file formats |
| [Identity](./identity.md) | Audit tracking, cryptographic identity, secure sharing |
| [State](./state.md) | Encrypted storage, configs, secrets, persistence |
| [Config](./config.md) | Resolution, validation, protection, stages |
| [Secrets](./secrets.md) | Encrypted secrets, required vs optional, CLI workflow |
| [Settings](./settings.md) | Build rules, stages, project-wide behavior |


### Execution

| Document | Description |
|----------|-------------|
| [Runner](./runner.md) | SQL execution, change detection, dry run, preview |
| [Changeset](./changeset.md) | Versioned migrations, forward/rollback, execution history |
| [Template](./template.md) | Eta templating, data loading, helper inheritance |
| [Lock](./lock.md) | Concurrent operation protection, table-based locking |


### Database Tools

| Document | Description |
|----------|-------------|
| [Explore](./explore.md) | Schema introspection, browse tables/views/functions |
| [Teardown](./teardown.md) | Data truncation, schema teardown, reset operations |
| [SQL Terminal](./sql-terminal.md) | Interactive SQL REPL, query history, result storage |


### Operations

| Document | Description |
|----------|-------------|
| [Logger](./logger.md) | File logging, log viewer, event classification, rotation |


## Key Patterns

**Error Handling** - Uses `attempt`/`attemptSync` from `@logosdx/utils` instead of try-catch:

```typescript
const [result, err] = await attempt(() => dangerousOperation())
if (err) {
    observer.emit('error', { source: 'module', error: err })
    return
}
```

**Events** - Core modules emit, CLI subscribes:

```typescript
// In core module
observer.emit('config:created', { name })

// In CLI
observer.on('config:created', ({ name }) => {
    console.log(`Created: ${name}`)
})
```

**Layered Configuration** - Multiple sources merge predictably:

```typescript
// defaults ← stage ← stored ← env ← flags
const config = resolveConfig(state, { flags: { connection: { port: 5433 } } })
```
