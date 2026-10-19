---
name: noorm
description: Guide for building applications and tests with the NoORM database SDK (@noormdev/sdk) and composing CLI headless commands for CI/CD pipelines. Use this skill whenever the user imports @noormdev/sdk, calls createContext(), writes Kysely queries in a noorm-managed project, writes database integration tests, sets up CI/CD with noorm commands, manages database schemas or migrations, runs SQL files through noorm, transfers data between databases, manages vault secrets, or discusses noorm in any development context. Also trigger when you see noorm environment variables (NOORM_*), .sql.tmpl template files, .txt change manifests, a `.noorm/` directory, `db/sql` or `db/changes` folders, or change/revert directory structures, and whenever the task is to add, alter, or drop a table, column, view, function, or seed data in a noorm project. Trigger for any database task in a noorm-managed project — the SDK conventions (SDK methods throw named errors, `attempt()` wraps deliberately, no try-catch, test safety guards, Kysely patterns) and CLI flags are non-obvious and critical to get right.
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
| Adding or changing a table, column, view, function, or seed data | `references/schema-files.md` |
| Deciding whether SQL goes in `sql/` or `changes/`, writing a change, or writing a `.txt` manifest | `references/schema-files.md` |
| Writing `.sql.tmpl` template files | `references/templates.md` (and **Templates** in `references/schema-files.md` for when to use one) |
| Combining SDK code with CLI operations | Read SDK + CLI references |

## Project Layout


`noorm init` creates this:


    db/
    ├── sql/        what the schema IS. `noorm run build` creates a database from nothing with these files
    ├── changes/    how an EXISTING database reaches that state. `noorm change ff` applies them
    ├── AGENTS.md   the user's own steering for this directory. Read it first
    └── CLAUDE.md   imports AGENTS.md


The real locations are `paths.sql` and `paths.changes` in `.noorm/settings.yml`. Older projects use `./sql` and `./changes`. Read the settings before creating a file, and never add a second `sql/` or `changes/` beside the configured ones.

Four rules that every schema edit follows (details and examples in `references/schema-files.md`):

1. **`sql/` holds the current state and nothing else.** `CREATE` statements and seeds. Each column and constraint is declared once, inline in its `CREATE TABLE`. No `ALTER`, `DROP`, backfill, `IF NOT EXISTS` guard, or history comment.
2. **`changes/` holds every step that moves an existing database to that state.** `ALTER`, `DROP`, backfills, data fixes, written to be safe to run twice (a built database's first `ff` replays every change), each with a `revert/`. A change that has been applied is never edited; add a new one.
3. **Every edit to `sql/` ships with its change.** Edit `sql/` first, then write the change that brings an already-built database to the same state. Existing databases move with `noorm change ff`, never `noorm run build`.
4. **Reuse, do not copy.** A change re-creates a view, function, procedure, or trigger by listing its `sql/` file in a `.txt` manifest (paths relative to `paths.sql`, one per line). Repeated or data-driven SQL (seed rows, grants, per-table triggers, per-environment values, secrets) is a `.sql.tmpl` plus a data file.


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
| `ALTER TABLE`, `DROP`, or a backfill in a `sql/` file | Put it in `changes/<name>/change/` and write the end state in `sql/` | `sql/` builds an empty database. History belongs to changes |
| `IF NOT EXISTS` on a `sql/` `CREATE TABLE` to make it re-runnable | Remove the guard. Guards go in changes | A changed file re-runs against the existing table and the guard makes the edit silently do nothing |
| Edit `sql/` and stop | Add the change that brings an existing database to the same state | A built database never receives the edit |
| Run `noorm run build` on a database that already has data | `noorm change ff` | Build only re-runs changed files, and a changed `CREATE TABLE` cannot alter an existing table |
| Copy a view or function into `change/001_*.sql` | List its `sql/` file in a `.txt` manifest | The copy drifts from `sql/`. Manifest paths are relative to `paths.sql` |
| Reference a `CREATE TABLE` file from a manifest | Copy the `CREATE TABLE IF NOT EXISTS` into the change | A manifest runs the file's current content, so a pending or replayed change executes today's `CREATE TABLE` |
| Edit a change that was already applied | Add a new change | Databases that already ran it keep the old body and the rest run the new one |
| Hand-write a list of `INSERT`s or `GRANT`s | `.sql.tmpl` with a `roles.yml`-style data file beside it | One data file, one loop, `$.quote()` on every value |
| Put a secret or a per-environment value in plain `.sql` | `.sql.tmpl` with `$.secrets` / `$.config` | Plain files are identical in every environment |
| Create `sql/` at the repo root when `paths.sql` is `./db/sql` | Read `.noorm/settings.yml` first | noorm never reads the stray folder, so its files never run |
| `build.include: [sql/01_tables]` | `build.include: [01_tables]` | Entries are relative to `paths.sql`. A wrong entry matches nothing and still exits 0 |
