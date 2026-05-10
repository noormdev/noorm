# noorm init


Bootstrap a new noorm project interactively. Creates identity (if not present),
project structure (`sql/`, `changes/`, `.noorm/`), `settings.yml`, and `state.enc`.


## Flags

- `--force` / `-f` — overwrite an existing `.noorm/` directory
- `--here` — initialize in the original cwd, ignoring any parent `.noorm/` discovered while walking up


## Picking the project root

Every `noorm` invocation walks up from the current directory looking for a
`.noorm/` folder, then `chdir`s into it. That is what lets you run commands from
deep inside a repo without thinking about paths. It also means `noorm init` from
a subfolder of an already-initialized project tries to re-init the *parent*.

Two flags opt out of that behavior, depending on where you want to invoke from:

- `noorm init --here` — stay in the cwd you launched from. Use this when you want to nest a fresh noorm project inside one that already exists (e.g. a `packages/db/` workspace under a repo that has its own `.noorm/`).
- `noorm -c <path> init` — global flag (must precede the subcommand, like `git -C`). Resolves `<path>` relative to the current shell, `chdir`s into it, and skips the walk-up entirely.


## Environment

Interactive TTY required. Fails with exit code 1 in CI or piped stdin.


## Example

    noorm init
    noorm init --force
    noorm init --here

    # From the repo root, init a sub-project at packages/db
    noorm -c packages/db init
