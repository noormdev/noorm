# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.


## Commands

```bash
# Build/Test
npm run build
npm run test
npm run test:watch              # Watch mode
npm run test:coverage

# Development
npm run dev                     # Watch mode with ts-node
npm run lint
npm run typecheck
```


## Architecture

**noorm** - Database Schema & Changeset Manager with Ink/React TUI.


### Project Structure

```
noorm/
├── src/
│   ├── core/                   # Business logic (no UI dependencies)
│   │   ├── observer.ts         # Central event system (@logosdx/observer)
│   │   ├── config/             # Config management, state persistence
│   │   ├── connection/         # Kysely connection factory
│   │   ├── changeset/          # Changeset parsing, execution
│   │   ├── runner/             # SQL file execution, tracking
│   │   ├── lock/               # Concurrent operation locking
│   │   ├── template/           # Eta templating, data loading
│   │   ├── identity/           # User identity resolution
│   │   ├── db/                 # Database lifecycle (create/destroy)
│   │   └── encryption/         # AES-256-GCM, machine ID
│   │
│   ├── cli/                    # Ink/React TUI
│   │   ├── app.tsx             # Root component, router
│   │   ├── commands/           # Screen components by feature
│   │   │   ├── config/         # Config screens (add, edit, rm, list, cp, use)
│   │   │   ├── change/         # Changeset screens (add, edit, rm, run, revert, next, ff)
│   │   │   ├── run/            # Run screens (build, file, dir)
│   │   │   ├── db/             # DB screens (create, destroy)
│   │   │   └── lock/           # Lock screens (status, release)
│   │   ├── components/         # Shared UI components
│   │   ├── hooks/              # React hooks (useEvent, useProgress, useLockStatus)
│   │   └── headless.ts         # CI/CD JSON output mode
│   │
│   └── env/                    # Environment variable loading
│
├── plan/                       # Detailed planning documents
│   ├── README.md               # Plan index
│   ├── utils.md                # Observer, attempt, retry, batch patterns
│   └── *.md                    # Domain-specific plans
│
├── tests/                      # Test suite
└── plan.md                     # High-level project overview
```


### Tech Stack

- **Kysely** - SQL query builder & executor
- **Eta** - Templating engine for dynamic SQL
- **Ink + React** - CLI interface
- **@logosdx/observer** - Event system
- **@logosdx/utils** - Error tuples, retry, batch utilities


### Key Architectural Principles

- **Core modules emit events, CLI subscribes** - Clean separation via observer
- **No dialect abstraction** - You write SQL for your target database
- **Encrypted local state** - Configs stored in `.noorm/state.enc`
- **Headless mode** - CI/CD support with JSON output


## Core Principles

**Safety**: Do not try something that might fail, except for I/O and network operations.
**Error Handling**: We prefer `attempt`/`attemptSync` instead of try-catch.
**Dogfooding**: Always use `@logosdx/utils` and `@logosdx/observer` throughout.
**Function Structure**: Declaration -> Validation -> Business Logic -> Commit
**Style**: Meaningful names, JSDoc that explains WHY with examples, newlines after block open.


### Syntax & Formatting

- Newline after function declaration and opening blocks:

    ```ts
    function doSomething() {

        // logic
    }

    if (condition) {

        // logic
    }
    else {

        // logic
    }

    for (const item of items) {

        // logic
    }
    ```

- Prefer vertical space over horizontal for long functions. Max 100 characters per line.
- Functions should follow this 4-block structure in order:
  1. **Declaration**: Declare everything needed to execute the function.
  2. **Validation**: Validate input parameters (prevents failures).
  3. **Business Logic**: The main logic of the function.
  4. **Commit**: Anything that will affect the state of the application.


### Function Structure Example

```ts
async function executeFile(filepath: string, configName: string): Promise<FileResult> {

    // Declaration
    const start = performance.now()

    // Validation
    if (!filepath.endsWith('.sql') && !filepath.endsWith('.sql.eta')) {

        throw new InvalidFileError(`Not a SQL file: ${filepath}`)
    }

    // Business Logic
    const checksum = await computeChecksum(filepath)
    const existing = await getFileRecord(filepath, configName)

    if (existing?.checksum === checksum) {

        observer.emit('file:skip', { filepath, reason: 'unchanged' })
        return { filepath, skipped: true }
    }

    observer.emit('file:before', { filepath, checksum, configName })

    const sql = await renderTemplate(filepath)
    const [_, err] = await attempt(() => executor.run(sql))

    if (err) {

        observer.emit('file:after', {
            filepath,
            status: 'failed',
            durationMs: performance.now() - start,
            error: err.message
        })
        throw err
    }

    // Commit
    await recordFileExecution(filepath, checksum, configName)

    observer.emit('file:after', {
        filepath,
        status: 'success',
        durationMs: performance.now() - start
    })

    return { filepath, skipped: false }
}
```


## Key Patterns


### Error Tuples (not try-catch)

