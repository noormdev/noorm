# Troubleshooting


Find the message you see, read the cause, and apply the fix. Exit code `2` means the command never ran, `1` means it failed and a retry is safe, and `3` means some work landed ([exit codes](/headless#exit-codes)).


## Why does a command fail or surprise me?


| Message or symptom | Cause | Fix |
|---|---|---|
| `Unrecognized flag '--config' before the subcommand` | Only `-c`/`--cwd` is a root flag | `noorm run build --config prod` |
| `Error: --cwd path is not a directory: …/prod` | In `noorm -c prod run build`, `-c` means `--cwd` | `noorm run build -c prod` |
| `Unknown command help` | There is no `noorm help` | `noorm db create --help` |
| `db create --name foo` creates nothing named `foo` | `db create` has no `--name`. The config names the database | `noorm config import dev-config.json`, then `noorm db create -c dev` |
| `Unknown command` from `noorm sql "…"` | The `sql query` rewrite needs the query to start with a SQL verb, so a leading comment defeats it | `noorm sql query "…"` |
| `Error: noorm init requires an interactive terminal.` | No terminal, no `--yes` | `noorm identity init …`, then `noorm init --yes` |
| `--dry-run` leaves files in `tmp/` | It renders SQL there with secrets resolved, and `tmp/` is not gitignored | Delete `tmp/`, or use `noorm run preview <path>` |


## Why does the database refuse or misbehave?


Each server sends one error for a wrong password and an unknown account. noorm rewords it, and the server's own text is in `.noorm/state/noorm.log` (`connection:error`, fields `serverCode` and `serverMessage`).

| Message | Also sent for |
|---|---|
| `Login failed for user …` (SQL Server) | Unknown login, login denied `CONNECT SQL`, Windows-only authentication |
| `Password authentication failed for user …` (PostgreSQL) | Unknown role, password past `VALID UNTIL` |
| `Access denied for user …` (MySQL) | Unknown user, no account for this client host, `REQUIRE SSL` account |

| Symptom | Cause | Fix |
|---|---|---|
| A right password fails from `NOORM_CONNECTION_PASSWORD` | The compiled binary does not read `.env` files | Export the variable, or set it in CI |
| An MSSQL procedure's `DEFAULT` is not applied | The SDK sends `undefined` as `NULL`, and MSSQL applies a `DEFAULT` only to an omitted parameter | `.default(value)` in the Zod schema, or omit the key ([details](/reference/sdk#parameter-handling-and-null-semantics)) |


## Next


- [CLI flag conventions](/cli/flags): where each flag goes
- [Non-interactive operation](/guide/automation/non-interactive): `--yes` and what still refuses
