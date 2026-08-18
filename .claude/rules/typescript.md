---
paths:
  - "**/*.{js,jsx,ts,tsx}"
---

# TypeScript standards


General TypeScript judgment (`const` over `let`, no `as`, no `any`, inference over annotation, short functions) is covered by the global TypeScript style rules and is not repeated here. This file carries only what is specific to noorm.


## Function structure

Organize every function body into up to four sections, in this order, separated by a blank line:

1. **Declaration** — local variables, destructuring, constants
2. **Validation** — input guards, early throws
3. **Business logic** — the work
4. **Commit** — final side effects and the return value

No banner comments marking the sections. If a section needs one to be understandable, the function is too long; split it.

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

    // attempt() here because we collapse "fetch failed" and "user missing"
    // into one UserNotFoundError for the caller.
    const [user, err] = await attempt(() => fetchUser(userID));

    if (err || !user) {

        throw new UserNotFoundError(userID);

    }

    user.email = newEmail;
    user.updatedAt = now;

    // No attempt() here: saveUser's error is already meaningful, so let it propagate.
    return saveUser(user);

}
```


## Error handling


### Never bind a catch parameter

`catch (err)` appears **zero** times in `src/`. Use `attempt`/`attemptSync` instead; the error tuple is the convention (600+ call sites across 187 files).

```typescript
// Correct: attempt() observes the error, emits, then stops
const [result, err] = await attempt(() => db.execute(sql));

if (err) {

    observer.emit('error', { source: 'executor', error: err });

    return;

}

// Also correct: nothing to add by wrapping, so let it propagate
return db.execute(sql);

// Wrong
try {
    const result = await db.execute(sql);
}
catch (err) {
    // ...
}
```

`try { } finally { }` for cleanup binds no error and swallows nothing. It is permitted and used at 4 sites, including `src/core/lock/manager.ts:358` and `src/sdk/context.ts:570`.

Four bare `catch { }` blocks remain in TUI code (`RunFileScreen.tsx:273`, `RunDirScreen.tsx:336`, `LogViewerOverlay.tsx:78`, `SecretValueForm.tsx:154`). They are the "may fail, do not care" case, which `attemptSync` expresses without a `try`. Convert them when you touch the surrounding code; do not add more.

This rule also reaches `tests/**` through this file's glob, where 17 genuine `try/catch` blocks currently violate it (`tests/core/config/schema.test.ts:203` and 10 other files). Use `attempt` plus `expect(err)` there instead.


### Wrap with `attempt` only when the function acts on the error

If every branch re-throws the error unchanged, skip `attempt` and let it propagate. Reach for it when you need to inspect the error first:

| Intent | Example |
|--------|---------|
| Ignore it | a non-critical cleanup step fails |
| Ignore specific kinds | swallow a network timeout, re-throw everything else |
| Translate it | collapse several failures into one domain error |
| Recover | fall back to a default, retry, read from cache |
| Observe it | emit an event or log context, then continue or re-throw |

```typescript
// Ignore a specific error class, re-throw the rest.
const [res, err] = await attempt(() => fetchRemote(url));
if (err && !(err instanceof NetworkError)) throw err;
```


## Shared utilities actually in use

| Symbol | Package | Where |
|--------|---------|-------|
| `attempt` / `attemptSync` | `@logosdx/utils` | everywhere; the error-handling convention |
| `retry` | `@logosdx/utils` | `src/core/connection/factory.ts:118`, `src/core/update/updater.ts:227` |
| `runWithTimeout` | `@logosdx/utils` | `src/core/connection/manager.ts:217`, `src/core/lifecycle/manager.ts:343` |
| `ObserverEngine` / `ObserverRelay` | `@logosdx/observer` | `src/core/observer.ts:19`, `src/core/worker-bridge/bridge.ts:2` |

`@logosdx/utils` also exports `batch`, `circuitBreaker`, `debounce`, `throttle`, `memoize`, `rateLimit`, `withTimeout`, `clone`, `equals`, `reach`, `Deferred`, and `assert`. Nothing in `src/` imports any of them. Reach for one if a real need arises, and read its signature from the package types rather than assuming it.

`FetchEngine` is not in `@logosdx/utils`; it lives in `@logosdx/fetch`. There is no `memo` export, only `memoize` and `memoizeSync`.


## Formatting

ESLint enforces all of the following (`eslint.config.js`), so `bun run lint` is the authority. Listed here to get it right the first time:

| Rule | Setting |
|------|---------|
| `indent` | 4 spaces |
| `quotes` | single, `avoidEscape` |
| `semi` | always |
| `brace-style` | stroustrup (`else` on a new line) |
| `padded-blocks` | always (blank line after `{`, before `}`) |
| `padding-line-between-statements` | blank line before every `return` |
| `comma-dangle` | always on multiline |
| `object-curly-spacing` | always |
| `array-bracket-spacing` | never |
| `max-len` | 150, strings and URLs exempt |
| `unused-imports/no-unused-vars` | `^_` prefix exempts a binding |
| `no-multiple-empty-lines` | max 2 |

Import order is **not** enforced and not consistently followed in `src/`. Match the file you are editing.


## Classes

Use `#` private fields. 30 files do; zero use the TypeScript `private` keyword on a field, because `private` is erased at compile time while `#` is enforced at runtime.

```typescript
export class StateManager {

    #state: State | null = null;

    async load(): Promise<void> {

        const [state, err] = await attempt(() => decrypt(encrypted, this.#key));
        if (err) throw err;

        this.#state = state;

    }

}
```

`protected override` on a method is the one exception, and only when overriding a third-party base class member that `#` cannot express (`src/core/worker-bridge/bridge.ts:61`).


## JSDoc

Every exported function and class needs a JSDoc block. Explain WHY, not what or how, and include a usage example.

Current coverage: 99.5% of exported functions, 81% of exported classes. The gap is concentrated in `src/sdk/namespaces/*.ts`, which is public SDK surface; add the block when you touch one.

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
