# noorm sql


Execute SQL statements and manage query history from the command line.

The `sql` namespace groups four subcommands:

| Subcommand | Purpose |
|------------|---------|
| `query`    | Run a SQL statement against the active config |
| `history`  | Show recent queries (with rows and timings) |
| `clear`    | Clear the saved query history |
| `repl`     | Launch the TUI directly on the SQL Terminal screen |


## Running a single query


### Canonical form

The explicit form is always correct and is what scripts and CI pipelines should use:

    noorm sql query "SELECT 1"
    noorm sql query "SELECT id, name FROM users LIMIT 10"
    noorm sql query --json "SELECT id, name FROM users"
    noorm sql query -f reports/monthly.sql


### Bare form (convenience)

The shorter `noorm sql "<SQL>"` form is also supported. Internally, the CLI inspects argv before handing off to citty — if the first non-flag token after `sql` looks like a SQL statement (it starts with one of `SELECT`, `INSERT`, `UPDATE`, `DELETE`, `MERGE`, `WITH`, `CREATE`, `DROP`, `ALTER`, `TRUNCATE`, `EXEC`, `EXECUTE`, `CALL`, `SHOW`, `EXPLAIN`, `GRANT`, `REVOKE`, `COMMENT`, `PRAGMA`, `VACUUM`, `ANALYZE`, `BEGIN`, `COMMIT`, `ROLLBACK`, `SAVEPOINT`, or `USE`), the CLI inserts the `query` subcommand for you:

    noorm sql "SELECT 1"                # → noorm sql query "SELECT 1"
    noorm sql --json "SELECT 1 AS one"  # → noorm sql query --json "SELECT 1 AS one"

The rewrite is purely positional — it never modifies the actual SQL string or flags. The real subcommands (`query`, `history`, `clear`, `repl`) are reserved words that never trigger the rewriter.


### Flags (on `query`)

- `--config <name>` / `-c` — switch the active config for this invocation
- `--json` — print the result as JSON instead of human output
- `--file <path>` / `-f` — read SQL from a file

> `--json` is per-subcommand — place it after `query` (`noorm sql query "…" --json`),
> not before `sql`. See [CLI flag conventions](./flags.md) for the full rule.


## Sibling commands

For interactive use and history management:

- [`noorm sql repl`](./sql-repl.md) — launch the TUI on the SQL terminal screen
- `noorm sql history` — list recent queries
- `noorm sql clear` — wipe the saved history


## Examples

    # One-off query against the active config
    noorm sql query "SELECT count(*) FROM users"

    # Same thing, bare form
    noorm sql "SELECT count(*) FROM users"

    # Run a SQL file (CI-friendly)
    noorm sql query -f reports/monthly.sql --json

    # Pick a different config
    noorm sql query -c prod "SELECT count(*) FROM orders"
