# noorm init


Bootstrap a new noorm project interactively. Creates identity (if not present),
project structure (`sql/`, `changes/`, `.noorm/`), `settings.yml`, and `state.enc`.


## Flags

- `--force` / `-f` — overwrite an existing `.noorm/` directory
- `--here` — initialize in the original cwd, ignoring any parent `.noorm/` discovered while walking up
- `--yes` / `-y` — proceed non-interactively when a full identity already exists at `~/.noorm/identity.{key,pub,json}`. Equivalent to setting `NOORM_YES=1`. See [Non-interactive operation](../guide/automation/non-interactive.md) for details.


## Picking the project root

Every `noorm` invocation walks up from the current directory looking for a
`.noorm/` folder, then `chdir`s into it. That is what lets you run commands from
deep inside a repo without thinking about paths. It also means `noorm init` from
a subfolder of an already-initialized project tries to re-init the *parent*.

Two flags opt out of that behavior, depending on where you want to invoke from:

- `noorm init --here` — stay in the cwd you launched from. Use this when you want to nest a fresh noorm project inside one that already exists (e.g. a `packages/db/` workspace under a repo that has its own `.noorm/`).
- `noorm -c <path> init` — global flag (must precede the subcommand, like `git -C`). Resolves `<path>` relative to the current shell, `chdir`s into it, and skips the walk-up entirely.


## Environment

Interactive TTY required by default. Fails with exit code 1 in CI or piped stdin
unless `--yes` / `NOORM_YES=1` is set AND a full identity already exists.


## Non-interactive (CI) flow

`noorm init --yes` (or `NOORM_YES=1 noorm init`) skips all prompts when a full
crypto identity already lives at `~/.noorm/identity.{key,pub,json}`. The identity
must be in place first — `--yes` does NOT bootstrap one. If any of the three
files is missing, `noorm init --yes` exits 1 with:

    Error: noorm init --yes requires an existing identity at ~/.noorm/identity.{key,pub,json}.
    Run: noorm identity init --name "Your Name" --email "you@example.com"
    Then re-run: noorm init --yes

The end-to-end CI bootstrap is two commands:

    # CI flow
    noorm identity init --name "$CI_USER" --email "$CI_EMAIL"
    noorm init --yes


## Example

    noorm init
    noorm init --force
    noorm init --here
    noorm init --yes                 # non-interactive, requires existing identity

    # From the repo root, init a sub-project at packages/db
    noorm -c packages/db init


## Next steps

After `init` lays down `settings.yml` and `.noorm/`, the database
itself still has to be provisioned. See
[Creating a database](../guide/database/create.md) for the configs-first
workflow (`config import` → `db create` → `config use`), and
[CLI flag conventions](./flags.md) for `--json` placement and the
global-vs-per-subcommand rules.
