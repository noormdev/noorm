# noorm run


Execute SQL files against the active database. There are five subcommands —
`build`, `file`, `dir`, `files`, and `exec` — and they all share the same
result shape and exit-code semantics.


## Subcommands

| Command | Purpose |
|---------|---------|
| `noorm run build` | Execute every file under `paths.sql/` |
| `noorm run file <path>` | Execute a single file |
| `noorm run dir <path>` | Execute every file in a directory |
| `noorm run files --paths a.sql,b.sql` | Execute an explicit, ordered list |
| `noorm run exec <dir-or-glob>` | Discover files by glob, then execute |


## Flags

Common to every subcommand:

- `--config <name>` / `-c <name>` — use a named config from `state.enc`
- `--force` / `-f` — re-run even if the file's checksum matches a prior success
- `--dry-run` — render templates and write to `tmp/` without executing
- `--json` — emit machine-readable JSON on stdout


## Exit codes

| Code | Meaning |
|------|---------|
| `0` | Every file succeeded or was skipped |
| `1` | Setup failed (could not connect, project not initialized, bad args) |
| `2` | The runner ran but at least one file failed |


## Output: failure

When a file errors, the human-readable output includes the SQL error
beneath the file's status line so you don't have to scroll the log
looking for the cause:

    sql/02_tables/Memory.sql (failed)
      error: relation "memory" does not exist
    Build completed  status=failed filesRun=12 filesSkipped=0 filesFailed=1 durationMs=84

The same information lives on the JSON output's per-file entries. The
`--json` payload is the unmodified `BatchResult` (or `FileResult` for
`noorm run file`) returned by the SDK, so `files[].error` is populated
for every failed file:

    {
        "status": "failed",
        "files": [
            {
                "filepath": "sql/02_tables/Memory.sql",
                "status": "failed",
                "error": "relation \"memory\" does not exist",
                "durationMs": 4.2,
                "checksum": "..."
            }
        ],
        "filesRun": 12,
        "filesSkipped": 0,
        "filesFailed": 1,
        "durationMs": 84
    }


## Output: skip

A file is skipped when its checksum matches a previous successful
execution. The reason is shown inline:

    sql/seeds/Sentinels.sql.tmpl (skipped: unchanged)

In JSON form, `skipReason` is set to `'unchanged'` (or `'already-run'`
for the change-level checks):

    {
        "filepath": "sql/seeds/Sentinels.sql.tmpl",
        "status": "skipped",
        "skipReason": "unchanged",
        "checksum": "..."
    }


If a file was skipped because you forgot `--force` after wiping the
database, this is the signal to look for. Pass `--force` to re-run
regardless of the checksum cache.


## MSSQL: `GO` batches


On MSSQL connections, files containing multiple statements separated by `GO`
(the T-SQL batch separator) work as you'd expect — `CREATE PROCEDURE`,
`CREATE FUNCTION`, `CREATE TRIGGER`, `CREATE VIEW`, and `CREATE TYPE` for
table-valued parameters can be grouped in a single file. The runner splits on
`GO` (anchored to its own line) and executes batches sequentially. If a batch
fails, the error is prefixed with `[batch N of M]` so you can identify the
offending statement without re-reading the file. See
[Writing MSSQL Files with GO](/guide/sql-files/execution#mssql-multiple-statements-per-file)
for examples and the
[runner internals](/dev/runner#mssql-batch-handling) for the splitter rules
and known limitations.


## Examples

    noorm run build
    noorm run build --force
    noorm run build --json

    noorm run file sql/init.sql
    noorm run file seeds/test-data.sql.tmpl --dry-run

    noorm run dir sql/02_views/
    noorm run files --paths sql/01_tables/users.sql,sql/01_tables/orders.sql

    noorm run exec "sql/**/*.sql"
