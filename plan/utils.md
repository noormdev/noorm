# Utils


## Observer

Central event system for noorm using `@logosdx/observer`. Core modules emit events, CLI subscribes.


### Event Shape

```typescript
// src/core/observer.ts
import { ObserverEngine } from '@logosdx/observer'

export interface NoormEvents {
    // File execution
    'file:before': { filepath: string; checksum: string; configName: string }
    'file:after': { filepath: string; status: 'success' | 'failed'; durationMs: number; error?: string }
    'file:skip': { filepath: string; reason: 'unchanged' | 'already-run' }

    // Changeset lifecycle
    'changeset:start': { name: string; direction: 'change' | 'revert'; files: string[] }
    'changeset:file': { changeset: string; filepath: string; index: number; total: number }
    'changeset:complete': { name: string; direction: 'change' | 'revert'; status: 'success' | 'failed'; durationMs: number }

    // Build/Run
    'build:start': { schemaPath: string; fileCount: number }
    'build:complete': { status: 'success' | 'failed'; filesRun: number; filesSkipped: number; durationMs: number }
    'run:file': { filepath: string; configName: string }
    'run:dir': { dirpath: string; fileCount: number; configName: string }

    // Lock
    'lock:acquiring': { configName: string; identity: string }
    'lock:acquired': { configName: string; identity: string; expiresAt: Date }
    'lock:released': { configName: string; identity: string }
    'lock:blocked': { configName: string; holder: string; heldSince: Date }
    'lock:expired': { configName: string; previousHolder: string }

    // State
    'state:loaded': { configCount: number; activeConfig: string | null }
    'state:persisted': { configCount: number }

    // Config
    'config:created': { name: string }
    'config:updated': { name: string; fields: string[] }
    'config:deleted': { name: string }
    'config:activated': { name: string; previous: string | null }

    // Secrets
    'secret:set': { configName: string; key: string }
    'secret:deleted': { configName: string; key: string }

    // DB lifecycle
    'db:creating': { configName: string; database: string }
    'db:created': { configName: string; database: string; durationMs: number }
    'db:destroying': { configName: string; database: string }
    'db:destroyed': { configName: string; database: string }
    'db:bootstrap': { configName: string; tables: string[] }

    // Template
    'template:render': { filepath: string; durationMs: number }
    'template:load': { filepath: string; format: 'json' | 'yaml' | 'csv' | 'js' | 'sql' }

    // Identity
    'identity:resolved': { name: string; email?: string; source: 'git' | 'system' | 'config' | 'env' }

    // Connection
    'connection:open': { configName: string; dialect: string }
    'connection:close': { configName: string }
    'connection:error': { configName: string; error: string }

    // Errors
    'error': { source: string; error: Error; context?: Record<string, unknown> }
}
```


### Observer Instance

```typescript
// src/core/observer.ts
export const observer = new ObserverEngine<NoormEvents>({
    name: 'noorm',
    spy: process.env.NOORM_DEBUG
        ? (action) => console.error(`[noorm:${action.fn}] ${String(action.event)}`)
        : undefined
})

export type { ObserverEngine }
```


### Usage in Core Modules

Each core module imports the observer and emits events at key points.

#### State Manager (state.md)

```typescript
import { observer } from './observer'

class StateManager {
    async load(): Promise<void> {
        // ... decryption
        observer.emit('state:loaded', {
            configCount: Object.keys(this.state.configs).length,
            activeConfig: this.state.activeConfig
        })
    }

    async setConfig(name: string, config: Config): Promise<void> {
        const isNew = !this.state?.configs[name]
        // ... persist
        observer.emit(isNew ? 'config:created' : 'config:updated', {
            name,
            fields: Object.keys(config)
        })
    }

    async setActiveConfig(name: string): Promise<void> {
        const previous = this.state!.activeConfig
        // ... persist
        observer.emit('config:activated', { name, previous })
    }

    async deleteConfig(name: string): Promise<void> {
        // ... persist
        observer.emit('config:deleted', { name })
    }

    async setSecret(configName: string, key: string, value: string): Promise<void> {
        // ... persist
        observer.emit('secret:set', { configName, key })
    }
}
```

#### Connection Factory (connection.md)

