---
name: noorm
description: Guide for building applications and tests with the NoORM database SDK (@noormdev/sdk) and composing CLI headless commands for CI/CD pipelines. Use this skill whenever the user imports @noormdev/sdk, calls createContext(), writes Kysely queries in a noorm-managed project, writes database integration tests, sets up CI/CD with noorm commands, manages database schemas or migrations, runs SQL files through noorm, transfers data between databases, manages vault secrets, or discusses noorm in any development context. Also trigger when you see noorm environment variables (NOORM_*), .sql.tmpl template files, or change/revert directory structures. Trigger for any database task in a noorm-managed project — the SDK conventions (SDK methods throw named errors, `attempt()` wraps deliberately, no try-catch, test safety guards, Kysely patterns) and CLI flags are non-obvious and critical to get right.
---

# NoORM

Database schema and change manager with two interfaces:

- **SDK** (`@noormdev/sdk`) — Programmatic access for application code and tests
- **CLI** (`noorm`) — Headless commands for CI/CD, scripting, and database operations (the TUI is launched separately via `noorm ui`)

## Which Reference to Read

| If the user is... | Read |
|---|---|
| Writing code that imports `@noormdev/sdk` | `references/sdk.md` |
| Writing or bootstrapping database tests | `references/sdk.md` (especially **Testing Patterns**) |
| Calling stored procedures, functions, or TVFs | `references/sdk.md` |
| Using Kysely queries within a noorm context | `references/sdk.md` |
| Setting up CI/CD pipelines with noorm | `references/cli.md` |
| Running noorm commands in the terminal | `references/cli.md` |
| Managing noorm locks (tool-level coordination, not DB engine locks), vault secrets, or data transfers via CLI | `references/cli.md` |
| Configuring `.noorm/settings.yml` or defining stages | `references/config.md` |
| Setting up a new noorm project or understanding config structure | `references/config.md` |
| Writing `.sql.tmpl` template files | `references/templates.md` |
| Combining SDK code with CLI operations | Read SDK + CLI references |

## Shared Conventions

These apply to both SDK and CLI usage.

### Dialects

Supported: `postgres`, `mysql`, `mssql`, `sqlite`

SQLite is limited — no stored procedures, no database functions, no TVFs, no impersonation.

### Configuration Resolution

Priority chain (highest wins):

1. CLI flags (`--config`, `--force`)
2. Environment variables (`NOORM_*`)
3. Stored config (named config from encrypted state)
4. Stage defaults (from `.noorm/settings.yml`)
5. Hard-coded defaults

Env-only mode (no stored config needed): set `NOORM_CONNECTION_DIALECT` + `NOORM_CONNECTION_DATABASE` as environment variables. This is the standard approach for CI/CD pipelines.

### Error Handling

SDK methods throw named errors and let them propagate — this is the primary contract, not an
opt-in. Wrap a call in `attempt()`/`attemptSync()` only when you're going to do something with
the error (translate it, recover, observe, or knowingly ignore it); if you'd just re-throw it
unchanged, skip `attempt` and let it propagate.

Carve-outs that don't follow the throw contract:

- `ctx.noorm.utils.testConnection()` returns `{ ok, error? }` by design — a connection probe
  reporting failure as data, not an exception.
- Transaction callbacks (`ctx.transaction(...)`) must throw to roll back — that's Kysely's own
  transaction contract.
- Raw `ctx.kysely` queries throw like any Kysely call.

Never wrap a `ctx.noorm.*` call in try-catch.

## Common Mistakes

These are the patterns LLMs get wrong most often with noorm:

| Wrong | Right | Why |
|---|---|---|
| Query before `connect()` | Call `ctx.connect()` first | Context starts disconnected |
| Forget `disconnect()` | Always call `ctx.disconnect()` | Leaks connection pool |
| `config: 'production'` in tests | Use `requireTest: true` | Safety guard prevents test code from touching production |
| Hardcode connection details | Use `NOORM_*` env vars | Required for CI/CD portability |
| `ctx.proc()` on SQLite | Check `ctx.dialect` first | SQLite has no stored procedures, functions, or TVFs |
| `ctx.tvf()` on MySQL | Check `ctx.dialect` first | MySQL doesn't support TVFs either |
| `Procs = { name: ArgsType }` | `Procs = { name: [ArgsType, ReturnType] }` | Tuple format enables return type inference |
| Assume every `ctx.noorm.*` call returns a tuple | SDK methods throw named errors — wrap with `attempt()` only when you'll do something with the error | Unhandled throws stop the caller immediately; that's the contract |
| Use raw Kysely without noorm | Use `ctx.kysely` from a noorm Context | Misses config resolution, checksums, change tracking |
