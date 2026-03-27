# Per-Request User Impersonation


## Problem

Applications using row-level security (RLS) need queries to run as a specific database principal — not the connection pool's service account. Views filter by `USER_NAME()` (MSSQL) or `current_user` (PostgreSQL), so the correct rows are only returned when the query runs under the right identity.

Today, `Context` provides a single shared Kysely instance backed by a connection pool. There's no way to borrow a dedicated connection, switch identity, run queries as that principal, then revert and release the connection.


## Solution

A new `impersonate()` method on `Context` that borrows a dedicated connection from the pool, executes the dialect's identity-switch SQL, and exposes a scoped query interface. Two calling conventions via overloads:

- **Callback mode** — auto-reverts on callback completion or throw (safe default)
- **Explicit mode** — caller owns the lifecycle, calls `revert()` when done (for cross-boundary lifecycles like Hapi `onPreHandler` → `onPostResponse`)


## Public API


### Overloads

```typescript
// Callback mode — auto-reverts, even on throw
ctx.impersonate<T>(
    username: string,
    fn: (scope: ImpersonatedScope<DB, Procs, Funcs>) => Promise<T>,
): Promise<T>;

// Explicit mode — caller calls scope.revert()
ctx.impersonate(
    username: string,
): Promise<ImpersonatedScope<DB, Procs, Funcs>>;
```

Detection: if the second argument is a function, callback mode. Otherwise, explicit mode.


### ImpersonatedScope

```typescript
interface ImpersonatedScope<DB, Procs, Funcs> {
    kysely: Kysely<DB>;
    proc: Context<DB, Procs, Funcs>['proc'];
    func: Context<DB, Procs, Funcs>['func'];
    transaction: Context<DB, Procs, Funcs>['transaction'];
    revert(): Promise<void>;
}
```

- `kysely` — bound to the dedicated connection, all queries route through it
- `proc` / `func` — same `buildProcCall`/`buildFuncCall` logic, executed against the scoped Kysely
- `transaction` — starts a transaction on the dedicated connection
- `revert()` — executes the dialect's revert SQL, releases the connection back to the pool. Idempotent — second call is a no-op. In callback mode, calling early is allowed but optional.

No `noorm` ops namespace on the scope — impersonation is for query-level work, not schema management or DT operations.

No nesting — calling `impersonate()` on a scope is not supported. Revert first, then impersonate as a different user.


## Connection Lifecycle


### Callback Mode

```typescript
async impersonate<T>(username, fn): Promise<T> {
    return this.kysely.connection().execute(async (db) => {
        await sql.raw(dialectImpersonateSQL(username)).execute(db);
        const scope = buildScope(db, ...);
        try {
            return await fn(scope);
        } finally {
            await sql.raw(dialectRevertSQL()).execute(db);
        }
    });
}
```

The `finally` block guarantees revert even when the callback throws. The `.execute()` callback returning releases the connection back to the pool.


### Explicit Mode — Deferred Promise Pattern

```typescript
async impersonate(username): Promise<ImpersonatedScope> {
    let resolveHolder: () => void;
    const connectionHeld = new Promise<void>(resolve => {
        resolveHolder = resolve;
    });

    let resolveReady: (scope: ImpersonatedScope) => void;
    let rejectReady: (err: unknown) => void;
    const ready = new Promise<ImpersonatedScope>((resolve, reject) => {
        resolveReady = resolve;
        rejectReady = reject;
    });

    const connectionDone = this.kysely.connection().execute(async (db) => {
        await sql.raw(dialectImpersonateSQL(username)).execute(db);
        const scope = buildScope(db, async () => {
            await sql.raw(dialectRevertSQL()).execute(db);
            resolveHolder(); // releases the connection
        });
        resolveReady(scope); // signal that the scope is ready
        await connectionHeld; // holds the callback open
    });

    // If impersonation SQL fails, the .execute() callback throws
    // before resolveReady is called — propagate that to the caller
    connectionDone.catch(err => rejectReady(err));

    return ready;
}
```

Two deferred promises coordinate the lifecycle:

- `ready` — resolved once the impersonation SQL succeeds and the scope is constructed. The outer function awaits this before returning, ensuring the caller receives a fully initialized scope.
- `connectionHeld` — resolved when `scope.revert()` is called, which lets the `.execute()` callback return and Kysely releases the connection.

If the impersonation SQL fails, `connectionDone` rejects before `resolveReady` is called — the `catch` handler forwards the error to `rejectReady`, so the caller's `await` throws with the original error and no scope is leaked.

If `revert()` is never called, the connection leaks. A safety timeout or `FinalizationRegistry` warning could be added later but is not needed for v1.


## Dialect Strategies

A dialect strategy map provides the impersonate and revert SQL for each supported dialect. Unsupported dialects map to `null` and throw at call time.


### MSSQL

```sql
EXECUTE AS USER = '<quoted_username>'
```
```sql
REVERT
```

Requires `IMPERSONATE` permission on the target user. Changes `USER_NAME()`.


### PostgreSQL

```sql
SET ROLE 'username'
```
```sql
RESET ROLE
```

