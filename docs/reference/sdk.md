# SDK Reference


## Overview

The noorm SDK provides programmatic access to noorm-managed databases. Use it for:

- **Application code** - Query and mutate data from your apps
- **Test suites** - Reset and seed databases between tests
- **Scripts** - Data transforms, exports, and automation
- **CI/CD** - Headless database operations


## Installation

```bash
pnpm add @noormdev/sdk
```


## Quick Start

```typescript
import { createContext } from '@noormdev/sdk';

const ctx = await createContext<{ users: { id: number; name: string } }>({
    config: 'dev',
});
await ctx.connect();

// Top-level — SQL focused
const users = await ctx.kysely
    .selectFrom('users')
    .select(['id', 'name'])
    .execute();

// Noorm operations — under namespace
await ctx.noorm.changes.ff();

await ctx.disconnect();
```


## createContext(options)

Creates an SDK context for programmatic database access.

```typescript
interface CreateContextOptions {
    config?: string;          // Config name (or use NOORM_CONFIG env var)
    projectRoot?: string;     // Defaults to process.cwd()
    requireTest?: boolean;    // Refuse if config.isTest !== true
    channel?: Channel;        // 'user' (default) or 'agent' — which access role applies
    stage?: string;           // Stage name for stage defaults
    yes?: boolean;            // Pre-confirm operations a policy 'confirm' cell would block
}

const ctx = await createContext<MyDatabase>({
    config: 'test',
    requireTest: true,
});
```

**Options:**

| Option           | Type      | Description                                                      |
| ---------------- | --------- | ---------------------------------------------------------------- |
| `config`         | `string`  | Config name to use. Falls back to `NOORM_CONFIG` env var.        |
| `projectRoot`    | `string`  | Path to noorm project. Defaults to `process.cwd()`.              |
| `requireTest`    | `boolean` | Throws `RequireTestError` if config doesn't have `isTest: true`. |
| `channel`        | `Channel` | Which caller channel this context represents for access-policy checks. Defaults to `'user'`. A destructive operation the config's role denies — or that resolves to "requires confirmation," which the SDK can't prompt for — throws `ProtectedConfigError`. |
| `stage`          | `string`  | Stage name for inheriting stage defaults.                        |
| `yes`            | `boolean` | Pre-confirms operations that a policy "requires confirmation" cell would otherwise block, the programmatic equivalent of the CLI's `--yes`. Defaults to `false`. Only meaningful on the `user` channel: on `agent`, confirmation collapses to denial before `yes` is read, so an agent cannot use it to pass a gate meant for a human. |

There is no `connection` option. Connection details come either from a stored config or, when `NOORM_CONNECTION_DIALECT` and `NOORM_CONNECTION_DATABASE` are set, from the environment — in which case `createContext()` needs no `.noorm/` directory and no identity at all. That is the mode to use in production; see [Deploying an Application](/guide/deployment).

