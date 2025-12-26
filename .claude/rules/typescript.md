---
paths: src/**/*.{ts,tsx}
---

# TypeScript Rules


## Error Handling

Use `attempt`/`attemptSync` from `@logosdx/utils` for I/O operations. The error tuple pattern `[result, err]` eliminates try-catch and makes error paths explicit.

```ts
import { attempt } from '@logosdx/utils'

const [result, err] = await attempt(() => db.execute(sql))
if (err) {

    observer.emit('error', { source: 'executor', error: err })
    return
}
```

Throw directly in business logic validation. Error tuples are for I/O boundaries, not internal logic.


## Function Structure

Follow the 4-block structure: Declaration, Validation, Business Logic, Commit.

```ts
async function executeFile(filepath: string): Promise<FileResult> {

    // Declaration
    const start = performance.now()

    // Validation
    if (!filepath.endsWith('.sql')) {

        throw new InvalidFileError(`Not a SQL file: ${filepath}`)
    }

    // Business Logic
    const checksum = await computeChecksum(filepath)
    const [_, err] = await attempt(() => executor.run(sql))

    if (err) {

        observer.emit('file:after', { filepath, status: 'failed' })
        throw err
    }

    // Commit
    await recordFileExecution(filepath, checksum)
    return { filepath, skipped: false }
}
```


## Formatting

Add newline after function declaration and opening braces:

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

Max 100 characters per line. Prefer vertical space over horizontal.


## Utilities

Core utilities from `@logosdx/utils`:

```ts
// Error tuples - Go-style [result, err]
const [data, err] = await attempt(() => db.query())
const [parsed, err] = attemptSync(() => JSON.parse(str))

// Retry with backoff
const fn = retry(asyncFn, { retries: 3, delay: 1000, backoff: 2 })

// Batch with concurrency
await batch(fn, { items, concurrency: 3, failureMode: 'abort' | 'continue' })

// Timeout enforcement
const fn = withTimeout(asyncFn, { timeout: 5000 })

// Debounce/throttle for UI
const fn = debounce(handler, { delay: 300, maxWait: 1000 })
const fn = throttle(handler, { delay: 16 })

// Deep operations
const copy = clone(obj)           // handles circular refs
const same = equals(a, b)         // deep comparison
const val = reach(obj, 'a.b.c')   // safe nested access

// Async control
const d = new Deferred<T>()       // external resolve/reject
d.resolve(value)

// Memoization with LRU
const fn = memoize(asyncFn, { ttl: 60000, maxSize: 100 })
fn.cache.clear()

// Assertions
assert(condition, 'message', CustomError)
```


## Class Patterns

Use private fields with `#` prefix. Namespace types under the class.

```ts
export class StateManager {

    #state: State | null = null

    async load(): Promise<void> {

        const [state, err] = await attempt(() => decrypt(encrypted, this.#key))
        if (err) throw err

        this.#state = state
    }
}

export namespace StateManager {

    export interface Config {
        name: string
        connection: ConnectionConfig
    }
}
```


## JSDoc

Document WHY, not what. Include examples for non-obvious behavior.

```ts
/**
 * Computes checksum for change detection.
 * Uses SHA-256 for collision resistance across large file sets.
 *
 * @example
 * const checksum = await computeChecksum('migrations/001.sql')
 * if (existing?.checksum === checksum) return // unchanged
 */
```