```typescript
import { observer } from './observer'

async function createConnection(config: Config): Promise<Kysely<unknown>> {
    observer.emit('connection:open', {
        configName: config.name,
        dialect: config.connection.dialect
    })
    // ... create Kysely instance
}

async function closeConnection(configName: string): Promise<void> {
    // ... close
    observer.emit('connection:close', { configName })
}
```

#### Lock Manager (lock.md)

```typescript
import { observer } from './observer'

class LockManager {
    async acquire(configName: string, identity: string, timeoutMs = 600000): Promise<boolean> {
        observer.emit('lock:acquiring', { configName, identity })

        const existing = await this.checkLock(configName)

        if (existing && !this.isExpired(existing)) {
            observer.emit('lock:blocked', {
                configName,
                holder: existing.lockedBy,
                heldSince: existing.lockedAt
            })
            return false
        }

        if (existing && this.isExpired(existing)) {
            observer.emit('lock:expired', {
                configName,
                previousHolder: existing.lockedBy
            })
        }

        const expiresAt = new Date(Date.now() + timeoutMs)
        await this.setLock(configName, identity, expiresAt)
        observer.emit('lock:acquired', { configName, identity, expiresAt })
        return true
    }

    async release(configName: string, identity: string): Promise<void> {
        await this.clearLock(configName)
        observer.emit('lock:released', { configName, identity })
    }
}
```

#### Runner (runner.md)

```typescript
import { observer } from './observer'

class Runner {
    async build(schemaPath: string): Promise<void> {
        const files = await this.getSchemaFiles(schemaPath)
        observer.emit('build:start', { schemaPath, fileCount: files.length })

        const start = performance.now()
        let filesRun = 0
        let filesSkipped = 0

        for (const file of files) {
            const result = await this.executeFile(file)
            if (result.skipped) filesSkipped++
            else filesRun++
        }

        observer.emit('build:complete', {
            status: 'success',
            filesRun,
            filesSkipped,
            durationMs: performance.now() - start
        })
    }

    async executeFile(filepath: string): Promise<{ skipped: boolean }> {
        const checksum = await this.computeChecksum(filepath)
        const existing = await this.getFileRecord(filepath)

        if (existing?.checksum === checksum) {
            observer.emit('file:skip', { filepath, reason: 'unchanged' })
            return { skipped: true }
        }

        observer.emit('file:before', {
            filepath,
            checksum,
            configName: this.config.name
        })

        const start = performance.now()
        try {
            await this.executor.run(filepath)
            observer.emit('file:after', {
                filepath,
                status: 'success',
                durationMs: performance.now() - start
            })
            return { skipped: false }
        } catch (err) {
            observer.emit('file:after', {
                filepath,
                status: 'failed',
                durationMs: performance.now() - start,
                error: err instanceof Error ? err.message : String(err)
            })
            throw err
        }
    }
}
```

#### Changeset Executor (changeset.md)

```typescript
import { observer } from './observer'

class ChangesetExecutor {
    async run(name: string, direction: 'change' | 'revert'): Promise<void> {
        const files = await this.getChangesetFiles(name, direction)
        observer.emit('changeset:start', { name, direction, files })

        const start = performance.now()

        for (let i = 0; i < files.length; i++) {
            observer.emit('changeset:file', {
                changeset: name,
                filepath: files[i],
                index: i,
                total: files.length
            })
            await this.runner.executeFile(files[i])
        }

        observer.emit('changeset:complete', {
            name,
            direction,
            status: 'success',
            durationMs: performance.now() - start
        })
    }
}
```

#### Template Engine (template.md)

```typescript
import { observer } from './observer'

class TemplateEngine {
    async render(filepath: string, context: TemplateContext): Promise<string> {
        const start = performance.now()
        const result = await this.eta.render(filepath, context)

        observer.emit('template:render', {
            filepath,
            durationMs: performance.now() - start
        })

        return result
    }

    async load(filepath: string): Promise<unknown> {
        const ext = path.extname(filepath)
        const format = this.getFormat(ext)

        observer.emit('template:load', { filepath, format })
        // ... load and parse
    }
}
```

#### Identity Resolver (identity.md)

```typescript
import { observer } from './observer'

class IdentityResolver {
    async resolve(config?: Config): Promise<Identity> {
        const identity = await this.doResolve(config)

        observer.emit('identity:resolved', {
            name: identity.name,
            email: identity.email,
            source: identity.source
        })

        return identity
    }
}
```

