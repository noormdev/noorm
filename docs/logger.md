# Logger


## The Problem

Database operations generate a lot of events: files executed, connections opened, configs changed, locks acquired. When something goes wrong at 3 AM, you need to know what happened. Console output scrolls away. Memory fades.

noorm solves this with persistent file logging. Every significant event is captured, timestamped, and written to disk. The logger subscribes to all observer events and streams them to a log file using a queue-based system that never blocks your operations.


## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      Core Modules                            │
│  State, Config, Connection, Runner, Changeset, Lock, etc.   │
└──────────────────────────┬──────────────────────────────────┘
                           │ emit events
                           ▼
┌─────────────────────────────────────────────────────────────┐
│                        Observer                              │
└──────────────────────────┬──────────────────────────────────┘
                           │ subscribe to all
                           ▼
┌─────────────────────────────────────────────────────────────┐
│                         Logger                               │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐    │
│  │Classifier│→ │Formatter │→ │  Queue   │→ │   File   │    │
│  │          │  │          │  │          │  │          │    │
│  │ Determine│  │ Create   │  │ Non-     │  │ Append   │    │
│  │ level    │  │ entry    │  │ blocking │  │ + rotate │    │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘    │
└─────────────────────────────────────────────────────────────┘
```


## Quick Start

```typescript
import { Logger } from './core/logger'
import { getSettingsManager } from './core/settings'

const settings = getSettingsManager(process.cwd())
await settings.load()

const logger = new Logger({
    projectRoot: process.cwd(),
    config: settings.getLogging(),
})

await logger.start()

// Logger now captures all observer events...
// Do your work...

await logger.stop()
```


## Configuration

Logger settings live in `.noorm/settings.yml`:

```yaml
logging:
    enabled: true
    level: info
    file: .noorm/noorm.log
    maxSize: 10mb
    maxFiles: 5
```

| Property | Default | Description |
|----------|---------|-------------|
| `enabled` | `true` | Enable file logging |
| `level` | `'info'` | Minimum level to capture |
| `file` | `.noorm/noorm.log` | Log file path (relative to project) |
| `maxSize` | `'10mb'` | Rotate when size exceeded |
| `maxFiles` | `5` | Rotated files to keep |

The log file lives in `.noorm/` and should be gitignored alongside `state.enc`.


## Log Levels

Five verbosity levels control what gets captured:

| Level | Events Captured |
|-------|-----------------|
| `silent` | Nothing |
| `error` | Errors only |
| `warn` | Errors + warnings |
| `info` | Errors + warnings + info (default) |
| `verbose` | Everything including debug |

```typescript
import { shouldLog } from './core/logger'

shouldLog('connection:error', 'info')  // true (error event)
shouldLog('build:start', 'info')       // true (info event)
shouldLog('file:before', 'info')       // false (debug event)
shouldLog('file:before', 'verbose')    // true (verbose logs all)
```


## Event Classification

Events are automatically classified by their naming pattern:

| Pattern | Level | Examples |
|---------|-------|----------|
| `error`, `*:error`, `*:failed` | error | `error`, `connection:error`, `build:failed` |
| `*:warning`, `*:blocked`, `*:expired` | warn | `lock:blocked`, `lock:expired` |
| `*:start`, `*:complete`, `*:created`, `*:deleted`, `*:loaded`, etc. | info | `build:start`, `config:created` |
| Everything else | debug | `file:before`, `lock:acquiring` |

```typescript
import { classifyEvent } from './core/logger'

classifyEvent('error')            // 'error'
classifyEvent('connection:error') // 'error'
classifyEvent('lock:blocked')     // 'warn'
classifyEvent('build:start')      // 'info'
classifyEvent('file:before')      // 'debug'
```


## Log Entry Format

Each entry is a JSON object on a single line:

```json
{"timestamp":"2024-01-15T10:30:00.000Z","level":"info","event":"build:start","message":"Starting schema build (10 files)","context":{"config":"dev"}}
```

Entry structure:

| Field | Type | Description |
|-------|------|-------------|
| `timestamp` | string | ISO 8601 timestamp |
| `level` | string | `error`, `warn`, `info`, or `debug` |
| `event` | string | Observer event name |
| `message` | string | Human-readable summary |
| `data` | object | Event payload (verbose only) |
| `context` | object | Config name, identity, etc. |

The `message` field provides human-readable summaries:

```typescript
import { generateMessage } from './core/logger'

generateMessage('build:start', { fileCount: 10 })
// "Starting schema build (10 files)"

generateMessage('file:after', { filepath: 'users.sql', status: 'success', durationMs: 45 })
// "Executed users.sql (45ms)"