```ts
import { attempt } from '@logosdx/utils'

// I/O operations use error tuples
const [result, err] = await attempt(() => db.execute(sql))
if (err) {

    observer.emit('error', { source: 'executor', error: err })
    return
}

// Business logic throws directly (no attempt wrapper)
function validateConfig(config: Config): void {

    if (!config.name) throw new ValidationError('Name required')
    if (!config.connection) throw new ValidationError('Connection required')
}
```


### Retry for Flaky Operations

```ts
import { retry, attempt } from '@logosdx/utils'

const connect = retry(
    async () => {

        const db = new Kysely({ dialect: createDialect(config) })
        await sql`SELECT 1`.execute(db)
        return db
    },
    {
        retries: 3,
        delay: 1000,
        backoff: 2,
        shouldRetry: (err) => {

            if (err.message.includes('authentication')) return false
            return err.message.includes('ECONNREFUSED')
        }
    }
)

const [db, err] = await attempt(connect)
```


### Batch for Bulk Operations

```ts
import { batch, attempt } from '@logosdx/utils'

const results = await batch(
    async (filepath: string) => {

        const [result, err] = await attempt(() => executeFile(filepath))
        if (err) throw err
        return result
    },
    {
        items: files,
        concurrency: 1,           // Sequential for DDL
        failureMode: 'abort',
        onError: (err, filepath) => {

            observer.emit('error', { source: 'build', error: err, context: { filepath } })
        }
    }
)
```


### Observer Events

```ts
import { observer } from './observer'

// Emit events at key points
observer.emit('file:before', { filepath, checksum, configName })
observer.emit('file:after', { filepath, status: 'success', durationMs })
observer.emit('error', { source: 'runner', error: err })

// Subscribe in CLI/hooks
const cleanup = observer.on('file:after', (data) => updateProgress(data))

// Pattern matching
observer.on(/^file:/, ({ event, data }) => logFileEvent(event, data))

// Cleanup in React
useEffect(() => {

    const cleanup = observer.on('build:complete', handleComplete)
    return cleanup
}, [])
```


### Class Patterns

```ts
export class StateManager {

    #state: State | null = null
    #key: Buffer | null = null

    async load(): Promise<void> {

        const encrypted = await readFile(STATE_PATH)
        const [state, err] = await attempt(() => decrypt(encrypted, this.#key))
        if (err) throw err

        this.#state = state
        observer.emit('state:loaded', {
            configCount: Object.keys(state.configs).length,
            activeConfig: state.activeConfig
        })
    }
}

export namespace StateManager {

    export interface Config {
        name: string
        connection: ConnectionConfig
        paths: PathConfig
        protected?: boolean
    }
}
```


## Testing

- Test all paths (success, error, edge cases)
- Use `describe('module: feature', () => {})` naming
- Tests live in `tests/` folder

```ts
import { attempt } from '@logosdx/utils'

describe('runner: executeFile', () => {

    it('should skip unchanged files', async () => {

        // setup...
        const result = await executeFile(filepath, configName)
        expect(result.skipped).toBe(true)
    })

    it('should emit error event on failure', async () => {

        const events: any[] = []
        observer.on('file:after', (data) => events.push(data))

        const [_, err] = await attempt(() => executeFile(badFile, configName))

        expect(err).toBeInstanceOf(Error)
        expect(events[0].status).toBe('failed')
    })
})
```


## Documentation

Documentation in `/docs` follows a three-pillar structure:

| Pillar | Purpose | Expression |
|--------|---------|------------|
| Memory | The what - concepts, definitions, data structures | Clear explanations of what exists |
| Reasoning | The why - motivation, trade-offs, design decisions | Context for why choices were made |
| Example | The how - concrete usage, code samples, workflows | Practical demonstrations |

These pillars are invisible scaffolding. Documentation reads naturally without explicitly naming them. Each section weaves all three together: introduce a concept (memory), explain its purpose (reasoning), show it in action (example).

**Style:**
- Conversational but precise - explain through analogy before technical detail
- Problem-first framing - start with what the reader wants to solve
- Code follows explanation - show "why" before "how"
- Short sentences mixed with longer explanations
- Visual hierarchy through headers, code blocks, tables


## Checklist

**Required**:

- [ ] Prefer attempt/attemptSync over try-catch
- [ ] Validate anything used in business logic
- [ ] Only use attempt() for I/O operations, not business logic
- [ ] Use @logosdx/utils for error handling, retry, batch
- [ ] Use @logosdx/observer for all events
- [ ] Emit observer events at key lifecycle points
- [ ] JSDoc with examples explaining WHY
- [ ] 4-block function structure
- [ ] Meaningful names that read in clear English
- [ ] Newline after opening braces

**Anti-patterns**:

- [ ] try-catch blocks (use attempt instead)
- [ ] Error tuple for pure business logic
- [ ] Missing error handling in async ops
- [ ] Direct console.log in core modules (use observer events)
- [ ] Dialect-specific SQL abstractions (user writes their own SQL)
