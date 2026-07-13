# NoORM SDK Reference

## Table of Contents

1. [Quick Start](#quick-start)
2. [createContext](#createcontext)
3. [Context API](#context-api) — Lifecycle, Kysely, Transactions, Procs, Funcs, TVFs, Impersonation
4. [NoormOps Namespaces](#noormops-namespaces)
5. [Type Generics](#type-generics) — `[Args, ReturnType]` tuples, 4 generics
6. [Testing Patterns](#testing-patterns)
7. [Observer Events](#observer-events)

---

## Quick Start

```typescript
import { createContext } from '@noormdev/sdk';

const ctx = await createContext<MyDB>({ config: 'dev' });
await ctx.connect();

const users = await ctx.kysely
    .selectFrom('users')
    .selectAll()
    .execute();

await ctx.disconnect();
```

Peer dependency: `kysely` (plus your dialect driver — `pg`, `mysql2`, `better-sqlite3`, or `tedious`).

## createContext

```typescript
import { createContext } from '@noormdev/sdk';

const ctx = await createContext<DB, Procs, Funcs, Tvfs>(options);
```

### Options

| Option | Type | Default | Description |
|---|---|---|---|
| `config` | `string` | — | Config name from stored state. Falls back to `NOORM_CONFIG` env, then env-only mode |
| `projectRoot` | `string` | `process.cwd()` | Project root directory |
| `requireTest` | `boolean` | `false` | Refuse if `config.isTest` is not `true`. Throws `RequireTestError` |
| `channel` | `Channel` | `'user'` | Which caller channel this context represents for access-policy checks (`'user'` or `'mcp'`). Destructive ops throw `ProtectedConfigError` when the config's role for this channel denies or can't confirm the action |
| `stage` | `string` | — | Stage name for stage defaults from `settings.yml` |

### Env-Only Mode (CI/CD)

No stored config needed — set environment variables:

```bash
export NOORM_CONNECTION_DIALECT=postgres
export NOORM_CONNECTION_DATABASE=myapp
export NOORM_CONNECTION_HOST=db.example.com
export NOORM_CONNECTION_USER=deploy
export NOORM_CONNECTION_PASSWORD=$DB_PASSWORD
```

```typescript
const ctx = await createContext(); // Resolves entirely from env
```

## Context API

### Lifecycle

```typescript
await ctx.connect();      // Must call before any queries
await ctx.disconnect();   // Must call when done — releases connection pool
```

### Properties

| Property | Type | Description |
|---|---|---|
| `ctx.dialect` | `Dialect` | Active dialect (`postgres`, `mysql`, `mssql`, `sqlite`) |
| `ctx.connected` | `boolean` | Whether connection pool is active |
| `ctx.kysely` | `Kysely<DB>` | Query builder. Throws if not connected |
| `ctx.noorm` | `NoormOps` | Management operations (lazy singleton) |

### Kysely Queries

`ctx.kysely` is a standard Kysely instance — use its full query builder API. Type-safe when `DB` generic is provided.

```typescript
const users = await ctx.kysely
    .selectFrom('users')
    .select(['id', 'name', 'email'])
    .where('active', '=', true)
    .execute();

// Raw SQL via Kysely's sql tag
import { sql } from 'kysely';
const result = await sql<{ count: number }>`
    SELECT COUNT(*) as count FROM users WHERE active = ${true}
`.execute(ctx.kysely);
```

### Transactions

```typescript
await ctx.transaction(async (trx) => {
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
    // Commits on success, rolls back on throw
});
```

### Stored Procedures

Type-safe when `Procs` generic is provided. Return type is inferred from the `[Args, Return]` tuple. Dialect-specific SQL is generated automatically.

```typescript
// Return type inferred from Procs tuple — no generic needed
const users = await ctx.proc('get_active_users', { department_id: 5 }); // → User[]

// Explicit return type override
const users = await ctx.proc<'get_active_users', SpecialUser>('get_active_users', { department_id: 5 });

// Positional params (all dialects except SQLite)
await ctx.proc('update_stats', [42, 'monthly']);

// No params
await ctx.proc('refresh_cache');
```

Generated SQL by dialect:
- **MSSQL**: `EXEC get_active_users @department_id = $1`
- **PostgreSQL**: `CALL get_active_users(department_id => $1)`
- **MySQL**: `CALL get_active_users($1)` (positional only)
- **SQLite**: throws — no procedure support

### Table-Valued Parameters (TVP)

Pass structured table data to MSSQL stored procedures, functions, and TVFs using the `tvp()` helper. Other dialects throw — TVPs are an MSSQL-only feature.

The SDK generates a DECLARE/INSERT batch where all user values remain parameterized (no SQL injection). This bypasses Kysely's parameter binding, which lacks native TVP type detection.

```typescript
import { tvp, type TvpValue } from '@noormdev/sdk';

// Use TvpValue in proc, func, or tvf signatures
interface MyProcs {
    'Checkout_trx': [{ Party: number; PaymentMethod: number; Items: TvpValue }, void];
}
interface MyFuncs {
    'score_items': [{ multiplier: number; Items: TvpValue }, { total: number }];
}
interface MyTvfs {
    'match_items': [{ user_id: string; Items: TvpValue }, MatchedItem];
}

// proc — named params
await ctx.proc('Checkout_trx', {
    Party: 1,
    PaymentMethod: 2,
    Items: tvp('CheckoutItems', [
        { Type: 1, ReferenceNo: 100, Qty: 5 },
        { Type: 2, ReferenceNo: 200, Qty: 3 },
    ]),
});

// proc — positional params
await ctx.proc('Checkout_trx', [1, 2, tvp('CheckoutItems', items)]);

// func — scalar result from TVP
const result = await ctx.func('score_items', {
    multiplier: 2,
    Items: tvp('ItemType', items),
}, 'total');

// tvf — row set from TVP
const rows = await ctx.tvf('match_items', {
    user_id: '123',
    Items: tvp('ItemType', items),
});
```

`tvp(typeName, rows)` takes the SQL Server table type name and an array of row objects. Column names are inferred from the first row's keys.

**Features:**

- Works with `proc()`, `func()`, and `tvf()`
- Schema-qualified names: `tvp('dbo.CheckoutItems', rows)`
- Empty TVP (zero rows): `tvp('CheckoutItems', [])` — passes empty table
- Multiple TVPs per call
- Works with impersonated scopes (`scope.proc()`)

**Validation:**

- Row key consistency — all rows must have the same keys as the first row, or `tvp()` throws
- Parameter count — MSSQL has a 2,100 parameter limit per batch. The SDK counts `(TVP rows × columns) + scalar params` and throws early with a suggestion to split into batches

Generated SQL varies by method:

```sql
-- proc (named)
DECLARE @__tvp_Items CheckoutItems;
INSERT INTO @__tvp_Items ([Type], [ReferenceNo], [Qty]) VALUES (@1, @2, @3), (@4, @5, @6);
EXEC Checkout_trx @Party = @7, @PaymentMethod = @8, @Items = @__tvp_Items

-- func (uses EXEC @result = func pattern)
DECLARE @__tvp_Items ItemType;
INSERT INTO @__tvp_Items ([val]) VALUES (@1), (@2);
DECLARE @__result sql_variant; EXEC @__result = score_items @multiplier = @3, @Items = @__tvp_Items; SELECT @__result AS total

-- tvf (uses SELECT * FROM tvf(...))
DECLARE @__tvp_Items ItemType;
INSERT INTO @__tvp_Items ([val]) VALUES (@1), (@2);
SELECT * FROM match_items(@3, @__tvp_Items)
```

### Database Functions

Return type inferred from tuple. Always requires a column alias as the last argument.

```typescript
// Return type inferred from Funcs tuple
const total = await ctx.func('calc_total', { order_id: 42 }, 'total'); // → CalcResult

// Explicit return type override
const total = await ctx.func<'calc_total', { total: number }>('calc_total', { order_id: 42 }, 'total');

// No params — just column alias
const ver = await ctx.func('get_version', 'v');
```

Generates `SELECT calc_total(order_id => $1) AS total`. Not supported on SQLite.

### Table-Valued Functions

Return multiple rows. Same tuple-based typing as procs. Supported on **MSSQL and PostgreSQL only** — MySQL and SQLite throw.

```typescript
// Return type inferred from Tvfs tuple
const sessions = await ctx.tvf('validate_session', { session_key: key }); // → Session[]

// Explicit return type override
const sessions = await ctx.tvf<'validate_session', ExtendedSession>('validate_session', { session_key: key });

// No params
const items = await ctx.tvf('get_active_items');
```

Generates `SELECT * FROM validate_session(session_key => $1)`.

### Impersonation

Execute queries as another database principal. Supported on PostgreSQL (`SET ROLE`), MSSQL (`EXECUTE AS USER`), and MySQL. Not supported on SQLite.

```typescript
// Callback mode — auto-reverts, even on error
const rows = await ctx.impersonate('alice', async (scope) => {
    return scope.kysely.selectFrom('restricted_data').selectAll().execute();
});

// Explicit mode — caller manages lifecycle
const scope = await ctx.impersonate('alice');
const data = await scope.kysely.selectFrom('restricted_data').selectAll().execute();
await scope.revert(); // Must call — releases the dedicated connection
```

The `ImpersonatedScope` provides: `kysely`, `proc()`, `func()`, `tvf()`, `transaction()`, `revert()`. All with the same tuple-based type inference as the Context methods.

## NoormOps Namespaces

All accessed via `ctx.noorm.<namespace>`. Each namespace is lazily instantiated on first access.

### changes

```typescript
// Discovery (no connection needed)
const changes = await ctx.noorm.changes.discover();
const change = await ctx.noorm.changes.parse('2024-01-15-add-users');
ctx.noorm.changes.validate(change); // Throws ChangeValidationError if invalid

// Scaffold new changes
const change = await ctx.noorm.changes.create({ description: 'add-user-roles' });
await ctx.noorm.changes.addFile(change, 'change', { name: 'create-table', type: 'sql' });
await ctx.noorm.changes.removeFile(change, 'change', '001_create-table.sql');
await ctx.noorm.changes.renameFile(change, 'change', '001_old.sql', 'new-name');
await ctx.noorm.changes.reorderFiles(change, 'change', ['002_b.sql', '001_a.sql']);
await ctx.noorm.changes.delete(change);

// Execution (connection required)
const result = await ctx.noorm.changes.apply('2024-01-15-add-users');
const result = await ctx.noorm.changes.revert('2024-01-15-add-users');
const batch = await ctx.noorm.changes.ff(); // Apply all pending changes

// Status and history
const all = await ctx.noorm.changes.status();      // All changes with DB state
const pending = await ctx.noorm.changes.pending();  // Only unapplied/reverted
const history = await ctx.noorm.changes.history(20); // Execution log
```

### run

```typescript
// Discovery
const files = await ctx.noorm.run.discover('sql/');

// Preview (render templates without executing)
const previews = await ctx.noorm.run.preview(['sql/001.sql', 'sql/002.sql']);

// Execution
await ctx.noorm.run.file('seeds/test-data.sql');
await ctx.noorm.run.files(['functions.sql', 'triggers.sql']);
await ctx.noorm.run.dir('seeds/');

// Schema build (all SQL in schema directory)
await ctx.noorm.run.build();                    // Checksum-based — skips unchanged files
await ctx.noorm.run.build({ force: true });     // Rebuild everything
```

### db

```typescript
// Exploration
const tables = await ctx.noorm.db.listTables();
const detail = await ctx.noorm.db.describeTable('users');
const overview = await ctx.noorm.db.overview(); // Counts of all object types

// Destructive (guarded by config.access[channel] via checkPolicy — throws ProtectedConfigError on deny/unconfirmable)
await ctx.noorm.db.truncate();   // Wipe data, keep schema
await ctx.noorm.db.teardown();   // Drop all objects
await ctx.noorm.db.reset();      // teardown() + build() — full schema rebuild

// Preview
const preview = await ctx.noorm.db.previewTeardown(); // What would be dropped
```

**Important — noorm tracking tables are always preserved.** Both `truncate()` and `teardown()` automatically skip noorm's internal tables (change history, lock state, identity records, vault). Your application tables are affected; noorm's bookkeeping is not.

### lock

Tool-level locks managed by noorm (not database engine locks like `SELECT FOR UPDATE`). Any noorm user targeting the same database will be blocked by this lock. Used to prevent concurrent schema operations across noorm instances.

```typescript
// Manual lifecycle
const lock = await ctx.noorm.lock.acquire({ timeout: 60_000 });
await ctx.noorm.lock.release();
const status = await ctx.noorm.lock.status(); // { isLocked, lock }

// Auto-release callback (recommended)
await ctx.noorm.lock.withLock(async () => {
    await ctx.noorm.changes.ff();
}, { timeout: 120_000 });

// Emergency — force-release regardless of ownership
await ctx.noorm.lock.forceRelease();
```

Lock options: `timeout` (lock duration, default 5min), `wait` (block until available), `waitTimeout`, `pollInterval`, `reason`.

### vault

Team-shared encrypted secrets stored in the database.

```typescript
await ctx.noorm.vault.init();               // Buffer | null — null when already initialized (idempotent, not an error)
const status = await ctx.noorm.vault.status();

// CRUD (requires private key for encryption/decryption)
await ctx.noorm.vault.set('API_KEY', 'sk-live-...', privateKey);   // throws on failure
const value = await ctx.noorm.vault.get('API_KEY', privateKey);     // string | null
const all = await ctx.noorm.vault.getAll(privateKey);               // Record<string, VaultSecret>
const keys = await ctx.noorm.vault.list();                          // string[]
const deleted = await ctx.noorm.vault.delete('API_KEY');            // boolean — throws on failure
const exists = await ctx.noorm.vault.exists('API_KEY');

// Team access management
await ctx.noorm.vault.propagate(privateKey);

// Copy between configs
const result = await ctx.noorm.vault.copy(destConfig, keys, privateKey, {
    force: true, // Overwrite existing
});
```

Secret resolution priority: config-specific local > global local > vault (team-shared).

### secrets

Local config-scoped secrets from encrypted state (no database needed).

```typescript
const apiKey = ctx.noorm.secrets.get('API_KEY'); // Returns undefined if not set
```

### templates

Render `.sql.tmpl` files without executing — useful for previewing generated SQL.

```typescript
const result = await ctx.noorm.templates.render('sql/001_users.sql.tmpl');
// result: { name, content, error?, durationMs? }
```

### transfer

Data transfer between database configurations.

```typescript
// Execute transfer — throws on failure
const result = await ctx.noorm.transfer.to(destConfig, {
    tables: ['users', 'posts'],        // Specific tables (default: all)
    onConflict: 'skip',                // 'fail' | 'skip' | 'update' | 'replace'
    truncate: false,                   // Clear destination first?
});

// Plan without executing — throws on failure
const plan = await ctx.noorm.transfer.plan(destConfig, options);
```

### dt

Portable data files: `.dt` (plain), `.dtz` (compressed), `.dtzx` (encrypted).

```typescript
// Export — throws on failure
const result = await ctx.noorm.dt.exportTable('users', './exports/users.dtz', {
    passphrase: 'secret',   // Use .dtzx encryption
    schema: 'public',       // PostgreSQL schema
    batchSize: 5000,         // Rows per batch (default: 1000)
});
// result: { rowsWritten, bytesWritten }

// Import — throws on failure
const result = await ctx.noorm.dt.importFile('./exports/users.dtz', {
    onConflict: 'skip',     // 'fail' | 'skip' | 'update' | 'replace'
    truncate: true,          // Clear table first
    batchSize: 1000,
});
// result: { rowsImported, rowsSkipped }
```

### utils

```typescript
const checksum = await ctx.noorm.utils.checksum('sql/001.sql');
const { ok, error } = await ctx.noorm.utils.testConnection();
```

## Type Generics

The SDK uses four type parameters for compile-time safety:

```typescript
const ctx = await createContext<DB, Procs, Funcs, Tvfs>(options);
```

| Generic | Purpose | Default |
|---|---|---|
| `DB` | Kysely database schema | `unknown` |
| `Procs` | Stored procedure signatures | `object` |
| `Funcs` | Database function signatures | `object` |
| `Tvfs` | Table-valued function signatures | `object` |

### Tuple Format: `[Args, ReturnType]`

Procs, Funcs, and Tvfs use `[Args, ReturnType]` tuples. The return type is **inferred automatically** at the call site — no generic needed. You can still override with an explicit generic.

```typescript
interface User { id: number; name: string; email: string }
interface CalcResult { total: number }
interface Session { session_key: string; expires_at: string }

// Stored procedure signatures
interface MyProcs {
    'get_active_users': [{ department_id: number }, User];   // Named args → User[]
    'update_stats': [[number, string], void];                // Positional args → void[]
    'refresh_cache': void;                                    // No args, no return
}

// Database function signatures
interface MyFuncs {
    'calc_total': [{ order_id: number }, CalcResult];        // → CalcResult
    'get_version': void;                                      // → unknown
}

// Table-valued function signatures
interface MyTvfs {
    'validate_session': [{ session_key: string }, Session];  // → Session[]
    'get_active_items': void;                                 // → unknown[]
}

const ctx = await createContext<MyDB, MyProcs, MyFuncs, MyTvfs>({ config: 'dev' });
await ctx.connect();

// Return types are inferred from the tuple:
const users = await ctx.proc('get_active_users', { department_id: 5 });   // User[]
const total = await ctx.func('calc_total', { order_id: 1 }, 'total');     // CalcResult
const sessions = await ctx.tvf('validate_session', { session_key: key }); // Session[]

// Override when you need a different return type:
const special = await ctx.proc<'get_active_users', SpecialUser>('get_active_users', { department_id: 5 });
```

### Tuple Rules

| Entry | Args | Return |
|---|---|---|
| `[ArgsType, ReturnType]` | `ArgsType` | `ReturnType` |
| `[void, ReturnType]` | none (no params) | `ReturnType` |
| `[ArgsType, void]` | `ArgsType` | `void` |
| `void` | none (no params) | `unknown` |

All four generics default to `unknown`/`object` when omitted — queries still work, but without type checking.

## Testing Patterns

### Full Test Bootstrap

```typescript
import { createContext, type Context } from '@noormdev/sdk';

let ctx: Context<MyDB>;

beforeAll(async () => {
    // requireTest: true prevents accidental use of production configs
    ctx = await createContext<MyDB>({ config: 'test', requireTest: true });
    await ctx.connect();

    // Full schema rebuild: drops everything, rebuilds from SQL files
    await ctx.noorm.db.reset();
});

afterAll(async () => {
    await ctx.disconnect();
});

beforeEach(async () => {
    // Wipe application data between tests.
    // Preserves schema and noorm tracking tables (change history, locks, etc.)
    await ctx.noorm.db.truncate();
});
```

### Seeding Test Data

```typescript
// Option 1: SQL seed files
await ctx.noorm.run.file('seeds/test-data.sql');

// Option 2: Kysely inserts (type-safe)
await ctx.kysely.insertInto('users').values([
    { name: 'Alice', email: 'alice@test.com', active: true },
    { name: 'Bob', email: 'bob@test.com', active: true },
]).execute();
```

### Test with Lock Protection

When tests run concurrently against a shared database, use locks to serialize access:

```typescript
it('should apply changes safely', async () => {
    await ctx.noorm.lock.withLock(async () => {
        const result = await ctx.noorm.changes.ff();
        expect(result.applied).toBeGreaterThan(0);
    });
});
```

### Lifecycle Cheat Sheet

| Operation | What it does | Noorm tables preserved? |
|---|---|---|
| `ctx.noorm.db.truncate()` | DELETE all rows from application tables | Yes |
| `ctx.noorm.db.teardown()` | DROP all application objects (tables, views, functions) | Yes |
| `ctx.noorm.db.reset()` | `teardown()` then `run.build()` — full schema rebuild | Yes |
| `ctx.noorm.run.build({ force: true })` | Re-run all SQL files ignoring checksums | Yes |
| `ctx.noorm.changes.ff()` | Apply only unapplied changes | Yes |

### Safety Guards

| Guard | Error Type | Purpose |
|---|---|---|
| `requireTest: true` | `RequireTestError` | Blocks non-test configs |
| `config.access[channel]` | `ProtectedConfigError` | Blocks destructive ops the role denies outright, or that resolve to "requires confirmation" (the SDK has no prompt — set `NOORM_YES=1`, or run via the CLI/TUI) |

### Error Types for Assertions

```typescript
import {
    RequireTestError,
    ProtectedConfigError,
    ImpersonationError,
    ChangeValidationError,
    ChangeNotFoundError,
    ChangeAlreadyAppliedError,
    ChangeNotAppliedError,
    ChangeOrphanedError,
    LockAcquireError,
    LockExpiredError,
} from '@noormdev/sdk';
```

## Observer Events

Subscribe to real-time progress events emitted by core operations via the
process-global `noormObserver` bus — a singleton shared across every
`Context` in the process, not scoped to one `ctx`:

```typescript
import { noormObserver } from '@noormdev/sdk';

// File execution progress
noormObserver.on('file:before', (data) => {
    console.log('Running:', data.filepath);
});
noormObserver.on('file:after', (data) => {
    console.log(data.filepath, data.status, data.durationMs + 'ms');
});
noormObserver.on('file:skip', (data) => {
    console.log('Skipped:', data.filepath, data.reason);
});

// Change lifecycle
noormObserver.on('change:start', (data) => {
    console.log(`Applying ${data.name} (${data.files.length} files)`);
});
noormObserver.on('change:complete', (data) => {
    console.log(data.name, data.direction, data.status);
});

// Build progress
noormObserver.on('build:start', (data) => {
    console.log(`Building ${data.fileCount} files from ${data.sqlPath}`);
});

// Pattern matching for multiple events
noormObserver.on(/^file:/, ({ event, data }) => {
    console.log(`[${event}]`, data);
});
```

Key event namespaces: `file:*`, `build:*`, `run:*`, `change:*`, `lock:*`, `transfer:*`, `dt:*`, `vault:*`, `template:*`, `connection:*`.