#### DB Lifecycle (db.md)

```typescript
import { observer } from './observer'

class DbLifecycle {
    async create(config: Config): Promise<void> {
        observer.emit('db:creating', {
            configName: config.name,
            database: config.connection.database
        })

        const start = performance.now()
        await this.createDatabase(config)

        observer.emit('db:created', {
            configName: config.name,
            database: config.connection.database,
            durationMs: performance.now() - start
        })
    }

    async bootstrap(config: Config): Promise<void> {
        await this.createTrackingTables(config)

        observer.emit('db:bootstrap', {
            configName: config.name,
            tables: ['__change_files__', '__change_version__', '__noorm_lock__']
        })
    }

    async destroy(config: Config): Promise<void> {
        observer.emit('db:destroying', {
            configName: config.name,
            database: config.connection.database
        })

        await this.dropDatabase(config)

        observer.emit('db:destroyed', {
            configName: config.name,
            database: config.connection.database
        })
    }
}
```


### CLI Integration

#### React Hooks

```typescript
// src/cli/hooks/useEvent.ts
import { useEffect, useState } from 'react'
import { observer, NoormEvents } from '../../core/observer'

export function useEvent<K extends keyof NoormEvents>(event: K) {
    const [data, setData] = useState<NoormEvents[K] | null>(null)

    useEffect(() => {
        return observer.on(event, setData)
    }, [event])

    return data
}
```

```typescript
// src/cli/hooks/useEventPattern.ts
import { useEffect, useState } from 'react'
import { observer } from '../../core/observer'

interface EventEntry {
    event: string
    data: unknown
    timestamp: number
}

export function useEventPattern(pattern: RegExp, maxEntries = 100) {
    const [events, setEvents] = useState<EventEntry[]>([])

    useEffect(() => {
        return observer.on(pattern, ({ event, data }) => {
            setEvents(prev => [
                ...prev.slice(-(maxEntries - 1)),
                { event, data, timestamp: Date.now() }
            ])
        })
    }, [pattern, maxEntries])

    return events
}
```

```typescript
// src/cli/hooks/useProgress.ts
import { useEffect, useState } from 'react'
import { observer } from '../../core/observer'

interface Progress {
    current: number
    total: number
    message: string
}

export function useProgress() {
    const [progress, setProgress] = useState<Progress | null>(null)

    useEffect(() => {
        const cleanups = [
            observer.on('build:start', ({ fileCount }) => {
                setProgress({ current: 0, total: fileCount, message: 'Building schema...' })
            }),
            observer.on('changeset:start', ({ name, files }) => {
                setProgress({ current: 0, total: files.length, message: `Running ${name}...` })
            }),
            observer.on('file:after', () => {
                setProgress(p => p ? { ...p, current: p.current + 1 } : null)
            }),
            observer.on('file:skip', () => {
                setProgress(p => p ? { ...p, current: p.current + 1 } : null)
            }),
            observer.on('build:complete', () => setProgress(null)),
            observer.on('changeset:complete', () => setProgress(null))
        ]

        return () => cleanups.forEach(c => c())
    }, [])

    return progress
}
```

```typescript
// src/cli/hooks/useLockStatus.ts
import { useEffect, useState } from 'react'
import { observer } from '../../core/observer'

interface LockStatus {
    locked: boolean
    holder?: string
    heldSince?: Date
    expiresAt?: Date
}

export function useLockStatus(configName: string) {
    const [status, setStatus] = useState<LockStatus>({ locked: false })

    useEffect(() => {
        const cleanups = [
            observer.on('lock:acquired', (data) => {
                if (data.configName === configName) {
                    setStatus({
                        locked: true,
                        holder: data.identity,
                        expiresAt: data.expiresAt
                    })
                }
            }),
            observer.on('lock:released', (data) => {
                if (data.configName === configName) {
                    setStatus({ locked: false })
                }
            }),
            observer.on('lock:blocked', (data) => {
                if (data.configName === configName) {
                    setStatus({
                        locked: true,
                        holder: data.holder,
                        heldSince: data.heldSince
                    })
                }
            })
        ]

        return () => cleanups.forEach(c => c())
    }, [configName])

    return status
}
```

#### Component Example

