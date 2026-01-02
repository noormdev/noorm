---
paths: "**/*.{js,jsx,ts,tsx}"
---

# TypeScript Standards


## Function Structure (MANDATORY)

Every function must have exactly 4 blocks in this order:

```typescript
/**
 * Updates user email address after validation.
 *
 * Prevents invalid emails and ensures user exists before update.
 *
 * @example
 * const [user, err] = await modifyUserEmail(userID, newEmail);
 */
function modifyUserEmail(userID: UUID, newEmail: EmailAddress) {

    // === Declaration block ===
    let retryCount = 0;
    const maxRetries = 3;

    // === Validation block ===
    if (!isValidEmail(newEmail)) {

        // Guards against malformed input from external systems
        return [null, new InvalidEmailError()];
    }

    // === Business logic block ===
    const [user, err] = await attempt(() => fetchUser(userID));

    if (err || !user) {

        return [null, new UserNotFoundError()];
    }

    user.email = newEmail;

    // === Commit block ===
    const [saved, saveErr] = await attempt(() => saveUser(user));

    if (saveErr) {

        return [null, saveErr];
    }

    return [saved, null];
}
```

> Block comments (`// ===`) are for documentation only, not required in code.


## Error Handling (ZERO TOLERANCE)

- **NEVER use try-catch** - This is a critical violation
- **ALWAYS use @logosdx/utils utilities**: `attempt`, `attemptSync`, `batch`, `circuitBreaker`, `debounce`, `throttle`, `memo`, `rateLimit`, `retry`, `withTimeout`, `ObserverEngine`, `FetchEngine`

```typescript
// CORRECT
const [result, err] = await attempt(() => db.execute(sql));
if (err) {

    observer.emit('error', { source: 'executor', error: err });

    return;
}

// WRONG - Never do this
try {
    const result = await db.execute(sql);
}
catch (err) {
    // ...
}
```


## Import Organization

```typescript
// Built-ins first
import { readFile } from 'fs/promises';

// External libraries (alphabetical by org)
import {
    attempt,
    attemptSync,
    FetchEngine,
} from '@logosdx/utils';
import Joi from 'joi';

// Local imports (by depth, deepest first)
import * as utils from '../../../utils/index';
import * as controllers from '../../controllers/index';
import * as misc from '../misc';
```


## Code Style (ESLint-Enforced)

These patterns are enforced by ESLint:

```typescript
// 4-space indentation
function example() {

    const value = 'test';
}

// Single quotes, semicolons always
const name = 'value';

// Stroustrup brace style (else on new line)
if (condition) {

    // logic
}
else {

    // other logic
}

// Padded blocks - newline after opening brace, before closing
function doSomething() {

    const x = 1;

    return x;

}

for (const item of items) {

    process(item);

}

// Trailing comma on multiline
const config = {
    name: 'test',
    value: 42,
};

// Object curly spacing
const { name, value } = config;

// Max line length 150
```


## Utilities

Core utilities from `@logosdx/utils`:

```typescript
// Error tuples - Go-style [result, err]
const [data, err] = await attempt(() => db.query());
const [parsed, parseErr] = attemptSync(() => JSON.parse(str));

// Retry with backoff
const fn = retry(asyncFn, { retries: 3, delay: 1000, backoff: 2 });

// Batch with concurrency
await batch(fn, { items, concurrency: 3, failureMode: 'abort' | 'continue' });

// Timeout enforcement
const fn = withTimeout(asyncFn, { timeout: 5000 });

// Debounce/throttle for UI
const fn = debounce(handler, { delay: 300, maxWait: 1000 });
const fn = throttle(handler, { delay: 16 });

// Deep operations
const copy = clone(obj);           // handles circular refs
const same = equals(a, b);         // deep comparison
const val = reach(obj, 'a.b.c');   // safe nested access

// Async control
const d = new Deferred<T>();       // external resolve/reject
d.resolve(value);

// Memoization with LRU
const fn = memoize(asyncFn, { ttl: 60000, maxSize: 100 });
fn.cache.clear();

// Assertions
assert(condition, 'message', CustomError);
```


## Class Patterns

Use private fields with `#` prefix. Namespace types under the class.

```typescript
export class StateManager {

    #state: State | null = null;

    async load(): Promise<void> {

        const [state, err] = await attempt(() => decrypt(encrypted, this.#key));
        if (err) throw err;

        this.#state = state;

    }

}

export namespace StateManager {

    export interface Config {
        name: string;
        connection: ConnectionConfig;
    }

}
```


## JSDoc Requirements

- All functions and classes MUST have JSDoc
- Explain WHY, not what or how
- Include usage examples
- Comment ambiguous validation logic

```typescript
/**
 * Computes checksum for change detection.
 * Uses SHA-256 for collision resistance across large file sets.
 *
 * @example
 * const checksum = await computeChecksum('migrations/001.sql');
 * if (existing?.checksum === checksum) return; // unchanged
 */
```