Session user must have `SET` option for the target role. Changes `CURRENT_USER`, `SESSION_USER` unchanged.


### MySQL / SQLite

Throw at call time:

```
ImpersonationError: Impersonation is not supported for the <dialect> dialect
```

MySQL's `SET ROLE` activates/deactivates roles already granted to the connected user — it does not switch identity. SQLite has no user/role system.


### SQL Injection Prevention

`EXECUTE AS USER` and `SET ROLE` are DDL-like statements that do not accept bound parameters. The username must be embedded as a string literal, which requires dialect-specific identifier quoting to prevent SQL injection:

- **MSSQL:** `QUOTENAME(@username)` — wraps in brackets, escapes internal `]` characters. The quoting is done at the SQL level: `EXECUTE AS USER = ' + QUOTENAME(@username) + '` — or equivalently, the application validates and quotes before embedding in `sql.raw()`.
- **PostgreSQL:** `quote_ident(username)` — wraps in double quotes, escapes internal `"` characters. Alternatively, application-side validation with `quote_ident`-equivalent logic before embedding.

As a defense-in-depth measure, the application also validates the username against a restrictive character set (e.g., `[a-zA-Z0-9_@.\-\\]`) before reaching the quoting step. Usernames containing characters outside this set are rejected with an `ImpersonationError`.


## buildScope

Constructs the `ImpersonatedScope` object, wiring `proc`, `func`, and `transaction` to the dedicated connection-bound Kysely instance.

```typescript
function buildScope<DB, Procs, Funcs>(
    db: Kysely<DB>,
    revertFn: () => Promise<void>,
    dialect: Dialect,
): ImpersonatedScope<DB, Procs, Funcs> {
    let reverted = false;

    return {
        kysely: db,

        proc(name, ...args) {
            return buildProcCall(dialect, name, ...args).execute(db);
        },

        func(name, ...args) {
            return buildFuncCall(dialect, name, ...args).execute(db);
        },

        transaction(fn) {
            return db.transaction().execute(fn);
        },

        async revert() {
            if (reverted) return;
            reverted = true;
            await revertFn();
        },
    };
}
```

`proc()` and `func()` use the same `buildProcCall`/`buildFuncCall` from `src/sdk/sql.ts` — the only difference is they `.execute(db)` against the scoped connection instead of `this.kysely`.


## Error Handling

Three categories:

**Unsupported dialect** — thrown before any connection is borrowed. A dialect check at the top of `impersonate()` consults the strategy map and throws `ImpersonationError` if the dialect maps to `null`.

**Impersonation SQL failure** — `EXECUTE AS` / `SET ROLE` fails (missing permissions, user doesn't exist). In callback mode, the `.execute()` callback throws and Kysely releases the connection. In explicit mode, the deferred promise is resolved in a catch block so the connection is still released — the caller never receives a scope.

**User code throws in callback mode** — the `finally` block runs the revert SQL, the original error propagates. If `REVERT` itself fails, the original error dominates (revert failure is secondary).

Errors propagate as-is — no wrapping, no swallowing. Internal lifecycle cleanup uses `finally` for the must-always-run guarantee. Callers use `attempt()` from `@logosdx/utils`.


## Testing Strategy


### Unit Tests

- Callback mode: impersonate SQL → user function → revert SQL (correct order)
- Explicit mode: impersonate SQL on acquire, revert SQL on `scope.revert()`
- Revert runs even when callback throws
- `revert()` is idempotent (second call is no-op)
- Unsupported dialect throws `ImpersonationError`
- `proc()` and `func()` on the scope route through the dedicated connection


### Dialect Tests

- MSSQL: generates `EXECUTE AS USER = @username` / `REVERT`
- PostgreSQL: generates `SET ROLE 'username'` / `RESET ROLE`
- MySQL: throws unsupported error
- SQLite: throws unsupported error


### Integration Tests

- Impersonate, verify `USER_NAME()` (MSSQL) or `CURRENT_USER` (PostgreSQL) reflects the target principal
- Queries against RLS-protected views return correctly scoped data
- Connection is returned to pool after revert


## Use Cases


### Hapi Web Application (Explicit Mode)

```typescript
// onPreHandler — acquire impersonated scope
const dbUsername = request.auth.credentials.username;
const asUser = await ctx.impersonate(dbUsername);
request.app.dbScope = asUser;

// route handler — use scoped queries
const repo = new AuthRepository(request.app.dbScope);
const profile = await repo.getProfile();

// onPostResponse — revert and release
await request.app.dbScope.revert();
```


### Integration Tests (Callback Mode)

```typescript
const individual = await createTestIndividual();

await ctx.impersonate(individual.username, async (scoped) => {
    const stub = { clients: () => ({ noorm: { ctx: scoped } }) };
    const repo = new AuthRepository(stub);

    const profile = await repo.getProfile();
    expect(profile.PartyNo).toBe(individual.partyNo);

    const channels = await repo.getChannels();
    expect(channels.every(c => c.PartyNo === individual.partyNo)).toBe(true);
});
```