```typescript
// src/cli/components/ProgressBar.tsx
import { Box, Text } from 'ink'
import { useProgress } from '../hooks/useProgress'

export function ProgressBar() {
    const progress = useProgress()

    if (!progress) return null

    const pct = Math.round((progress.current / progress.total) * 100)
    const filled = Math.round(pct / 5)
    const bar = '█'.repeat(filled) + '░'.repeat(20 - filled)

    return (
        <Box flexDirection="column">
            <Text>{progress.message}</Text>
            <Text>
                <Text color="green">{bar}</Text>
                <Text> {progress.current}/{progress.total} ({pct}%)</Text>
            </Text>
        </Box>
    )
}
```


### Headless Mode

For CI/CD environments, events stream as JSON lines or formatted text.

```typescript
// src/cli/headless.ts
import { observer } from '../core/observer'

export function setupHeadlessLogging(options: { json: boolean }) {
    if (options.json) {
        // JSON lines for machine parsing
        observer.on(/.*/, ({ event, data }) => {
            console.log(JSON.stringify({
                event,
                data,
                timestamp: Date.now()
            }))
        })
        return
    }

    // Human-readable output
    observer.on('build:start', ({ fileCount }) => {
        console.log(`Building schema (${fileCount} files)...`)
    })

    observer.on('file:after', ({ filepath, status, durationMs }) => {
        const icon = status === 'success' ? '✓' : '✗'
        console.log(`  ${icon} ${filepath} (${durationMs}ms)`)
    })

    observer.on('file:skip', ({ filepath, reason }) => {
        console.log(`  ○ ${filepath} (${reason})`)
    })

    observer.on('build:complete', ({ status, filesRun, filesSkipped, durationMs }) => {
        console.log(`Build ${status}: ${filesRun} run, ${filesSkipped} skipped (${durationMs}ms)`)
    })

    observer.on('changeset:start', ({ name, direction }) => {
        console.log(`Running changeset: ${name} (${direction})`)
    })

    observer.on('changeset:complete', ({ name, status, durationMs }) => {
        console.log(`Changeset ${name}: ${status} (${durationMs}ms)`)
    })

    observer.on('lock:blocked', ({ holder, heldSince }) => {
        console.error(`Blocked: lock held by ${holder} since ${heldSince.toISOString()}`)
    })

    observer.on('error', ({ source, error }) => {
        console.error(`Error in ${source}: ${error.message}`)
    })
}
```


### Debug Mode

Enable with `NOORM_DEBUG=1` environment variable.

```bash
# Shows all events as they occur
NOORM_DEBUG=1 noorm run build

# Output:
# [noorm:emit] file:before
# [noorm:emit] file:after
# [noorm:emit] file:skip
# ...
```


### Event Categories

| Prefix | Source Module | Description |
|--------|---------------|-------------|
| `file:*` | runner | Individual SQL file execution |
| `build:*` | runner | Schema build operations |
| `run:*` | runner | Ad-hoc file/dir execution |
| `changeset:*` | changeset | Changeset execution |
| `lock:*` | lock | Lock acquisition/release |
| `state:*` | state | State load/persist |
| `config:*` | state | Config CRUD |
| `secret:*` | state | Secret CRUD |
| `db:*` | db | Database lifecycle |
| `template:*` | template | Template rendering |
| `identity:*` | identity | Identity resolution |
| `connection:*` | connection | Database connections |
| `error` | any | Catch-all errors |


### Subscribing by Pattern

```typescript
// All file events
observer.on(/^file:/, ({ event, data }) => { ... })

// All state-related events
observer.on(/^(state|config|secret):/, ({ event, data }) => { ... })

// All completion events
observer.on(/:complete$/, ({ event, data }) => { ... })

// Everything (for logging)
observer.on(/.*/, ({ event, data }) => { ... })
```


### Cleanup

All `observer.on()` calls return a cleanup function. Always clean up in React components:

```typescript
useEffect(() => {
    const cleanup = observer.on('some:event', handler)
    return cleanup
}, [])

// Or multiple:
useEffect(() => {
    const cleanups = [
        observer.on('event:one', handler1),
        observer.on('event:two', handler2)
    ]
    return () => cleanups.forEach(c => c())
}, [])
```


### Sub-observing Objects

For isolated components that need their own cleanup scope:

