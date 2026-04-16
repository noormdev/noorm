# noorm sql repl


Launch the TUI directly on the SQL Terminal screen. Uses the active config
unless `--config` is provided.


## Flags

- `--config <name>` / `-c` — switch active config before launching


## Environment

Interactive TTY required. Fails with exit code 1 in CI or piped stdin.


## Example

    noorm sql repl
    noorm sql repl --config dev
