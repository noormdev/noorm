# Logger


## The Problem

Database operations generate a lot of events: files executed, connections opened, configs changed, locks acquired. When something goes wrong at 3 AM, you need to know what happened. Console output scrolls away. Memory fades.

noorm solves this with persistent file logging. Every significant event is captured, timestamped, and written to disk. The logger subscribes to all observer events and streams them to a log file using a queue-based system that never blocks your operations.


## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      Core Modules                            │
│  State, Config, Connection, Runner, Change, Lock, etc.   │
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
│  │  Queue   │→ │Classifier│→ │Formatter │→ │   File   │    │
│  │          │  │          │  │          │  │          │    │
│  │ Non-     │  │ Determine│  │ Redact + │  │ Append   │    │
│  │ blocking │  │ level    │  │ flatten  │  │ + rotate │    │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘    │
└─────────────────────────────────────────────────────────────┘
```

The queue is at the front, not the back: it decouples the *emitter* from the logger. Once an event is dequeued, classification, formatting, and the file write all happen synchronously.


## Quick Start

```typescript
import { Logger } from './core/logger'
import { getSettingsManager } from './core/settings'

const settings = getSettingsManager(process.cwd())
await settings.load()

const logger = new Logger({
    projectRoot: process.cwd(),
    settings,  // Required field, but the class does not read it
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
    file: .noorm/state/noorm.log
    maxSize: 10mb
    maxFiles: 5
```

| Property | Default | Description |
|----------|---------|-------------|
| `enabled` | `true` | Enable file logging |
| `level` | `'info'` | Minimum level to capture |
| `file` | `.noorm/state/noorm.log` | Log file path (relative to project) |
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

Rules are checked in this order; the first match wins.

| # | Pattern | Level | Examples |
|---|---------|-------|----------|
| 1 | `error`, `*:error`, `*:failed` | error | `error`, `connection:error`, `build:failed` |
| 2 | `*:warning`, `*:blocked`, `*:expired` | warn | `lock:blocked`, `lock:expired` |
| 3 | `*:before`, `*:acquiring`, `*:file` | debug | `file:before`, `lock:acquiring` |
| 4 | Known namespace prefix (below) | info | `build:start`, `config:created` |
| 5 | Everything else | debug | `mcp:tool-called` |

Rule 4 matches on the event's **namespace prefix**, not its suffix. Any event in one of these namespaces is info unless rule 1, 2, or 3 already claimed it:

```
update:  global-settings:  settings:  file:  change:  build:  run:  lock:
state:   config:  secret:  known-user:  db:  template:  identity:
connection:  app:  transfer:  dt:  vault:
```

Rule 3 exists because `file:` and `lock:` are info namespaces, but `file:before` and `lock:acquiring` fire on every file and every acquisition attempt—too noisy for default verbosity. It is checked before rule 4 so the namespace can't win.

An event in a namespace *not* on that list falls to debug regardless of its suffix: a hypothetical `plugin:start` is debug, not info.

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
{"time":"2024-01-15T10:30:00.123+00:00","type":"build:start","level":"info","message":"Starting schema build (10 files)","fileCount":10,"config":"dev"}
```

Four core fields are always present:

| Field | Type | Description |
|-------|------|-------------|
| `time` | string | Local time with a `±HH:mm` UTC offset—never a literal `Z` |
| `type` | string | Observer event name, or `log` for a direct `logger.info()`-style call |
| `level` | string | `error`, `warn`, `info`, or `debug` |
| `message` | string | Human-readable summary |

Everything else—the event payload, then the injected context—is **flattened onto the same object**, not nested under `data` or `context`. Nested values are flattened one level with dot-notation (`connection.host`), arrays and anything deeper are JSON-stringified, and a key that collides with an existing one is dropped rather than overwriting it. Payload fields are written whenever the payload is non-empty; there is no verbose-only gate.

A `formatEntry()` helper in `formatter.ts` does build a nested `{ data, context }` shape, but nothing on the write path calls it—do not use it as a reference for what lands on disk.

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


### Database Error Formatting

Error events receive special formatting to extract useful information from database-specific error objects:

```typescript
// PostgreSQL errors (with severity, code, routine)
generateMessage('error', {
    source: 'executor',
    error: { severity: 'ERROR', code: '42P01', routine: 'RangeVarGetRelidExtended' }
})
// "Error in executor: ERROR 42P01 in RangeVarGetRelidExtended"

// Standard Error objects
generateMessage('error', {
    source: 'runner',
    error: new Error('Connection refused')
})
// "Error in runner: Connection refused"

// Objects with message property
generateMessage('error', {
    source: 'template',
    error: { message: 'Invalid syntax', line: 42 }
})
// "Error in template: Invalid syntax"
```

This structured error formatting helps identify database-specific issues (constraint violations, syntax errors, connection problems) in logs without requiring access to the full error object.


## Sensitive Data Redaction

The logger automatically masks sensitive fields using smart redaction. Instead of replacing values with `[REDACTED]`, it shows a masked preview with length information:

```typescript
import { maskValue } from './core/logger/redact'

// Format: <FieldName mask (length) />
maskValue('mysecretpassword', 'Password', 'info')
// => '<Password ************... (16) />'

// In verbose mode, first few chars are visible for debugging
maskValue('sk-1234567890abcd', 'ApiKey', 'verbose')
// => '<ApiKey sk-1********... (17) />'
```

The mask length is capped at 12 characters, with `...` indicating overflow. In verbose mode, up to 4 leading characters are revealed (proportional to value length) to help identify which secret is being referenced.


### Built-in Masked Fields

Common sensitive field names are automatically detected (case-insensitive):

```
password, pass, secret, token, key, credential, api_key, apikey,
access_key, secret_key, db_pass, db_password, redis_pass,
client_secret, private_key, encryption_key, auth_token,
bearer_token, jwt_secret, session_secret,
connection_password, identity_private_key, password_hash, user_password
```

All case variations are checked: `password`, `PASSWORD`, `Password`, `db_password`, `DB_PASSWORD`, `dbPassword`, etc.

The last four are listed in full for a reason: `addMaskedFields` derives the `NOORM_` prefix from the **bare** term only, so `password` yields `NOORM_PASSWORD` but never `NOORM_CONNECTION_PASSWORD`. Any compound env var name this project actually tells users to set has to be registered explicitly.


### Dynamic Secret Registration

Secrets from settings and user-defined secrets are automatically added to the redaction list:

```typescript
import { addMaskedFields, addSettingsSecrets, listenForSecrets } from './core/logger/redact'

// Add custom field names
addMaskedFields(['MY_CUSTOM_SECRET', 'vendor_api_token'])

// Add all secrets defined in settings.yml stages
addSettingsSecrets(settings)

// Listen for runtime secret operations (call before logger starts)
const cleanup = listenForSecrets()
// Now any secret:set or global-secret:set events add keys to redaction
```

**The `Logger` class does not call these for you.** Only `enableAutoLoggerInit()` (the TUI path) wires `addSettingsSecrets` and `listenForSecrets`. The headless CLI's `createCliLogger()` calls neither, so in a headless run only the built-in field-name list applies—a secret set mid-session is not auto-redacted unless you wire it yourself, as the example above does.


## Event Queue

Incoming observer events are processed through `observer.queue()`, an `EventQueue` with concurrency 1:

- **Non-blocking** - Emitters never wait for the logger
- **Order preservation** - Events processed in emit order
- **Graceful shutdown** - `stop()` drains the queue before closing the stream

```typescript
// Emitters return immediately
observer.emit('config:created', { name: 'dev' })
observer.emit('config:created', { name: 'prod' })

// Flush forces pending work to complete
await logger.flush()

// Stop flushes before shutting down
await logger.stop()
```

The queue sits in front of event *processing*. The file write itself is a plain synchronous `Writable#write()`, and rotation reopens the stream rather than redirecting a queue.

`src/core/logger/queue.ts` exports a `WriteQueue` class with its own `setFilepath()`. It is **not wired into `Logger`**—nothing outside its own unit test constructs it. Do not read it as the active write path.


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

A running logger does this on its own: `start()` checks once before opening the stream, then installs a 60-second interval that calls `logger.checkRotation()` until `stop()`. Calling `checkAndRotate` yourself is only for tooling outside a live logger.

In the `logger:rotated` payload, `oldFile` is the live path (`noorm.log`) and `newFile` is the timestamped archive it was moved to—a fresh file then reappears at `oldFile`.


## Context Injection

Add context that's included with every log entry:

```typescript
const logger = new Logger({
    projectRoot: process.cwd(),
    settings,
    config: loggingConfig,
    context: { config: 'dev' },  // Initial context
})

await logger.start()

// Update context as state changes
logger.setContext({ config: 'prod', user: 'alice' })

// Clear context
logger.clearContext()
```

Context is flattened onto every entry alongside the payload, not nested:

```json
{"time":"...","type":"build:start","level":"info","message":"...","fileCount":10,"config":"prod","user":"alice"}
```

Context is applied after the payload, so a payload field of the same name wins.


## Logger API

```typescript
const logger = new Logger({
    projectRoot: string,
    settings: Settings,           // Required field; the class does not read it
    config?: Partial<LoggerConfig>,
    context?: Record<string, unknown>,
    file?: Writable,              // Custom file stream
    console?: Writable,           // Result output only (default process.stdout)
    diagnostics?: Writable,       // Every log line goes here (default process.stderr)
    json?: boolean,               // NDJSON console output (default: isCi())
    color?: boolean,              // Colored inline console output
})

// Lifecycle
await logger.start()   // Subscribe to events, start queue, arm rotation interval
await logger.stop()    // Unsubscribe, flush, close stream
await logger.flush()   // Force pending writes to disk

// Direct logging (bypasses the observer; entries get type "log")
logger.info(message, data?)
logger.warn(message, data?)
logger.error(message, data?)
logger.debug(message, data?)

// Headless command result — raw JSON to console AND the log file
logger.result(data)

// State
logger.state           // 'idle' | 'running' | 'flushing' | 'stopped'
logger.level           // Current log level
logger.filepath        // Full path to log file
logger.isEnabled       // Whether logging is active
logger.stats           // Queue statistics (pending, totalWritten, etc.)
logger.checkRotation() // Manual rotation check; also runs on a 60s interval

// Context
logger.setContext({ key: value })  // Merge into context
logger.clearContext()              // Clear all context
```

`console` and `diagnostics` are not interchangeable. Every log line—observer-driven or direct—goes to `diagnostics` (stderr). `console` (stdout) carries only `result()`'s payload, which is what keeps `--json` output parseable: the event stream never contaminates stdout.

The constructor also subscribes to `app:shutdown` and calls `stop()` on it, so a clean shutdown flushes without an explicit call.


## Constructing a Logger

Two factories cover the real paths; construct `Logger` directly only in tests.

| Factory | Used by | Behavior |
|---------|---------|----------|
| `createCliLogger(projectRoot, json)` | Every headless CLI command | Loads settings, defaults level to `verbose` under `isDev()` else `info`, honors `NOORM_LOG_LEVEL`, sets `console: stdout` / `diagnostics: stderr`, `color: !json` |
| `enableAutoLoggerInit()` | The TUI (`noorm ui`) | Event-driven bootstrap; also wires `addSettingsSecrets` + `listenForSecrets`, and forces the log file path empty under `isCi()` |

`logging.enabled: false` in settings does not disable the whole logger in the CLI path—it blanks the file path, leaving console output intact. A blank `config.file` is how the logger is told to stay console-only.


### Environment variables

| Variable | Effect |
|----------|--------|
| `NOORM_LOG_LEVEL` | Overrides `logging.level`. Read only in the `createCliLogger` path |
| `NOORM_LOGGER_DEBUG` | Enables debug tracing on the internal event queue |
| `NOORM_DEV` / `NODE_ENV=development` | Via `isDev()`, raises the CLI's default level to `verbose` |
| CI vars | Via `isCi()`, default `json` to true; the TUI init path additionally disables file logging |

There is no `--verbose`, `--quiet`, or `--log-level` CLI flag. The only command-line lever is `--json`.


## Singleton Pattern

For convenience, use the singleton:

```typescript
import { getLogger, resetLogger } from './core/logger'

// First call initializes the singleton. A bare projectRoot string also works.
const logger = getLogger({
    projectRoot: process.cwd(),
    settings,
    config: loggingConfig,
})
await logger?.start()

// Subsequent calls return the existing instance (options ignored)
const sameLogger = getLogger()

// getLogger() returns Logger | null — null when called with no options
// before anything has initialized the singleton
sameLogger?.info('ready')

// In tests, reset between tests
await resetLogger()
```


## Observer Events

The logger emits events for its own lifecycle:

| Event | Payload | When |
|-------|---------|------|
| `logger:started` | `{ file, level }` | Logger initialized |
| `logger:rotated` | `{ oldFile, newFile }` | Log file rotated |

Those two are the whole set. `formatter.ts` carries message templates for `logger:error` and `logger:flushed`, but neither is declared in `NoormEvents` and neither is ever emitted—do not subscribe to them. File-stream errors are swallowed silently rather than reported.

The logger ignores events whose name starts with `logger:` to avoid infinite loops.


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
    settings,
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

Log files are newline-delimited JSON. Parse with shell tools:

```bash
# View recent entries
tail -20 .noorm/state/noorm.log | jq .

# Filter by level
cat .noorm/state/noorm.log | jq 'select(.level == "error")'

# Filter by event type
cat .noorm/state/noorm.log | jq 'select(.type | startswith("build:"))'

# Search by time range
cat .noorm/state/noorm.log | jq 'select(.time > "2024-01-15T10:00:00")'
```


### Programmatic Reading

The `readLogFile` function parses log files with graceful error handling:

```typescript
import { readLogFile } from './core/logger'

// Read last 500 entries (default)
const result = await readLogFile('.noorm/state/noorm.log')

console.log(`Total lines: ${result.totalLines}`)
console.log(`Returned: ${result.entries.length}`)
console.log(`Has more: ${result.hasMore}`)

for (const entry of result.entries) {
    console.log(`[${entry.level}] ${entry.type}: ${entry.message}`)
}

// Read last 100 entries
const recent = await readLogFile('.noorm/state/noorm.log', { limit: 100 })
```

Results are returned in reverse chronological order (newest first). Malformed JSON lines are silently skipped.

### ReadLogsResult

```typescript
interface ReadLogsResult {
    /** Parsed log entries (newest first) */
    entries: LogEntry[]

    /** Total number of lines in the file */
    totalLines: number

    /** Whether there are more entries beyond the limit */
    hasMore: boolean
}
```


## Log Viewer Overlay

The CLI includes a global log viewer accessible via `Shift+L` from anywhere in the app:

```
┌─────────────────────────────────────────────────────────────┐
│  Log Viewer                                    [Shift+L]    │
├─────────────────────────────────────────────────────────────┤
│  10:30:45 [info]  build:start         Starting schema build │
│  10:30:46 [info]  file:after          Executed users.sql    │
│  10:30:46 [debug] file:before         Processing posts.sql  │
│  10:30:47 [error] file:after          Failed: posts.sql     │
│                                                              │
│  ↑/↓ Navigate  Enter Detail  / Search  Space Pause  Esc    │
└─────────────────────────────────────────────────────────────┘
```

Features:

| Feature | Description |
|---------|-------------|
| Live tail | Auto-refreshes every 2 seconds |
| Search | Filter by event, message, or level |
| Detail view | Shows full JSON for selected entry |
| Pause/resume | Freeze updates while investigating |
| Level colors | Red=error, yellow=warn, green=info, gray=debug |

Keyboard shortcuts:

| Key | Action |
|-----|--------|
| `↑/↓` | Navigate entries |
| `PageUp` / `PageDown` | Page through entries |
| `g` / `G` | Jump to top / bottom |
| `Enter` | View entry detail |
| `/` | Toggle search filter |
| `Space` | Pause/resume live tail |
| `r` | Refresh now |
| `Esc` | Close overlay |
