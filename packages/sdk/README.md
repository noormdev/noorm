# @noormdev/sdk

Type-safe programmatic access to a noorm-managed database. Wraps [Kysely](https://kysely.dev) with noorm's config resolution, change tracking, and access policy.

**[Documentation](https://noorm.dev)** | **[SDK Reference](https://noorm.dev/reference/sdk)** | **[Source](https://github.com/noormdev/noorm)**


## Install

```bash
npm install @noormdev/sdk kysely
```

Install the driver for your dialect alongside it — `pg`, `mysql2`, `tedious` + `tarn`, or `better-sqlite3`. They are optional peer dependencies, so only the one you use needs to be present.


## Usage

```typescript
import { createContext } from '@noormdev/sdk';

const ctx = await createContext<{ users: { id: number; name: string } }>({
    config: 'dev',
});

await ctx.connect();

// Query through Kysely
const users = await ctx.kysely
    .selectFrom('users')
    .select(['id', 'name'])
    .execute();

// noorm operations live under their own namespace
await ctx.noorm.changes.ff();

await ctx.disconnect();
```

`createContext` resolves connection settings the same way the CLI does — defaults, then stage, then stored config, then `NOORM_CONNECTION_*` env vars, then explicit options — so the same code runs locally and in CI.


## Testing

Pass `requireTest: true` and the context refuses to connect unless the resolved config is marked `isTest`. This makes it impossible for a test suite to point at production by accident.

```typescript
const ctx = await createContext<Database>({
    config: 'test',
    requireTest: true,
});
```


## Typed procedures, functions, and TVFs

Stored routines can be declared as `[Args, ReturnType]` tuples so return types are inferred at the call site, with the generic still available as an override.

```typescript
type Procs = {
    get_users: [{ department_id: number }, User];
    refresh_cache: void;
};

const ctx = await createContext<Database, Procs>({ config: 'dev' });

const users = await ctx.proc('get_users', { department_id: 1 }); // User[]
await ctx.proc('refresh_cache');
```

`createContext<DB, Procs, Funcs, Tvfs>` takes a map per routine kind. Plain `void` is shorthand for "no arguments, no meaningful return".


## Requires

Node >= 22.13. Supports **PostgreSQL**, **MySQL**, **SQLite**, and **SQL Server**.


## License

MIT
