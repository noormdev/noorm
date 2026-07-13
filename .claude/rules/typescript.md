---
paths: "**/*.{js,jsx,ts,tsx}"
---

# TypeScript Standards


## Function Structure (MANDATORY)

Every function body should be organized into up to four logical sections, in this order:

1. **Declaration** — local variables, destructuring, constants
2. **Validation** — input guards, early throws
3. **Business logic** — the actual work
4. **Commit** — final side effects and the return value

Use `attempt(...)` only when this function does something with the error — translate it, recover, emit, etc. If you'd just re-throw or re-return it unchanged, don't wrap — let it propagate naturally.

### The mental model (for thinking about your code)

The block markers below are **authoring aids only**. They show the four sections so you can reason about where code belongs. **Do NOT copy these `// === ... ===` comments into actual source files.** They are not a code artifact — they are a guide you read, then delete.

```typescript
/**
 * Updates user email address after validation.
 *
 * Prevents invalid emails and ensures user exists before update.
 *
 * @example
 * const user = await modifyUserEmail(userID, newEmail);
 */
async function modifyUserEmail(userID: UUID, newEmail: EmailAddress) {

    // === Declaration block ===
    const now = new Date();

    // === Validation block ===
    if (!isValidEmail(newEmail)) {

        throw new InvalidEmailError(newEmail);
    }

    // === Business logic block ===
    // attempt() here because we translate both "fetch failed" and "user missing"
    // into a single UserNotFoundError for the caller.
    const [user, err] = await attempt(() => fetchUser(userID));

    if (err || !user) {

        throw new UserNotFoundError(userID);
    }

    user.email = newEmail;
    user.updatedAt = now;

    // === Commit block ===
    // No attempt() — saveUser's error is already meaningful; let it propagate.
    return saveUser(user);
}
```

### What the code should actually look like

Separate sections with a blank line. No banner comments. Errors propagate unless the function does something with them.

```typescript
/**
 * Updates user email address after validation.
 *
 * Prevents invalid emails and ensures user exists before update.
 *
 * @example
 * const user = await modifyUserEmail(userID, newEmail);
 */
async function modifyUserEmail(userID: UUID, newEmail: EmailAddress) {

    const now = new Date();

    if (!isValidEmail(newEmail)) {

        throw new InvalidEmailError(newEmail);
    }

    const [user, err] = await attempt(() => fetchUser(userID));

    if (err || !user) {

        throw new UserNotFoundError(userID);
    }

    user.email = newEmail;
    user.updatedAt = now;

    return saveUser(user);
}
```

If a section needs a banner comment to be understandable, the function is probably too long — split it.

### When to use `attempt`

Use `attempt` whenever you need to *inspect* the error before deciding what to do. Common cases:

- **Ignore it** — a non-critical cleanup step fails, you don't care.
- **Ignore only specific kinds** — swallow a network timeout, re-throw everything else.
- **Translate it** — collapse several underlying failures into one domain error.
- **Recover** — fall back to a default, retry, read from cache.
- **Observe it** — emit an event, log context, then either continue or re-throw.

```typescript
// Ignore a specific error class, re-throw the rest.
const [res, err] = await attempt(() => fetchRemote(url));
if (err && !(err instanceof NetworkError)) throw err;

// Translate + observe.
const [user, err] = await attempt(() => modifyUserEmail(userID, newEmail));
if (err) {

    observer.emit('user:update-failed', { userID, error: err });
    return;
}
```

If you're going to re-throw the error unchanged in every case, skip `attempt` and let it propagate directly.


## Error Handling (ZERO TOLERANCE)

- **NEVER use try-catch** - This is a critical violation. The zero tolerance targets try-catch specifically, not throwing or `attempt`/`attemptSync` - see Function Structure above for when to wrap deliberately vs. let errors propagate.
- **Mandated `@logosdx/utils` utilities**: `attempt`/`attemptSync` (the convention actually in use - 553 call sites across 175 files) and `retry` (used at `src/core/connection/factory.ts:93`). Use `attempt`/`attemptSync` per the Function Structure guidance above - only when the function does something with the error.
- **Available in `@logosdx/utils` but not currently used**: `batch`, `circuitBreaker`, `debounce`, `throttle`, `memo`/`memoize`, `rateLimit`, `withTimeout`, `FetchEngine`. Reach for them if a real need arises; they are not mandated because nothing in `src/` imports them today.
- `ObserverEngine` is `@logosdx/observer`, not `@logosdx/utils`.

```typescript
// CORRECT - attempt() used deliberately: observes the error, emits, then stops
const [result, err] = await attempt(() => db.execute(sql));
if (err) {

    observer.emit('error', { source: 'executor', error: err });

    return;
}

// ALSO CORRECT - nothing to add by wrapping; let the error propagate
return db.execute(sql);

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
