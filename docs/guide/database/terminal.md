# SQL Terminal


## What It Is

The SQL terminal is an interactive REPL built into noorm. Run queries against your database without leaving the tool or switching to another client.

Debugging a change? Check if that INSERT worked. Exploring a table structure? Run a quick SELECT. The terminal keeps you in flow while you work.


## Launching the Terminal

Press `Shift+Q` from anywhere in the TUI. The terminal is a global shortcut, not an entry on the Database menu, so there is no `[d]` then `[t]` path to it. On the Database screen, `t` is teardown.

From a shell, launch straight into it:

```bash
noorm sql repl              # active config
noorm sql repl --config dev # a specific config
```

`noorm sql repl` opens the same TUI screen, so everything on this page applies to both. It needs an interactive terminal and refuses to run under `--yes` or `NOORM_YES`; for scripted SQL use `noorm sql query "SELECT 1"` or `noorm sql query -f query.sql` instead.

The terminal connects to your [active configuration](/guide/environments/configs) automatically.


## The Interface

```
┌─ SQL Terminal ──────────────────────────────────────────────┐
│                                                             │
│  > SELECT * FROM users LIMIT 3;                             │
│                                                             │
│  ┌────┬─────────┬─────────────────┬─────────────────────┐   │
│  │ id │ name    │ email           │ created_at          │   │
│  ├────┼─────────┼─────────────────┼─────────────────────┤   │
│  │  1 │ Alice   │ alice@email.com │ 2024-01-15 09:30:00 │   │
│  │  2 │ Bob     │ bob@email.com   │ 2024-01-16 14:22:00 │   │
│  │  3 │ Charlie │ charlie@co.com  │ 2024-01-17 11:45:00 │   │
│  └────┴─────────┴─────────────────┴─────────────────────┘   │
│                                                             │
│  3 rows (12ms)                                              │
│                                                             │
│  > _                                                        │
│                                                             │
│  [Shift+Tab] Edit mode  [Enter] Execute  [Shift+Enter] New  │
│  [h] History   [Esc] Clear                                  │
└─────────────────────────────────────────────────────────────┘
```

Type your SQL at the `>` prompt and press Enter to execute. The prompt changes to `[EDIT]>` in edit mode, where Enter inserts a newline instead of running the query.


## What You Are Allowed to Run