```typescript
const modal = { isOpen: false }
const observed = observer.observe(modal)

observed.on('open', () => { observed.isOpen = true })
observed.emit('open')

// Cleans up only this component's listeners
observed.cleanup()
```


## Error Tuples, Retry, and Batch

Utility patterns from `@logosdx/utils` for resilient async operations.


### Error Tuples with `attempt()`

Go-style error handling - no more try/catch spaghetti:

```typescript
import { attempt } from '@logosdx/utils'

// Returns [result, null] on success, [null, error] on failure
const [result, err] = await attempt(() => someAsyncOperation())

if (err) {
    // Handle error
    return
}

// Use result safely
```

#### Usage in noorm

```typescript
import { attempt } from '@logosdx/utils'

// File execution
const [result, err] = await attempt(() => executor.run(sql))
if (err) {
    observer.emit('file:after', { filepath, status: 'failed', error: err.message })
    return
}

// Config decryption
const [state, err] = await attempt(() => decrypt(encryptedData, key))
if (err) {
    observer.emit('error', { source: 'state', error: err })
    return null
}

// Changeset parsing
const [files, err] = await attempt(() => parseChangesetManifest(path))
if (err) {
    console.error(`Invalid changeset ${name}: ${err.message}`)
    return
}

// Database query
const [rows, err] = await attempt(() =>
    db.selectFrom('__change_files__').selectAll().execute()
)
if (err) {
    observer.emit('error', { source: 'tracker', error: err })
    return []
}
```


### Retry with `retry()`

Wrap flaky operations with automatic retry and backoff:

```typescript
import { retry } from '@logosdx/utils'

const resilientFn = retry(
    async () => { /* operation */ },
    {
        retries: 3,              // Max retry attempts
        delay: 1000,             // Initial delay (ms)
        backoff: 2,              // Delay multiplier (1s, 2s, 4s)
        jitterFactor: 0.1,       // Add randomness 0-1
        shouldRetry: (err) => {  // Conditional retry
            return err.message.includes('timeout')
        }
    }
)
```

#### Connection Factory with Retry

```typescript
import { retry, attempt } from '@logosdx/utils'

async function createConnection(config: Config): Promise<Kysely<unknown>> {
    const connect = retry(
        async () => {
            const db = new Kysely({ dialect: createDialect(config) })
            // Test connection with simple query (no tables required)
            await sql`SELECT 1`.execute(db)
            return db
        },
        {
            retries: 3,
            delay: 1000,
            backoff: 2,               // 1s, 2s, 4s
            jitterFactor: 0.1,
            shouldRetry: (err) => {
                // Don't retry auth failures
                if (err.message.includes('authentication')) return false
                if (err.message.includes('password')) return false
                // Retry connection issues
                return err.message.includes('ECONNREFUSED') ||
                       err.message.includes('ETIMEDOUT') ||
                       err.message.includes('too many connections')
            }
        }
    )

    const [db, err] = await attempt(connect)
    if (err) {
        observer.emit('connection:error', { configName: config.name, error: err.message })
        throw err
    }

    observer.emit('connection:open', { configName: config.name, dialect: config.connection.dialect })
    return db
}
```

#### Lock Acquisition with Retry

```typescript
import { retry, attempt } from '@logosdx/utils'

async function acquireLockWithRetry(configName: string, identity: string): Promise<boolean> {
    const acquire = retry(
        async () => {
            const acquired = await lockManager.tryAcquire(configName, identity)
            if (!acquired) {
                throw new Error('Lock held by another process')
            }
            return true
        },
        {
            retries: 5,
            delay: 2000,
            backoff: 1.5,
            shouldRetry: (err) => err.message.includes('Lock held')
        }
    )

    const [success, err] = await attempt(acquire)
    return success ?? false
}
```


### Batch with `batch()`

Process arrays with controlled concurrency and error handling:

```typescript
import { batch } from '@logosdx/utils'

const results = await batch(
    async (item) => { /* process item */ },
    {
        items: arrayOfItems,
        concurrency: 10,              // Parallel operations
        failureMode: 'abort',         // 'abort' | 'continue'
        onError: (err, item) => { },  // Error callback
        onChunkStart: ({ index, total, completionPercent }) => { },
        onChunkEnd: ({ index, total, completionPercent }) => { }
    }
)

// results: Array<{ result, error, item, index }>
```

#### Schema Build with Batch

