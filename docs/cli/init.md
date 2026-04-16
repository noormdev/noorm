# noorm init


Bootstrap a new noorm project interactively. Creates identity (if not present),
project structure (`sql/`, `changes/`, `.noorm/`), `settings.yml`, and `state.enc`.


## Flags

- `--force` / `-f` — overwrite an existing `.noorm/` directory


## Environment

Interactive TTY required. Fails with exit code 1 in CI or piped stdin.


## Example

    noorm init
    noorm init --force