> Access is per-config, not per-context: each config declares `access: { user, agent }` (roles `viewer`/`operator`/`admin`, or `agent: false` to hide the config from agents entirely, over MCP and the CLI alike). `channel` tells `createContext` which half of that grant to enforce — see [Access Roles](/guide/environments/configs#access-roles).

The gate sits at the core seam, so it applies to every method on `ctx.noorm.run`, `.db`, `.changes`, `.lock.forceRelease`, `.vault`, `.secrets`, `.templates`, `.transfer`, and `.dt.importFile`. Raw `ctx.kysely` queries are not gated. Four permissions require confirmation even for `admin` (`db:truncate`, `db:teardown`, `vault:propagate`, `lock:force`), so `ctx.noorm.db.truncate()` on an admin config still throws `ProtectedConfigError` unless the context was created with `yes: true`.


## Top-Level Context Properties

| Property    | Type         | Description                                       |
| ----------- | ------------ | ------------------------------------------------- |
| `kysely`    | `Kysely<DB>` | Direct Kysely access (requires `connect()`)       |
| `dialect`   | `Dialect`    | Database dialect (postgres, mysql, sqlite, mssql)  |
| `connected` | `boolean`    | Whether currently connected                        |
| `noorm`     | `NoormOps`   | Noorm management operations (lazy singleton)       |


## Lifecycle Methods


### connect(retryOptions?)

Establishes the database connection. Calling it on an already-connected context is a no-op.

```typescript
await ctx.connect();

// Fail fast instead of hanging on an unreachable database.
await ctx.connect({ retries: 1, delay: 0 });
```

`retryOptions` is `ConnectionRetryOptions`: `{ retries?: number; delay?: number; backoff?: number }`, defaulting to `3` attempts, `1000`ms delay, and a `2x` backoff multiplier. Retries cover transient failures (`ECONNREFUSED`, `ETIMEDOUT`); authentication failures and missing drivers fail on the first attempt.


### disconnect()

Closes the database connection.

```typescript
await ctx.disconnect();
```


## Transactions


### transaction(fn)

Execute operations within a database transaction. The callback receives a full Kysely `Transaction<DB>` with query builder, `sql` template literal, and all Kysely features.

```typescript
import { sql } from 'kysely';

const result = await ctx.transaction(async (trx) => {
    await trx
        .updateTable('accounts')
        .set({ balance: sql`balance - ${amount}` })
        .where('id', '=', fromId)
        .execute();
    await trx
        .updateTable('accounts')
        .set({ balance: sql`balance + ${amount}` })
        .where('id', '=', toId)
        .execute();
    return { transferred: amount };
});
```


## Impersonation


### impersonate(username, fn?)

Run queries as a different database principal. The SDK borrows one connection from the pool, switches identity on it, and hands you a scope whose `kysely`, `proc`, `func`, `tvf`, and `transaction` all route through that connection.

Supported on MSSQL (`EXECUTE AS USER` / `REVERT`) and PostgreSQL (`SET ROLE` / `RESET ROLE`). MySQL and SQLite throw `ImpersonationError`, as does a username containing anything outside alphanumerics, `_`, `@`, `.`, `-`, and `\`.

```typescript
import { ImpersonationError, type ImpersonatedScope } from '@noormdev/sdk';

// Callback mode: reverts on the way out, including when the callback throws.
const rows = await ctx.impersonate('app_readonly', async (scope) => {
    return scope.kysely.selectFrom('users').selectAll().execute();
});

// Explicit mode: you own the lifecycle.
const scope = await ctx.impersonate('app_readonly');
const users = await scope.kysely.selectFrom('users').selectAll().execute();
await scope.revert();
```

Explicit mode holds a pooled connection until you call `revert()`. `ctx.disconnect()` releases any scope you never reverted, so a forgotten `revert()` cannot deadlock shutdown, but it does keep a connection out of the pool until then. Prefer callback mode unless you need the scope to outlive one function.

An `ImpersonatedScope` carries no `noorm` namespace and no lifecycle methods. Management operations stay on `ctx.noorm`, running as the context's own principal.


## Stored Procedures, Functions & TVFs

Type-safe helpers for calling stored procedures, database functions, and table-valued functions. Define your signatures as interfaces, then pass them as generics to `createContext`:

```typescript
interface MyProcs {
    'get_users': [{ department_id: number; active: boolean }, User];
    'simple_proc': [[number, string], void];
    'refresh_cache': void;
}

interface MyFuncs {
    'calc_total': [{ order_id: number }, { total: number }];
    'add_numbers': [[number, number], { result: number }];
    'get_version': void;
}

interface MyTvfs {
    'get_team_members': [{ team_id: number }, TeamMember];
    'generate_series': [[number, number], { value: number }];
}

const ctx = await createContext<MyDB, MyProcs, MyFuncs, MyTvfs>({ config: 'dev' });
```

Each entry maps a name to an `[Args, ReturnType]` tuple. For positional params, wrap in a nested tuple: `[[number, string], ReturnType]`. Plain `void` is shorthand for `[void, void]`.

When `Procs`, `Funcs`, or `Tvfs` are not provided, the corresponding method (`proc()`, `func()`, `tvf()`) cannot be called — the type system enforces that you define signatures first.


### proc(name, params?)

Call a stored procedure and return the result set rows. Generates dialect-specific SQL:

| Dialect    | Named Params                          | Positional      | No Params     |
| ---------- | ------------------------------------- | --------------- | ------------- |
| MSSQL      | `EXEC name @k = $1`                   | `EXEC name $1`  | `EXEC name`   |
| PostgreSQL | `CALL name(k => $1)`                  | `CALL name($1)` | `CALL name()` |
| MySQL      | `CALL name($1)` (positional fallback) | `CALL name($1)` | `CALL name()` |

```typescript
// Named params — return type inferred from tuple
const users = await ctx.proc('get_users', { department_id: 1, active: true });
// users: User[]

// Positional params
await ctx.proc('simple_proc', [42, 'hello']);

// No params
await ctx.proc('refresh_cache');

// Override return type explicitly
const custom = await ctx.proc<'get_users', CustomUser>('get_users', { department_id: 1, active: true });
// custom: CustomUser[]
```

**Returns:** `Promise<T[]>` — the result set rows. `T` is inferred from the `[Args, ReturnType]` tuple, or overridden via the second generic.

**Throws** on SQLite (no stored procedure support).

Procedure, function, and column names are quoted per dialect (`"name"` on PostgreSQL, `[name]` on MSSQL, `` `name` `` on MySQL), so mixed-case and reserved-word names survive. A schema-qualified name splits on the first `.` and each half is quoted separately.

On PostgreSQL, `proc()` falls back to a function call when `CALL` reports the target is not a procedure (SQLSTATE `42809` or `42883`). The SDK retries as `SELECT * FROM name(...)`, so `proc()` reaches both `CREATE PROCEDURE` and `CREATE FUNCTION` objects.


### Parameter handling and NULL semantics

The SDK picks **one** wire-level meaning for "absent value" and sticks
to it: every key whose value is `undefined` or `null` in the params
object serializes as SQL `NULL`. The SDK does NOT silently drop
`undefined` keys, and it does NOT distinguish `null` from `undefined`
when generating named-parameter SQL. If the key is present in the
object, the SDK emits `@key = NULL` (or the dialect-specific
equivalent).

This matters most for MSSQL stored procedures with `DEFAULT` values.
MSSQL applies a parameter's `DEFAULT` only when the parameter is
*omitted from the call*, not when it's explicitly `NULL`. Sending
`@was_inferred = NULL` against `@was_inferred BIT = 0` will overwrite
the default with NULL — and then fail an INSERT into a `NOT NULL`
column.


#### Why this convention

JavaScript carries two values that mean "no value": `undefined` and
`null`. Mapping both to SQL `NULL` makes the wire-level behavior
predictable across `JSON.stringify` round-trips, Zod schemas with
`.optional()`, and conditional spreads (`...maybeKey && { key }`).
The alternative — treating `undefined` as "omit the key" and `null`
as "send NULL" — works in JavaScript but breaks for HTTP request
bodies and any serializer that drops `undefined` on the way in.

The trade-off is that you can't rely on the proc's `DEFAULT`
mechanism through an optional Zod field. Two patterns avoid the
surprise:

```typescript
// Pattern A — encode the default in the schema.
const memoryFlags = z.object({
    wasInferred: z.boolean().default(false),
    wasObserved: z.boolean().default(false),
});

// Pattern B — omit the key entirely when "absent".
const params: Record<string, unknown> = { content: 'x' };
if (wasInferred !== undefined) {
    params.wasInferred = wasInferred;
}
// SDK only emits @wasInferred when the key is present.
await ctx.proc('sp_Memory_Create', params);
```

Pattern A pushes the default value into the TypeScript layer; pattern
B keeps it in SQL and trusts MSSQL's `DEFAULT` mechanism.


#### Zod cheat-sheet

| Schema | Parses missing key to | SDK emits |
|--------|----------------------|-----------|
| `z.string()` | (rejects) | n/a — validation fails before SDK call |
| `z.string().nullable()` | `null` if value is `null` | `@key = NULL` |
| `z.string().optional()` | `undefined` | `@key = NULL` (key still present) |
| `z.string().default('')` | `''` | `@key = ''` |

The pitfall: `z.string().optional()` reads like "the SDK will leave
the parameter alone" but actually means "the SDK will send NULL."
If the proc parameter is `NOT NULL` (or the underlying column is),
prefer `.default(...)` or build the params object manually.


#### When NULL is what you actually want

For columns that genuinely store `NULL`, this convention is exactly
what you want:

```typescript
// Either path produces @description = NULL.
await ctx.proc('sp_Project_Update', { id: 1, description: undefined });
await ctx.proc('sp_Project_Update', { id: 1, description: null });
```

Both are equivalent. Pick the one that reads better at the call site
— usually `undefined` for "the input didn't carry this field" and
`null` for "explicitly clear the field."


### Table-Valued Parameters (TVP)

Pass structured table data to MSSQL stored procedures, scalar functions, and table-valued functions using the `tvp()` helper. TVPs are an MSSQL-only feature — calling with TVP params on other dialects throws.

Instead of binding TVP objects through Kysely's driver (which lacks native TVP type detection), the SDK generates a DECLARE/INSERT batch. All user values remain parameterized — no SQL injection risk.

```typescript
import { tvp, type TvpValue } from '@noormdev/sdk';
```

`TvpValue` is generic — `TvpValue<T>` preserves the row type through your proc, func, and tvf signatures so the compiler catches mismatched columns at call sites. The default `TvpValue` (without a type parameter) is equivalent to `TvpValue<Record<string, unknown>>`, so existing unparameterized signatures continue to work.

```typescript
interface BatchItem { title: string; priority: number; list_id: string }

interface MyProcs {
    'batch_insert': [{ user_id: string; items: TvpValue<BatchItem> }, { count: number }];
    'bulk_process': [[number, TvpValue<BatchItem>], void];
}

interface MyFuncs {
    'score_items': [{ multiplier: number; items: TvpValue<BatchItem> }, { total: number }];
}

interface MyTvfs {
    'match_items': [{ user_id: string; items: TvpValue<BatchItem> }, MatchedItem];
}

const ctx = await createContext<MyDB, MyProcs, MyFuncs, MyTvfs>({ config: 'dev' });
await ctx.connect();
```

Call with `tvp(typeName, rows)` — the type name is the SQL Server table type, and rows is an array of objects whose keys match the type's columns. The generic parameter is inferred from the row objects, so `tvp('ItemBatch', items)` returns `TvpValue<BatchItem>` when `items` is `BatchItem[]`:

```typescript
const items: BatchItem[] = [
    { title: 'Task A', priority: 1, list_id: '...' },
    { title: 'Task B', priority: 2, list_id: '...' },
];

// proc — named params (items type-checked against TvpValue<BatchItem>)
await ctx.proc('batch_insert', {
    user_id: '123',
    items: tvp('ItemBatch', items),
});

// proc — positional params
await ctx.proc('bulk_process', [42, tvp('ItemBatch', items)]);

// func — scalar result from TVP (uses EXEC @result = func pattern)
const result = await ctx.func('score_items', {
    multiplier: 2,
    items: tvp('ItemBatch', items),
}, 'total');

// tvf — row set from TVP (uses SELECT * FROM tvf(...))
const rows = await ctx.tvf('match_items', {
    user_id: '123',
    items: tvp('ItemBatch', items),
});
```

**Generated SQL by method:**

```sql
-- proc (named)
DECLARE @__tvp_items ItemBatch;
INSERT INTO @__tvp_items ([title], [priority]) VALUES (@1, @2), (@3, @4);
EXEC batch_insert @user_id = @5, @items = @__tvp_items

-- func (EXEC @result pattern)
DECLARE @__tvp_items ItemBatch;
INSERT INTO @__tvp_items ([title], [priority]) VALUES (@1, @2), (@3, @4);
DECLARE @__result sql_variant; EXEC @__result = score_items @multiplier = @5, @items = @__tvp_items; SELECT @__result AS total

-- tvf (SELECT * FROM)
DECLARE @__tvp_items ItemBatch;
INSERT INTO @__tvp_items ([title], [priority]) VALUES (@1, @2), (@3, @4);
SELECT * FROM match_items(@5, @__tvp_items)
```

**Features:**

| Feature | Example |
| --- | --- |
| Works with proc, func, tvf | `ctx.proc(...)`, `ctx.func(...)`, `ctx.tvf(...)` |
| Schema-qualified type | `tvp('dbo.ItemBatch', rows)` |
| Empty TVP (zero rows) | `tvp('ItemBatch', [])` — passes empty table |
| Multiple TVPs per call | Both `Orders: tvp(...)` and `Items: tvp(...)` in one call |
| Impersonated scopes | `scope.proc('...', { items: tvp(...) })` |
| Many rows | Tested with 50+ rows per TVP |

**Validation:**

The `tvp()` helper validates inputs at creation time:

- **Row key consistency** — all rows must have the same keys as the first row. Throws with a clear message identifying the mismatched row.
- **Empty type name** — throws `TVP type name is required.`

The SQL builders validate before generating SQL:

- **Parameter count limit** — MSSQL supports at most 2,100 bound parameters per batch. The SDK counts `(TVP rows × columns) + scalar params` and throws early: `TVP parameter count (2401) exceeds MSSQL limit of 2100. Split your TVP rows into smaller batches and call the procedure multiple times.`
- **Dialect guard** — throws `Table-valued parameters (TVP) are only supported on MSSQL.` on non-MSSQL dialects.


### func(name, params?, column)

Call a database function and return the scalar result. Generates `SELECT name(...) AS column`, except on MSSQL with named params, where T-SQL has no named-argument form for `SELECT` and the SDK uses `EXEC @var = name` instead. MySQL rejects named params outright.

| Dialect    | Named Params                                   | Positional               | No Params              |
| ---------- | ---------------------------------------------- | ------------------------ | ---------------------- |
| MSSQL      | `EXEC @var = name @k = $1; SELECT @var AS col` | `SELECT name($1) AS col` | `SELECT name() AS col` |
| PostgreSQL | `SELECT name(k => $1) AS col`                  | `SELECT name($1) AS col` | `SELECT name() AS col` |
| MySQL      | throws (pass an array instead)                 | `SELECT name($1) AS col` | `SELECT name() AS col` |

Passing an object to `func()` on MySQL throws `MySQL does not support named parameters in function calls. Use positional parameters (array) instead.` This is the one place where a params object is not silently reordered into positional form: `proc()` on MySQL does flatten an object to `Object.values()` order, which is why `func()` refuses rather than guessing.

```typescript
// Named params + column alias — return type inferred from tuple
const result = await ctx.func('calc_total', { order_id: 42 }, 'total');
// result: { total: number }

// Positional params + column alias
const sum = await ctx.func('add_numbers', [1, 2], 'result');
// sum: { result: number }

// No params — just column alias
const ver = await ctx.func('get_version', 'v');

// Override return type explicitly
const custom = await ctx.func<'calc_total', { amount: number }>('calc_total', { order_id: 42 }, 'amount');
// custom: { amount: number }
```

**Returns:** `Promise<T>` — the first row (scalar value as `{ column: value }`). `T` is inferred from the `[Args, ReturnType]` tuple, or overridden via the second generic.

**Throws** on SQLite (no database function call support).


### tvf(name, params?)

Call a table-valued function and return the result set rows. Supported on MSSQL and PostgreSQL only.

| Dialect    | Named Params                              | Positional                | No Params               |
| ---------- | ----------------------------------------- | ------------------------- | ----------------------- |
| MSSQL      | `SELECT * FROM name($1)` (flattened)      | `SELECT * FROM name($1)` | `SELECT * FROM name()`  |
| PostgreSQL | `SELECT * FROM name(k => $1)`             | `SELECT * FROM name($1)` | `SELECT * FROM name()`  |

A T-SQL `FROM` clause takes only positional arguments, so on MSSQL a params object is flattened to its values in key order. Declare MSSQL TVF params as an array when the order matters to you rather than relying on object key order.

```typescript
// Named params — return type inferred from tuple
const members = await ctx.tvf('get_team_members', { team_id: 5 });
// members: TeamMember[]

// Positional params
const series = await ctx.tvf('generate_series', [1, 10]);
// series: { value: number }[]

// Override return type explicitly
const custom = await ctx.tvf<'get_team_members', CustomMember>('get_team_members', { team_id: 5 });
// custom: CustomMember[]
```

**Returns:** `Promise<T[]>` — the result set rows. `T` is inferred from the `[Args, ReturnType]` tuple, or overridden via the second generic.

**Throws** on SQLite and MySQL (no table-valued function support).


## ctx.noorm — Noorm Operations


### Properties

| Property   | Type             | Description                             |
| ---------- | ---------------- | --------------------------------------- |
| `config`   | `Config`         | The resolved config object              |
| `settings` | `Settings`       | Project settings (paths, rules, stages) |
| `identity` | `Identity`       | Current operator identity               |

There is no `ctx.noorm.observer`. Events come off the process-global `noormObserver` export instead. See [Event Subscriptions](#event-subscriptions).


### ctx.noorm.run — Run Operations


#### run.build(options?)

Execute all SQL files in the schema directory.

```typescript
const result = await ctx.noorm.run.build({ force: true });
console.log(`Ran ${result.filesRun} files`);
```

**Options (`BuildOptions`):** `{ force?: boolean; dryRun?: boolean }`.

**Returns:** `Promise<BatchResult>`. See [Result shape](#run-result-shape) for the `error` and `skipReason` fields you'll find on each entry of `result.files`.

`build()` is the one run method that applies `settings.build.include` / `exclude` and `settings.rules`, so headless callers see the same file set the TUI's Run Build screen shows. Include or exclude entries that matched no file come back as `result.unmatchedInclude` / `result.unmatchedExclude` rather than as a failure: a build over zero files still succeeds, so these arrays are how a mistyped pattern surfaces.


#### run.file(filepath, options?)

Execute a single SQL file.

```typescript
await ctx.noorm.run.file('seeds/test-data.sql');
```

**Returns:** `Promise<FileResult>`. On failure `result.error` carries the SQL/load error message; on skip `result.skipReason` carries `'unchanged'` or `'already-run'`.


#### run.files(filepaths, options?)

Execute multiple SQL files sequentially.

```typescript
await ctx.noorm.run.files([
    'functions/utils.sql',
    'triggers/audit.sql',
]);
```

**Returns:** `Promise<BatchResult>`. Per-file errors and skip reasons live on `result.files[]`.


#### run.dir(dirpath, options?)

Execute all SQL files in a directory.

```typescript
await ctx.noorm.run.dir('seeds/');
```

**Returns:** `Promise<BatchResult>`. Per-file errors and skip reasons live on `result.files[]`.


#### Run result shape

`FileResult` (returned by `run.file`, and by each entry in `BatchResult.files`):

| Field | Type | When set |
|-------|------|----------|
| `filepath` | `string` | Always |
| `checksum` | `string` | Always (empty when the file could not be read) |
| `status` | `'success' \| 'failed' \| 'skipped'` | Always |
| `error` | `string` | Only when `status === 'failed'` |
| `skipReason` | `'unchanged' \| 'already-run'` | Only when `status === 'skipped'` |
| `durationMs` | `number` | Set for executed and failed files |
| `renderedSql` | `string` | Only in preview mode (`run.preview`) |
| `outputPath` | `string` | Only on a dry run that wrote rendered SQL to disk |

Example handling a failed build:

```typescript
const result = await ctx.noorm.run.build();

if (result.status !== 'success') {

    for (const file of result.files) {

        if (file.status === 'failed') {

            console.error(`${file.filepath}: ${file.error}`);

        }

    }

    process.exit(1);

}
```


#### run.discover(dirpath?)

Discover SQL files in a directory without executing. Works offline — no connection required. Defaults to the project's configured SQL path.

```typescript
const files = await ctx.noorm.run.discover('sql/');
console.log(`Found ${files.length} SQL files`);
```

**Returns:** `Promise<string[]>` — absolute paths to discovered SQL files.


#### run.preview(filepaths, output?)

Render SQL files (including templates) without executing. Useful for reviewing what would run before committing.

```typescript
const results = await ctx.noorm.run.preview(['sql/001.sql', 'sql/002.sql']);
for (const r of results) {
    console.log(`${r.filepath}:\n${r.renderedSql}`);
}
```

**Returns:** `Promise<FileResult[]>` — the rendered SQL for each file lands in `renderedSql`, not `sql`. A file that failed to load or render comes back with `status: 'failed'` and an `error` message instead of throwing.

Pass a second argument to write the combined output to a file: `run.preview(paths, 'tmp/preview.sql')`. Rendering resolves every secret into the returned string, so treat preview output as plaintext secrets.


### ctx.noorm.db — Database Operations


#### db.truncate(options?)

Wipe all data, keeping the schema intact.

```typescript
const result = await ctx.noorm.db.truncate();
console.log(`Truncated ${result.truncated.length} tables`);

// Keep a reference table standing.
await ctx.noorm.db.truncate({ preserve: ['countries'] });

// Or restrict the wipe to a few tables.
await ctx.noorm.db.truncate({ only: ['users', 'posts'] });
```

**Options (`TruncateOptions`):**

| Option            | Type       | Default | Description                                                                |
| ----------------- | ---------- | ------- | -------------------------------------------------------------------------- |
| `preserve`        | `string[]` | —       | Tables to leave alone. Falls back to `settings.teardown.preserveTables`.   |
| `only`            | `string[]` | —       | Truncate only these tables. Inverse of `preserve`.                          |
| `restartIdentity` | `boolean`  | `true`  | Restart identity / auto-increment sequences.                                |
| `dryRun`          | `boolean`  | `false` | Return the SQL in `result.statements` without executing it.                 |

**Returns:** `Promise<TruncateResult>` — `{ truncated, preserved, statements, durationMs }`.

A `dryRun` is checked against the config's role but never against a confirmation gate, so a role that may truncate can always look first. A role that may not truncate cannot preview either.

**Implementation notes.** FK constraints are disabled first, every targeted table is `DELETE`d (or `TRUNCATE`d, where the dialect supports it), then constraints are re-enabled. PG/MySQL/SQLite flip a session- or connection-level switch once. MSSQL, which has no session-level toggle, emits one `ALTER TABLE [name] NOCHECK CONSTRAINT ALL` per truncated table on a single connection — replacing the older `sp_MSforeachtable` call that spawned parallel workers and could deadlock. See [dev/teardown.md](../dev/teardown.md#mssql-truncate-strategy) for the full reasoning.


#### db.teardown(options?)

Drop all database objects except noorm's own internal tables, which cover change tracking, locks, vault, and identities.

```typescript
const result = await ctx.noorm.db.teardown();

// Compute the drop plan without executing it.
const plan = await ctx.noorm.db.teardown({ dryRun: true });

// Leave an application-owned schema untouched.
await ctx.noorm.db.teardown({ preserveSchemas: ['app_private'] });
```

**Options (`TeardownOptions`):** the SDK reads two fields off what you pass, `dryRun` and `preserveSchemas`. It fills `preserveTables` and `postScript` from `settings.teardown` in `settings.yml`. The remaining `TeardownOptions` fields (`keepViews`, `keepFunctions`, `keepProcedures`, `keepTypes`, and a caller-supplied `preserveTables`) are dropped on the way through and have no effect from the SDK.

`preserveSchemas` exists because `preserveTables` is a flat name list: excluding `app_private.secrets` by name would also spare `public.secrets`.

**Returns:** `Promise<TeardownResult>` — `{ dropped: { tables, views, functions, procedures, types, foreignKeys }, preserved, statements, durationMs }`, plus `postScriptResult`, `staleCount`, and `resetRecordId` when they apply.

As with `truncate`, a `dryRun` is gated on the role but not on confirmation.


#### db.previewTeardown()

Preview what teardown would drop without executing. Useful for confirming destructive operations before running them.

```typescript
const preview = await ctx.noorm.db.previewTeardown();
for (const [kind, names] of Object.entries(preview.toDrop)) {
    console.log(`Would drop ${names.length} ${kind}`);
}
```

**Returns:** `Promise<TeardownPreview>` — `{ toDrop, toPreserve, statements }`. `toDrop` groups names by object kind (`tables`, `views`, `functions`, `procedures`, `types`, `foreignKeys`); there is no flat `objects` array.


#### db.reset()

Full rebuild: teardown + build.

```typescript
await ctx.noorm.db.reset();
```

**Returns:** `Promise<void>`. Unlike `teardown()` and `truncate()`, `reset()` takes no options and deliberately ignores `settings.teardown.preserveTables`: it rebuilds the whole schema from `sql/`, so any preserved table would collide with the build's `CREATE TABLE` and abort the rebuild.

**Implementation notes.** Objects are dropped in `FK → Procedures → Functions → Views → Tables → Types` order. Procs/funcs/views go before tables because MSSQL schema-bound objects (`WITH SCHEMABINDING`) hold dependency locks on the tables they reference — dropping the table first fails with `Cannot DROP TABLE ... because it is being referenced by object ...`. Types drop last because TVPs may still be referenced by procs/funcs earlier in the chain. See [dev/teardown.md](../dev/teardown.md#drop-order) for the full reasoning.


### ctx.noorm.changes — Change Management


#### Scaffold Operations (offline)

These operations work without a database connection — they manage change directories on disk.


#### changes.create(options)

Create a new change directory with `change/` and `revert/` folders.

```typescript
const change = await ctx.noorm.changes.create({ description: 'add-user-roles' });
console.log(change.name); // e.g. '2024-01-15-add-user-roles'
```

**Returns:** `Promise<Change>` — the parsed change object.


#### changes.addFile(change, folder, options)

Add a file to a change's `change/` or `revert/` folder.

```typescript
const updated = await ctx.noorm.changes.addFile(change, 'change', {
    name: 'create-table',
    type: 'sql',
});
```

**Returns:** `Promise<Change>` — the updated change object.


#### changes.removeFile(change, folder, filename)

Remove a file from a change.

```typescript
await ctx.noorm.changes.removeFile(change, 'change', '001_create-table.sql');
```

**Returns:** `Promise<Change>` — the updated change object.


#### changes.renameFile(change, folder, oldFilename, newDescription)

Rename a file in a change folder. Preserves the numeric prefix.

```typescript
await ctx.noorm.changes.renameFile(change, 'change', '001_old.sql', 'new-name');
```

**Returns:** `Promise<Change>` — the updated change object.


#### changes.reorderFiles(change, folder, newOrder)

Reorder files in a change folder. Pass filenames in the desired order — numeric prefixes are reassigned.

```typescript
await ctx.noorm.changes.reorderFiles(change, 'change', [
    '002_b.sql',
    '001_a.sql',
]);
```

**Returns:** `Promise<Change>` — the updated change object.


#### changes.delete(change)

Delete a change directory from disk entirely.

```typescript
await ctx.noorm.changes.delete(change);
```


#### changes.discover()

Discover all changes on disk. Works offline — scans the configured changes directory.

```typescript
const changes = await ctx.noorm.changes.discover();
console.log(`Found ${changes.length} changes`);
```

**Returns:** `Promise<Change[]>` — all parsed change objects.


#### changes.parse(name)

Parse a single change from disk by name.

```typescript
const change = await ctx.noorm.changes.parse('2024-01-15-add-users');
```

**Returns:** `Promise<Change>` — the parsed change object.


#### changes.validate(change)

Validate a change's structure. Throws `ChangeValidationError` if the change is malformed.

```typescript
ctx.noorm.changes.validate(change);
```

**Returns:** `void` — throws on invalid structure.


#### Execution Operations (connected)


#### changes.apply(name, options?)

Apply a specific change. Pass `{ dryRun: true }` to render the change to `tmp/` without touching the database, or `{ preview: true }` to emit rendered SQL without writing. `{ force: true }` bypasses the already-applied check.

```typescript
const result = await ctx.noorm.changes.apply('2024-01-15-add-users');

// Dry run — does not touch the change tracking tables.
const dry = await ctx.noorm.changes.apply(
    '2024-01-15-add-users',
    { dryRun: true },
);
```

**Options:** `ChangeOptions` — `{ force?: boolean; dryRun?: boolean; preview?: boolean; output?: string | null }`.

**Returns:** `Promise<ChangeResult>`.


#### changes.revert(name, options?)

Revert a specific change. Accepts the same `ChangeOptions` as `apply()`.

```typescript
const result = await ctx.noorm.changes.revert('2024-01-15-add-users');

// Dry-run a revert before pulling the trigger in production.
const dry = await ctx.noorm.changes.revert(
    '2024-01-15-add-users',
    { dryRun: true },
);
```


#### changes.ff(options?)

Apply all pending changes. Accepts `BatchChangeOptions` — the same fields as `ChangeOptions` plus `abortOnError`. Pass `{ dryRun: true }` to render every pending change to `tmp/` without writing to the database; the change tracking tables are left untouched.

```typescript
const result = await ctx.noorm.changes.ff();
console.log(`Applied ${result.executed} changes`);

// Preview before a production deploy.
const dry = await ctx.noorm.changes.ff({ dryRun: true });
```


#### changes.next(count?, options?)

Apply the next `count` pending changes (default `1`). Accepts the same `BatchChangeOptions` as `ff()`.

```typescript
const result = await ctx.noorm.changes.next();
const three = await ctx.noorm.changes.next(3);

// Render the next two without touching the database.
const dry = await ctx.noorm.changes.next(2, { dryRun: true });
```


#### changes.rewind(target, options?)

Revert applied changes in reverse order. Pass a change name to revert back to and including that change, or a number to revert that many of the most recent ones. Accepts the same `BatchChangeOptions` as `ff()`.

```typescript
// Back out everything applied after (and including) this change.
const result = await ctx.noorm.changes.rewind('2024-01-15-add-users');

// Or back out the last three.
const three = await ctx.noorm.changes.rewind(3);

// Render the revert files without touching the database.
const dry = await ctx.noorm.changes.rewind(3, { dryRun: true });
```

**Returns:** `Promise<BatchChangeResult>`. A name matching no applied change comes back as a failed batch carrying `result.error` (`No applied change named "..." to rewind to`), not a throw.


#### changes.status()

Get status of all changes.

```typescript
const changes = await ctx.noorm.changes.status();
for (const cs of changes) {
    console.log(`${cs.name}: ${cs.status}`);
}
```


#### changes.pending()

Get only pending changes.

```typescript
const pending = await ctx.noorm.changes.pending();
```


### ctx.noorm.db — Explore


#### db.listTables()

List all tables in the database.

```typescript
const tables = await ctx.noorm.db.listTables();
for (const table of tables) {
    console.log(`${table.name}: ${table.columnCount} columns`);
}
```


#### db.describeTable(name, schema?)

Get detailed information about a table.

```typescript
const detail = await ctx.noorm.db.describeTable('users');
if (detail) {
    for (const col of detail.columns) {
        console.log(`${col.name}: ${col.dataType}`);
    }
}
```


#### db.overview()

Get database overview with counts of all object types.

```typescript
const overview = await ctx.noorm.db.overview();
console.log(`Tables: ${overview.tables}, Views: ${overview.views}`);
```

**Returns:** `Promise<ExploreOverview>` — counts for `tables`, `views`, `procedures`, `functions`, `types`, `indexes`, `foreignKeys`, `triggers`, `locks`, and `connections`.


#### Other explore methods

Tables are not the only object kind. Every `list*` method returns a summary array, and every `describe*` method takes `(name, schema?)` and returns the detail object or `null` when the object does not exist.

| Method                             | Returns                       |
| ---------------------------------- | ----------------------------- |
| `db.listViews()`                   | `ViewSummary[]`               |
| `db.describeView(name, schema?)`   | `ViewDetail \| null`          |
| `db.listProcedures()`              | `ProcedureSummary[]`          |
| `db.describeProcedure(name, schema?)` | `ProcedureDetail \| null`  |
| `db.listFunctions()`               | `FunctionSummary[]`           |
| `db.describeFunction(name, schema?)` | `FunctionDetail \| null`    |
| `db.listTypes()`                   | `TypeSummary[]`               |
| `db.describeType(name, schema?)`   | `TypeDetail \| null`          |
| `db.listIndexes()`                 | `IndexSummary[]`              |
| `db.listForeignKeys()`             | `ForeignKeySummary[]`         |


### ctx.noorm.lock — Lock Management


#### lock.acquire(options?)

Acquire a database lock.

```typescript
const lock = await ctx.noorm.lock.acquire({ timeout: 60000 });
```


#### lock.release()

Release the current lock.

```typescript
await ctx.noorm.lock.release();
```


#### lock.status()

Get current lock status.

```typescript
const status = await ctx.noorm.lock.status();
if (status.isLocked) {
    console.log(`Locked by ${status.lock.lockedBy}`);
}
```


#### lock.withLock(fn, options?)

Execute an operation with automatic lock acquisition and release.

```typescript
await ctx.noorm.lock.withLock(async () => {
    await ctx.noorm.run.build();
    await ctx.noorm.changes.ff();
});
```


#### lock.forceRelease()

Force release any database lock regardless of ownership. Use when a lock is stuck due to a crashed process or stale session.

```typescript
const { released, holder } = await ctx.noorm.lock.forceRelease();
if (released) {
    console.log(`Stale lock cleared (was held by ${holder})`);
}
```

**Returns:** `Promise<ForceReleaseResult>` — `{ released: boolean; holder: string | null }`. `holder` is `null` when there was nothing to release. The result object is always truthy, so branch on `released`, not on the return value.

This is the one lock method behind the access policy. Breaking someone else's lock interrupts their in-flight migration, so `viewer` is denied outright and `operator`/`admin` need `yes: true` on the context. Denial throws `ProtectedConfigError`.


### ctx.noorm.templates — Template Operations


#### templates.render(filepath)

Render a template file without executing.

```typescript
const result = await ctx.noorm.templates.render('sql/001_users.sql.tmpl');
console.log(result.sql);
```


### ctx.noorm.transfer — Transfer Operations


#### transfer.to(destConfig, options?)

Transfer data from this context's database to a destination config. Both contexts must be connected. Throws on failure.

```typescript
const source = await createContext({ config: 'staging' });
const dest = await createContext({ config: 'dev' });
await source.connect();
await dest.connect();

const result = await source.noorm.transfer.to(dest.noorm.config, {
    tables: ['users', 'posts'],
    onConflict: 'skip',
    batchSize: 5000,
});

console.log(`Transferred ${result.totalRows} rows (${result.status})`);

await source.disconnect();
await dest.disconnect();
```

**Options (`TransferOptions`):**

| Option               | Type               | Default  | Description                                  |
| -------------------- | ------------------ | -------- | -------------------------------------------- |
| `tables`             | `string[]`         | all      | Tables to transfer. Empty = all user tables. |
| `onConflict`         | `ConflictStrategy` | `'fail'` | How to handle primary key conflicts.         |
| `batchSize`          | `number`           | `1000`   | Rows per batch for cross-server transfers.   |
| `disableForeignKeys` | `boolean`          | `true`   | Disable FK checks during transfer.           |
| `preserveIdentity`   | `boolean`          | `true`   | Preserve identity/auto-increment values.     |
| `truncateFirst`      | `boolean`          | `false`  | Truncate destination tables before transfer. |
| `dryRun`             | `boolean`          | `false`  | Validate only, don't execute.                |
| `exportPath`         | `string`           | —        | Export to .dt file instead of DB insert.     |
| `passphrase`         | `string`           | —        | Passphrase for .dtzx export encryption.      |

**Returns:** `Promise<TransferResult>` — `{ status, tables, totalRows, durationMs, fkChecksRestored }`. Check `fkChecksRestored`: it is the only signal that referential integrity may still be off, because `status` does not flip when the FK re-enable fails.

The policy gate runs against the **destination** config, not the source, since the destination is the write target. `transfer.plan()` is gated separately on `transfer:plan`, which `operator` and `admin` both hold outright, so planning stays available to a role that may not execute the transfer.


#### transfer.plan(destConfig, options?)

Generate a transfer plan without executing. Inspects both databases and returns table ordering, row estimates, and warnings. Throws on failure.

```typescript
const plan = await source.noorm.transfer.plan(dest.noorm.config);
console.log(`${plan.estimatedRows} rows across ${plan.tables.length} tables`);
for (const warning of plan.warnings) {
    console.warn(warning);
}
```


### ctx.noorm.dt — DT File Operations


#### dt.exportTable(tableName, filepath, options?)

Export a table to a .dt file. The file extension determines the format: `.dt` (plain), `.dtz` (gzipped), `.dtzx` (encrypted). Throws on failure.

```typescript
const result = await ctx.noorm.dt.exportTable('users', './exports/users.dtz');
console.log(`Exported ${result.rowsWritten} rows (${result.bytesWritten} bytes)`);

// Encrypted export
const encrypted = await ctx.noorm.dt.exportTable('users', './exports/users.dtzx', {
    passphrase: 'my-secret',
});
```

**Options (`ExportOptions`):**

| Option       | Type     | Description                                       |
| ------------ | -------- | ------------------------------------------------- |
| `passphrase` | `string` | Passphrase for .dtzx encryption.                  |
| `schema`     | `string` | Schema/namespace (e.g., 'public' for PostgreSQL). |
| `batchSize`  | `number` | Rows per batch. Default: 1000.                    |


#### dt.importFile(filepath, options?)

Import a .dt file into the connected database. Throws on failure.

```typescript
const result = await ctx.noorm.dt.importFile('./exports/users.dtz', {
    onConflict: 'skip',
});
console.log(`Imported ${result.rowsImported} rows, skipped ${result.rowsSkipped}`);
```

**Options (`ImportOptions`):**

| Option       | Type               | Default  | Description                          |
| ------------ | ------------------ | -------- | ------------------------------------ |
| `passphrase` | `string`           | —        | Passphrase for .dtzx decryption.     |
| `batchSize`  | `number`           | `1000`   | Rows per batch.                      |
| `onConflict` | `ConflictStrategy` | `'fail'` | Conflict strategy.                   |
| `truncate`   | `boolean`          | `false`  | Truncate target table before import. |

`importFile` writes to the database, so it is gated on `db:reset`, which requires confirmation for `operator`. `exportTable` only reads and is not gated.


### ctx.noorm.changes — History


#### changes.history(limit?)

Get execution history.

```typescript
const history = await ctx.noorm.changes.history(10);
for (const record of history) {
    console.log(`${record.name}: ${record.status} at ${record.executedAt}`);
}
```

**Returns:** `Promise<ChangeHistoryRecord[]>` — one record per operation, each with `id`, `name`, `direction`, `status`, `executedAt`, `executedBy`, `durationMs`, `errorMessage`, and `checksum`.


#### changes.historyForChange(name, limit?)

Get execution history for one change, most recent first.

```typescript
const records = await ctx.noorm.changes.historyForChange('2024-01-15-add-users');
```

**Returns:** `Promise<ChangeHistoryRecord[]>`.


#### changes.getFileHistory(operationId)

Drill into the per-file records behind a single operation. Pass the `id` from a `ChangeHistoryRecord`.

```typescript
const records = await ctx.noorm.changes.historyForChange('2024-01-15-add-users');
const files = await ctx.noorm.changes.getFileHistory(records[0].id);

for (const file of files) {
    console.log(`${file.filepath}: ${file.status}`);
}
```

**Returns:** `Promise<FileHistoryRecord[]>` — `id`, `changeId`, `filepath`, `fileType`, `checksum`, `status`, `skipReason`, and the error message when the file failed.


### ctx.noorm.secrets — Secrets


#### secrets.get(key)

Get a config-scoped secret. Synchronous, and needs no connection: these live in local encrypted state, not the database.

```typescript
const apiKey = ctx.noorm.secrets.get('API_KEY');
```

**Returns:** `string | undefined` — not a promise, and `undefined` rather than `null` when the key is unset.


#### secrets.list()

List the config's secret key names. Values are never returned, so a caller that only needs to know which secrets exist never handles them.

```typescript
const keys = ctx.noorm.secrets.list();
```

**Returns:** `string[]` — synchronous.


#### secrets.set(key, value) / secrets.delete(key)

Write and remove config-scoped secrets. Both are async and both need `secret:write`, which is `confirm` for `operator`.

```typescript
await ctx.noorm.secrets.set('API_KEY', 'sk-live-...');
await ctx.noorm.secrets.delete('OLD_KEY');
```

**Returns:** `Promise<void>` for both.


### ctx.noorm.vault — Vault (Encrypted Team Secrets)

Database-stored encrypted secrets shared across team members. Unlike config-scoped secrets, vault secrets live in the database and are encrypted with identity keypairs.


#### vault.init()

Initialize the vault for this database. Creates the vault key and stores it encrypted for the current identity.

Idempotent. Calling `init()` a second time against an already-initialized vault returns `null` — no state change, no error. Callers can `init()` defensively at startup without special-casing an error string. Real failures (DB errors, encryption errors) throw.

```typescript
const vaultKey = await ctx.noorm.vault.init();

if (vaultKey) {
    // First-time init — seed initial team secrets, etc.
}
else {
    // Already initialized — proceed normally with vault.get / vault.set.
}
```

The `vault:initialized` observer event fires only on first init, never on repeat calls. Cross-reference with `vault.status()` if you need to distinguish "just initialized" from "was already there" alongside other status fields.

**Returns:** `Promise<Buffer | null>` — the vault key buffer on first init, `null` if already initialized. Throws on failure.


#### vault.status()

Get vault status for the current identity. Useful alongside `vault.init()` when callers need to know whether a vault existed before they called `init()`: a `null` from `init()` plus `status.isInitialized === true` confirms idempotent no-op.

```typescript
const status = await ctx.noorm.vault.status();
console.log(`Initialized: ${status.isInitialized}, Has access: ${status.hasAccess}`);
```

**Returns:** `Promise<VaultStatus>`


#### vault.set(key, value, privateKey)

Set a vault secret. Requires the caller's private key for vault key decryption. Throws on failure.

```typescript
await ctx.noorm.vault.set('API_KEY', 'sk-live-...', privateKey);
```

**Returns:** `Promise<void>`. Throws `VaultAccessError` when the private key yields no usable vault key: either the vault was never propagated to this identity, or the key does not match. The two causes are deliberately indistinguishable.


#### vault.get(key, privateKey)

Get a single vault secret by key.

```typescript
const value = await ctx.noorm.vault.get('API_KEY', privateKey);
```

**Returns:** `Promise<string | null>` — the decrypted value, or `null` if not found or no access.


#### vault.getAll(privateKey)

Get all vault secrets as a key-value map with metadata.

```typescript
const all = await ctx.noorm.vault.getAll(privateKey);
for (const [key, secret] of Object.entries(all)) {
    console.log(`${key}: set by ${secret.setBy}`);
}
```

**Returns:** `Promise<Record<string, VaultSecret>>` — an empty object when the caller has no vault access, mirroring `get()` returning `null`. Neither read throws on missing access.


#### vault.list()

List all vault secret keys without decrypting values. Does not require a private key.

```typescript
const keys = await ctx.noorm.vault.list();
console.log('Available secrets:', keys.join(', '));
```

**Returns:** `Promise<string[]>`


#### vault.delete(key)

Delete a vault secret. Throws on failure.

```typescript
const deleted = await ctx.noorm.vault.delete('OLD_KEY');
if (deleted) {
    console.log('Secret removed');
}
```

**Returns:** `Promise<boolean>` — throws on failure.


#### vault.exists(key)

Check if a vault secret exists without decrypting.

```typescript
const exists = await ctx.noorm.vault.exists('API_KEY');
```

**Returns:** `Promise<boolean>`


#### vault.propagate(privateKey)

Propagate vault key to all team identities that don't yet have access. Run after adding new team members.

```typescript
const result = await ctx.noorm.vault.propagate(privateKey);
console.log(`Propagated to ${result.propagatedTo.length} new users`);
```

**Returns:** `Promise<VaultPropagationResult>` — `{ propagatedTo, alreadyHadAccess, failed }`. A non-empty `failed` means the operation partially succeeded: a teammate believes they have access and does not. Treat it as an error, not a warning.


#### vault.copy(destConfig, keys, privateKey, options?)

Copy vault secrets to another config's database. Useful for seeding a new environment with secrets from an existing one. Throws on failure.

`keys` takes either an explicit list or the literal `'all'`.

```typescript
const result = await ctx.noorm.vault.copy(
    destConfig,
    ['API_KEY', 'DB_TOKEN'],
    privateKey,
);
console.log(`Copied ${result.copied.length} secrets`);

// Or copy everything.
await ctx.noorm.vault.copy(destConfig, 'all', privateKey);
```

**Options (`VaultCopyOptions`):** `force` (overwrite existing destination secrets, default `false`) and `dryRun` (run the full preflight and report what would happen without writing).

**Returns:** `Promise<VaultCopyResult>` — `{ copied: string[]; skipped: string[]; errors: Array<{ key, error }> }`. All three are key lists, not counts. `skipped` holds keys that already exist on the destination and were not forced. This is the one vault method that checks the access policy on both the source and the destination config.


### ctx.noorm.utils — Utilities


#### utils.testConnection()

Tests if the connection can be established without actually connecting.

```typescript
const result = await ctx.noorm.utils.testConnection();
if (!result.ok) {
    console.error('Connection failed:', result.error);
}
```


#### utils.checksum(filepath)

Compute SHA-256 checksum for a file.

```typescript
const checksum = await ctx.noorm.utils.checksum('sql/001_users.sql');
```


### Event Subscriptions

Subscribe to core events via the process-global `noormObserver` bus:

```typescript
import { noormObserver } from '@noormdev/sdk';

noormObserver.on('file:after', (event) => {
    console.log(`Executed ${event.filepath} in ${event.durationMs}ms`);
});

noormObserver.on('change:complete', (event) => {
    console.log(`Change ${event.name}: ${event.status}`);
});
```

`noormObserver` is a process-global singleton, not a per-context bus. A process that calls `createContext()` more than once (a server juggling several tenant databases, say) sees every context's events on this one stream. Config-scoped events carry `configName` so you can filter, but not every event does: `file:after` and `change:complete` do not, while `file:before`, `run:file`, `lock:*`, `secret:*`, and `db:*` do. Check the payload type before relying on it.


## Environment Variables

The SDK supports environment variable overrides for CI/CD.


### Override Stored Configs

```bash
export NOORM_CONNECTION_HOST=db.ci.internal
export NOORM_CONFIG=staging
```

Priority (highest to lowest):
1. `NOORM_*` env vars
2. Stored config
3. Stage defaults
4. Defaults


### Env-Only Mode

Run without stored configs by setting minimum required env vars:

```bash
export NOORM_CONNECTION_DIALECT=postgres
export NOORM_CONNECTION_DATABASE=mydb
export NOORM_CONNECTION_HOST=localhost
export NOORM_CONNECTION_USER=postgres
export NOORM_CONNECTION_PASSWORD=secret
```

```typescript
// No config name needed—uses env vars directly
const ctx = await createContext();
```


## Error Handling

SDK methods throw named, `instanceof`-matchable errors and let them propagate — a call either
returns its value or throws. There are no `[value, error]` tuples on the `ctx.noorm.*` surface.
Wrap a call in `attempt()` (from `@logosdx/utils`) only when you're going to do something with the
error: translate it, recover, observe, or knowingly ignore it. If you'd just re-throw it unchanged,
skip `attempt` and let it propagate. Never wrap an SDK call in try-catch.

Carve-outs that don't follow that plain throw-and-`attempt` pattern:
`ctx.noorm.utils.testConnection()` returns `{ ok, error? }` by design — a probe reporting failure as
data, not an exception. `ctx.noorm.vault.get()` and `.getAll()` return `null` and `{}` on missing
vault access rather than throwing, and `ctx.noorm.vault.init()` returns `null` when the vault already
exists. `ctx.noorm.run.*` and `ctx.noorm.changes.ff/next/rewind` report per-item failures on the
result (`result.files[].error`, `result.error`) instead of throwing, so a non-throwing call is not
proof of success; check `status`. `ctx.transaction(...)` callbacks must throw to trigger Kysely's
rollback — throwing is the rollback signal, so don't swallow it inside the callback. Raw `ctx.kysely`
queries throw whatever the driver throws.

One gap in the "named errors" rule: a policy denial caught at the SDK seam throws `ProtectedConfigError`,
but a denial caught deeper, inside the runner or the transfer module, throws a plain `Error` carrying the
same message. Match on `ProtectedConfigError` where you can, and fall back to the message otherwise.

```typescript
import { attempt } from '@logosdx/utils';
import {
    createContext,
    tvp,
    RequireTestError,
    ProtectedConfigError,
    NotConnectedError,
    VaultAccessError,
    ImpersonationError,
    LockAcquireError,
} from '@noormdev/sdk';

// attempt() is used deliberately here — the caller inspects the named error and reacts to it.
const [ctx, err] = await attempt(() => createContext({ config: 'prod', requireTest: true }));
if (err instanceof RequireTestError) {
    console.error('Cannot use production config in tests');
}

const [, truncateErr] = await attempt(() => ctx.noorm.db.truncate());
if (truncateErr instanceof ProtectedConfigError) {
    console.error('Denied by the config\'s access role, or needs confirmation the SDK can\'t give');
}

const [, lockErr] = await attempt(() => ctx.noorm.lock.acquire());
if (lockErr instanceof LockAcquireError) {
    console.error(`Lock held by ${lockErr.holder}`);
}
```

The full set of `instanceof`-matchable errors exported from `@noormdev/sdk`:

| Error | Thrown when |
| --- | --- |
| `RequireTestError` | `requireTest: true` and the config lacks `isTest: true`. Carries `configName`. |
| `NotConnectedError` | A namespace method needing a live connection ran before `connect()` or after `disconnect()`. |
| `ProtectedConfigError` | The config's access policy denied the operation, or requires a confirmation `yes: true` did not supply. Carries `configName` and `operation`. |
| `VaultAccessError` | `vault.set()` got a private key that yields no usable vault key. Carries `configName`. |
| `ImpersonationError` | `impersonate()` on MySQL or SQLite, or with an invalid username. |
| `LockAcquireError` | The lock is held by someone else. Carries `holder`, `heldSince`, `expiresAt`, `configName`, `reason`. |
| `LockExpiredError` | The lock expired mid-operation. Carries `configName`, `identity`, `expiredAt`. |
| `ChangeValidationError`, `ChangeNotFoundError`, `ChangeAlreadyAppliedError`, `ChangeNotAppliedError`, `ChangeOrphanedError`, `ManifestReferenceError` | Change parsing and execution problems. |


## TypeScript Support

Use generics for type-safe Kysely access:

```typescript
interface Database {
    users: {
        id: number;
        name: string;
        email: string;
    };
    posts: {
        id: number;
        user_id: number;
        title: string;
    };
}

const ctx = await createContext<Database>({ config: 'dev' });
await ctx.connect();

// ctx.kysely is now Kysely<Database>—full type safety
const users = await ctx.kysely
    .selectFrom('users')
    .select(['id', 'name'])
    .where('email', '=', email)
    .execute();
```


## Exported Types

```typescript
import type {
    // Core
    Context,
    NoormOps,
    CreateContextOptions,
    Config,
    Settings,
    Identity,
    Dialect,

    // Access policy
    Channel,
    ConfigAccess,
    Role,

    // Results
    BatchResult,
    FileResult,
    RunOptions,
    BuildOptions,

    // Changes
    Change,
    CreateChangeOptions,
    AddFileOptions,
    ChangeResult,
    BatchChangeResult,
    ChangeListItem,
    ChangeOptions,
    ChangeHistoryRecord,

    // Explore
    TableSummary,
    TableDetail,
    ExploreOverview,

    // Operations
    TruncateOptions,
    TruncateResult,
    TeardownResult,
    TeardownPreview,

    // Locks
    Lock,
    LockStatus,
    LockOptions,

    // Templates
    TemplateResult,

    // Vault
    VaultSecret,
    VaultStatus,
    VaultCopyResult,
    VaultCopyOptions,
    VaultPropagationResult,

    // Transfer
    TransferOptions,
    TransferPlan,
    TransferTablePlan,
    TransferResult,
    TransferTableResult,
    ConflictStrategy,

    // DT
    ExportOptions,
    ImportOptions,

    // TVP
    TvpValue,

    // Impersonation
    ImpersonatedScope,

    // Proc/func/tvf tuple helpers
    ExtractArgs,
    ExtractReturn,

    // Events
    NoormEvents,
    NoormEventNames,
} from '@noormdev/sdk';
```

Four shapes named by public method signatures are not re-exported from the package: `BatchChangeOptions`
(`changes.ff` / `next` / `rewind`), `TeardownOptions` (`db.teardown`), `ForceReleaseResult`
(`lock.forceRelease`'s return), and `ConnectionRetryOptions` (`connect`'s parameter). Declare those
inline until they are exported.