```typescript
import { batch, attempt } from '@logosdx/utils'

async function buildSchema(schemaPath: string, concurrency = 1): Promise<BuildResult> {
    const files = await getSchemaFiles(schemaPath)

    observer.emit('build:start', { schemaPath, fileCount: files.length })
    const start = performance.now()

    const results = await batch(
        async (filepath: string) => {
            const checksum = await computeChecksum(filepath)
            const existing = await getFileRecord(filepath)

            if (existing?.checksum === checksum) {
                observer.emit('file:skip', { filepath, reason: 'unchanged' })
                return { filepath, skipped: true }
            }

            observer.emit('file:before', { filepath, checksum, configName })

            const fileStart = performance.now()
            const [_, err] = await attempt(() => executeFile(filepath))

            if (err) {
                observer.emit('file:after', {
                    filepath,
                    status: 'failed',
                    durationMs: performance.now() - fileStart,
                    error: err.message
                })
                throw err
            }

            observer.emit('file:after', {
                filepath,
                status: 'success',
                durationMs: performance.now() - fileStart
            })

            return { filepath, skipped: false }
        },
        {
            items: files,
            concurrency,              // Sequential by default for DDL
            failureMode: 'abort',     // Stop on first failure
            onError: (err, filepath) => {
                observer.emit('error', {
                    source: 'build',
                    error: err,
                    context: { filepath }
                })
            }
        }
    )

    const filesRun = results.filter(r => r.result && !r.result.skipped).length
    const filesSkipped = results.filter(r => r.result?.skipped).length
    const failed = results.some(r => r.error)

    observer.emit('build:complete', {
        status: failed ? 'failed' : 'success',
        filesRun,
        filesSkipped,
        durationMs: performance.now() - start
    })

    return { filesRun, filesSkipped, failed }
}
```

#### Changeset Fast-Forward with Batch

```typescript
import { batch } from '@logosdx/utils'

async function fastForward(): Promise<void> {
    const pending = await getPendingChangesets()

    await batch(
        async (changeset: string) => {
            return runChangeset(changeset, 'change')
        },
        {
            items: pending,
            concurrency: 1,           // Changesets must be sequential
            failureMode: 'abort'
        }
    )
}
```

#### Seed Data Loading with Batch

```typescript
import { batch } from '@logosdx/utils'

async function loadSeedData(paths: string[]): Promise<Record<string, unknown>> {
    const results = await batch(
        async (filepath: string) => {
            observer.emit('template:load', { filepath, format: getFormat(filepath) })
            return {
                key: path.basename(filepath, path.extname(filepath)),
                data: await loadFile(filepath)
            }
        },
        {
            items: paths,
            concurrency: 10,          // IO-bound, can parallelize
            failureMode: 'abort'
        }
    )

    return Object.fromEntries(
        results.filter(r => r.result).map(r => [r.result!.key, r.result!.data])
    )
}
```


### Combined Patterns

The patterns compose naturally:

```typescript
import { retry, batch, attempt } from '@logosdx/utils'

async function resilientBuild(config: Config): Promise<BuildResult> {
    // Retry connection
    const [db, connErr] = await attempt(() =>
        retry(
            async () => {
                const db = new Kysely({ dialect: createDialect(config) })
                await sql`SELECT 1`.execute(db)
                return db
            },
            { retries: 3, delay: 1000, backoff: 2 }
        )
    )

    if (connErr) {
        return { error: connErr, filesRun: 0, filesSkipped: 0, failed: true }
    }

    // Batch execute files with error tuples
    const files = await getSchemaFiles(config.paths.schema)

    const results = await batch(
        async (filepath) => {
            const [result, err] = await attempt(() => executeFile(db, filepath))
            if (err) throw err
            return result
        },
        {
            items: files,
            concurrency: 1,
            failureMode: 'abort'
        }
    )

    await db.destroy()

    return {
        filesRun: results.filter(r => r.result).length,
        filesSkipped: 0,
        failed: results.some(r => r.error)
    }
}
```


### Pattern Summary

| Pattern | Use Case |
|---------|----------|
| `attempt()` | Every async operation - file execution, decryption, parsing, DB queries |
| `retry()` | Connection factory, lock acquisition, flaky external calls |
| `batch()` | Schema build, changeset fast-forward, seed data loading, bulk file operations |