generateMessage('config:activated', { name: 'prod', previous: 'dev' })
// "Activated config: prod (was dev)"
```


## Sensitive Data Redaction

The logger automatically redacts sensitive fields:

```typescript
// Fields containing these words are redacted:
// password, secret, key, token, credential, auth

const entry = formatEntry('custom:event', {
    username: 'alice',
    password: 'secret123',
    apiKey: 'sk-123',
}, undefined, true)

// entry.data = {
//     username: 'alice',
//     password: '[REDACTED]',
//     apiKey: '[REDACTED]'
// }
```


## Write Queue

The logger uses a non-blocking queue for file writes:

- **Non-blocking enqueue** - Callers never wait for disk I/O
- **Order preservation** - Entries written in enqueue order
- **Graceful shutdown** - Flush waits for pending writes

```typescript
// Entries enqueued immediately (non-blocking)
observer.emit('config:created', { name: 'dev' })
observer.emit('config:created', { name: 'prod' })

// Flush forces all pending writes to complete
await logger.flush()

// Stop flushes before shutting down
await logger.stop()
```


## Log Rotation

When the log file exceeds `maxSize`, it's rotated:

```
.noorm/
├── noorm.log                          # Current log
├── noorm.2024-01-15T10-30-45.log     # Rotated
├── noorm.2024-01-14T08-15-00.log     # Rotated
└── noorm.2024-01-13T16-45-30.log     # Rotated
```

Old rotated files are deleted when count exceeds `maxFiles`.

```typescript
import { parseSize, checkAndRotate } from './core/logger'

parseSize('10mb')  // 10485760 bytes

const result = await checkAndRotate('/path/to/app.log', '10mb', 5)
// { rotated: true, oldFile: '...', newFile: '...', deletedFiles: [...] }
```


## Context Injection

Add context that's included with every log entry:

```typescript
const logger = new Logger({
    projectRoot: process.cwd(),
    config: loggingConfig,
    context: { config: 'dev' },  // Initial context
})

await logger.start()

// Update context as state changes
logger.setContext({ config: 'prod', user: 'alice' })

// Clear context
logger.clearContext()
```

Context appears in every entry:

```json
{"timestamp":"...","level":"info","event":"build:start","message":"...","context":{"config":"prod","user":"alice"}}
```


## Logger API

```typescript
const logger = new Logger({
    projectRoot: string,
    config: LoggerConfig,
    context?: Record<string, unknown>,
})

// Lifecycle
await logger.start()   // Subscribe to events, start queue
await logger.stop()    // Unsubscribe, flush, stop queue
await logger.flush()   // Force pending writes to disk

// State
logger.state           // 'idle' | 'running' | 'flushing' | 'stopped'
logger.level           // Current log level
logger.filepath        // Full path to log file
logger.isEnabled       // Whether logging is active
logger.stats           // Queue statistics (pending, totalWritten, etc.)

// Context
logger.setContext({ key: value })  // Merge into context
logger.clearContext()              // Clear all context
```


## Singleton Pattern

For convenience, use the singleton:

```typescript
import { getLogger, resetLogger } from './core/logger'

const logger = getLogger(process.cwd(), loggingConfig)
await logger.start()

// In tests, reset between tests
await resetLogger()
```


## Observer Events

The logger emits events for its own lifecycle:

| Event | Payload | When |
|-------|---------|------|
| `logger:started` | `{ file, level }` | Logger initialized |
| `logger:rotated` | `{ oldFile, newFile }` | Log file rotated |
| `logger:error` | `{ error }` | Write failure |
| `logger:flushed` | `{ entriesWritten }` | Queue drained |

Note: The logger ignores its own events to avoid infinite loops.


## Integration Example

Typical startup sequence:

```typescript
import { StateManager } from './core/state'
import { getSettingsManager } from './core/settings'
import { Logger } from './core/logger'

// 1. Load settings (includes logging config)
const settings = getSettingsManager(process.cwd())
await settings.load()

// 2. Start logger early to capture everything
const logger = new Logger({
    projectRoot: process.cwd(),
    config: settings.getLogging(),
})
await logger.start()

// 3. Load state (logger captures state:loaded event)
const state = new StateManager(process.cwd())
await state.load()

// 4. Set context for all subsequent logs
logger.setContext({
    config: state.getActiveConfigName(),
})

// ... do work ...

// 5. Shutdown in reverse order
await logger.stop()
```


## Reading Log Files

Log files are newline-delimited JSON. Parse with:

```bash
# View recent entries
tail -20 .noorm/noorm.log | jq .

# Filter by level
cat .noorm/noorm.log | jq 'select(.level == "error")'

# Filter by event
cat .noorm/noorm.log | jq 'select(.event | startswith("build:"))'

# Search by time range
cat .noorm/noorm.log | jq 'select(.timestamp > "2024-01-15T10:00:00")'
```
