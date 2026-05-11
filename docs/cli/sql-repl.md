# noorm sql repl


Launch the TUI directly on the SQL Terminal screen. Uses the active config
unless `--config` is provided.

For one-off non-interactive queries (CI scripts, ad-hoc inspection), use [`noorm sql query`](./sql.md) — `repl` requires an interactive TTY.


## Flags

- `--config <name>` / `-c` — switch active config before launching


## Environment

Interactive TTY required. Fails with exit code 1 in CI or piped stdin.

A REPL is interactive by definition, so `--yes` / `NOORM_YES` cannot make it
succeed. They produce a redirect hint instead, pointing at `noorm sql query`
for one-shot SQL and `noorm sql query --file` for files. See
[Non-interactive operation](../guide/automation/non-interactive.md).


## Example

    noorm sql repl
    noorm sql repl --config dev