Before anything reaches the database, noorm classifies the statement and checks that class against the [config's access role](/guide/environments/configs):

| Class | Permission | `viewer` | `operator` | `admin` |
|-------|------------|----------|------------|---------|
| Reads (`SELECT`, `SHOW`, `DESCRIBE`) | `sql:read` | Yes | Yes | Yes |
| Writes (`INSERT`, `UPDATE`, `DELETE`, `MERGE`) | `sql:write` | No | Yes | Yes |
| Everything else | `sql:ddl` | No | No | Yes |

`sql:ddl` is the catch-all, not a DDL-keyword list. `CREATE`/`ALTER`/`DROP`/`TRUNCATE`/`GRANT`/`REVOKE`/`SET`, `EXEC`/`CALL`, and anything the classifier cannot make sense of all land there. Unrecognized input fails closed, on the reasoning that a statement nobody can classify could do anything.

Classification looks past the outer keyword, which matters more than it sounds:

- A statement is parsed, not pattern-matched, and the **highest** class anywhere in the tree wins. `WITH t AS (DELETE FROM logs ...) SELECT * FROM t` is a write, not a read.
- `EXPLAIN` takes the class of the statement it wraps, because `EXPLAIN ANALYZE` executes that statement. `EXPLAIN (ANALYZE) DELETE FROM t` is a write.
- `SELECT ... INTO` creates a table or writes a file, so it classifies as `sql:ddl` rather than a read.
- A `SELECT` calling a side-effecting or filesystem builtin (`pg_terminate_backend`, `setval`, `pg_read_file`, and similar) is raised to `sql:write`, which is the lowest class a `viewer` cannot reach.
- Multi-statement input takes the highest class present, so one `DROP` after a semicolon governs the whole submission.

The denylist behind that last rule covers known-dangerous builtins, not every function that could have a side effect. It stops casual and accidental writes on a `viewer` config; it is not a sandbox for a determined adversary.


## Running Queries

The terminal runs any SQL your database understands, subject to the access role above:

**SELECT queries** return formatted tables with timing:

```
> SELECT id, email FROM users WHERE active = true LIMIT 5;

┌────┬────────────────────┐
│ id │ email              │
├────┼────────────────────┤
│  1 │ alice@example.com  │
│  2 │ bob@example.com    │
└────┴────────────────────┘

2 rows (8ms)
```

**INSERT, UPDATE, DELETE** report affected rows:

```
> UPDATE users SET last_login = NOW() WHERE id = 1;

1 row affected (5ms)
```

**DDL statements** (CREATE, ALTER, DROP) work too, on an `admin`-role config:

```
> CREATE INDEX users_email_idx ON users(email);

OK (42ms)
```


## Stopping a Query That Will Not Come Back

`Escape` while a query is running gives the terminal back. What that does to the
database depends on the dialect, and the terminal says which one happened:

| Dialect | On `Escape` | What you see |
|---------|-------------|--------------|
| PostgreSQL | `pg_cancel_backend` on a second connection | `Cancelled. The server was asked to stop the query.` |
| MySQL | `KILL QUERY` on a second connection | `Cancelled. The server was asked to stop the query.` |
| SQL Server | nothing reaches the server | `Stopped waiting. The query may still be running on the server.` |
| SQLite | nothing reaches the server | `Stopped waiting. The query may still be running on the server.` |

The difference is not cosmetic. On the bottom two rows the query keeps running
to completion, holding locks and burning CPU, and the only thing that changed is
that noorm stopped listening for the answer. Kill it from the server side if it
matters.

SQL Server is a limitation of the driver layer rather than of the database:
tedious exposes a per-request cancel, but Kysely's MSSQL dialect owns the
request object and never hands it out. SQLite has no second connection to
interrupt the first from.

`Escape` also works while the terminal is still connecting, which is what a
network problem looks like before a query ever runs.


## Result Formatting

Results display in a formatted table with column alignment:

```
┌─────┬────────────────────┬────────┬───────────────────────┐
│ id  │ email              │ name   │ created_at            │
├─────┼────────────────────┼────────┼───────────────────────┤
│ 1   │ alice@example.com  │ Alice  │ 2024-01-15T10:30:00Z  │
│ 2   │ bob@example.com    │ Bob    │ 2024-01-15T11:45:00Z  │
└─────┴────────────────────┴────────┴───────────────────────┘

2 rows (15ms)
```

Long values are truncated with an ellipsis to fit the column. There is no per-cell detail view, so to read a value in full, re-run the query selecting fewer columns.

Once a query returns rows, press `Tab` to move into the results table. From there:

| Key | Action |
|-----|--------|
| `↑` / `↓` | Navigate rows |
| `/` | Filter rows |
| `s` | Sort by a column |
| `c` | Clear the filter and sort |
| `Tab` or `Esc` | Return to the query input |

Errors display inline with the original query:

```
> SELECT * FROM nonexistent;

Error: relation "nonexistent" does not exist
```


## Query History

Every query you run is saved. Browse and re-execute past queries without retyping.


### Browsing History

Press `h` to open the history viewer. The input must be empty, so clear the prompt first:

```
┌─ Query History ─────────────────────────────────────────────┐
│                                                             │
│  1. SELECT * FROM users LIMIT 10           12ms  ✓  1h ago  │
│  2. UPDATE users SET active = true...       5ms  ✓  2h ago  │
│  3. SELECT * FROM nonexistent               -    ✗  2h ago  │
│  4. INSERT INTO logs (msg) VALUES...        8ms  ✓  3h ago  │
│                                                             │
│  [r] Re-run  [Enter] View result  [c] Clear  [↑/↓] Navigate │
└─────────────────────────────────────────────────────────────┘
```

- `✓` indicates successful queries
- `✗` indicates failed queries
- `r` sends the selected query back to the terminal, pre-filled and ready to edit before you run it
- `Enter` opens the stored results for that entry

The history viewer has no search. To find an old query, scroll with the arrow keys.


### Viewing Saved Results

Select a history entry and press `Enter` to view the full results from when the query ran. Results are stored gzipped, so you can review query output even after the data has changed.

Only queries that returned rows have stored results. Pressing `Enter` on a failed entry shows its error message instead, and on a row-less entry it tells you there is nothing stored.


## Writing Multi-Line Queries

The terminal has no tab completion. `Tab` inserts four spaces, so you can indent a query by hand.

There are two ways to write across several lines. `Shift+Enter` inserts a newline without running anything. For a longer statement, press `Shift+Tab` to enter edit mode, where plain `Enter` becomes a newline and the prompt changes to `[EDIT]>`. Press `Shift+Tab` again to leave edit mode and get Enter-to-execute back.


## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `Enter` | Execute query (insert a newline in edit mode) |
| `Shift+Enter` | Insert a newline |
| `Shift+Tab` | Toggle edit mode |
| `Tab` | Insert four spaces, or move between the query and the results table once a query has returned rows |
| `Up` / `Down` | Navigate command history when the input is empty, otherwise move the cursor |
| `Left` / `Right` | Move the cursor |
| `Escape` | Stop a running query or a connect in progress; otherwise clear the input, and on an empty input leave the terminal |
| `h` | Open the history viewer (empty input only) |


## Clearing History

Open the history viewer with `h`, then press `c` for the clear menu:

```
┌─ Clear History ─────────────────────────────────────────────┐
│                                                             │
│  1. Clear last 3 months                                     │
│  2. Clear all history                                       │
│                                                             │
│  History: 47 entries, 2.3 MB stored                         │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

"Clear last 3 months" removes entries older than three months and keeps the rest. Either option deletes the stored result files along with their history entries. `noorm sql clear` does the same job from a shell.


## Tips

**Always use LIMIT** when exploring unfamiliar tables. A table with millions of rows will slow down your terminal.

**Preview before modifying** - Run a SELECT with your WHERE clause before executing UPDATE or DELETE:

```
> SELECT id, email FROM users WHERE last_login < '2023-01-01';
-- Review the results
> DELETE FROM users WHERE last_login < '2023-01-01';
```

**History is not encrypted** - Query text sits in plain JSON at `.noorm/state/history/<config>.json`, and returned rows sit gzipped beside it in `.noorm/state/history/<config>/`. Neither is encrypted, unlike `state.enc`. Both are written owner-only (`0600`, in a `0700` directory), but anything a `SELECT` pulled out of a credentials or PII table is readable by your user account. Avoid running queries that contain passwords or API keys, and clear the history after one slips through.


## What's Next?

- [Schema Explorer](/guide/database/explore) - Browse tables, views, and other database objects
- [Configs](/guide/environments/configs) - Switch between different databases
- [Execution](/guide/sql-files/execution) - Run SQL files with change detection
