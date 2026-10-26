# noorm init


Create a noorm project in the current repository: the `.noorm/` state folder and the `db/` folder that holds your schema.

```bash
noorm init --yes
```

```
┌  noorm init
│
●  Using existing identity: Alice Cooper <alice@example.com>
│
◇  Done
│
└  noorm initialized.
  Created:
    db/sql/.gitkeep
    db/changes/.gitkeep
    db/AGENTS.md
    db/CLAUDE.md
    .noorm/.gitignore
    .noorm/settings.yml
    .noorm/state/state.enc
```

```
.
├── .gitignore               # gains "# noorm" and ".noorm/state/"
├── .noorm/
│   ├── .gitignore           # state/
│   ├── settings.yml         # paths: ./db/sql, ./db/changes
│   └── state/state.enc      # configs and secrets, encrypted with your identity key
└── db/
    ├── AGENTS.md            # points coding agents at the /noorm skill
    ├── CLAUDE.md            # imports AGENTS.md
    ├── changes/
    └── sql/
```

`db/AGENTS.md` also states that `sql/` is the schema's current state and `changes/` brings existing databases up to it. It points data modeling at [ignatius](/modeling/) and its [`/ignatius-modeling` skill](/modeling/modeling-skill), and holds a marker comment for your own steering. `db/CLAUDE.md` is one line, `@AGENTS.md`. Without `--yes`, `init` prompts for a name and email when no identity exists yet.


## Flags


| Flag | Effect |
|------|--------|
| `--force`, `-f` | Initialize a folder that already has `.noorm/`. Resets `settings.yml` to defaults and keeps its `paths` |
| `--here` | Initialize the directory you launched from, ignoring a parent `.noorm/` |
| `--yes`, `-y` | Skip prompts. Needs an identity in `~/.noorm/`. `NOORM_YES=1` is the same |

`noorm init` has no `--json` flag.


## Which folder becomes the project root?


Every `noorm` command walks up from the current directory to the nearest `.noorm/` and runs there. `init` follows the same rule, so it targets the parent project unless you say otherwise.

| Invocation | Project root |
|------------|--------------|
| `noorm init` | Nearest parent holding `.noorm/`; the current directory when none does |
| `noorm init --here` | The directory you launched from. Nests a project inside another, such as `packages/db/` |
| `noorm -c packages/db init` | `packages/db`, with no walk up. `-c` must come before `init` |


## What happens to an existing project?


| Condition | Behavior |
|-----------|----------|
| `.noorm/` exists, no `--force` | `Error: noorm project already initialized at <path>. Use --force to reinitialize.`, exit 1 |
| `--force` | `settings.yml` resets to defaults except `paths`. `db/AGENTS.md` and `db/CLAUDE.md` are written only when absent, so your edits stay |
| `paths` are not `./db/sql` and `./db/changes` | Layout kept; no `db/` folder is created. A project at `./sql` and `./changes` stays there |
| `.gitignore` already lists `.noorm/state/` | Left alone; otherwise the block is appended |

`db/sql/.gitkeep` and `db/changes/.gitkeep` are listed under `Created:` on every run for a default layout. They are empty files and are not overwritten.


## How do I run it in CI?


`--yes` skips every prompt but cannot create an identity. Create one first. A checkout that already has `.noorm/` needs no `init`, and running it there exits 1, so guard it:

```bash
[ -f ~/.noorm/identity.key ] || noorm identity init --name "$CI_USER" --email "$CI_EMAIL"
[ -d .noorm ] || noorm init --yes
```

| Condition | Behavior |
|-----------|----------|
| No terminal and no `--yes` | `Error: noorm init requires an interactive terminal.`, exit 2 |
| `--yes`, but one of `identity.key`, `identity.pub`, `identity.json` is missing | `Error: noorm init --yes requires an existing identity at ~/.noorm/identity.{key,pub,json}.` with the two commands to fix it, exit 2 |
| Ctrl+C at a prompt | `Cancelled.`, exit 0 |
| Bootstrap fails after the prompts | The error text, exit 1 |


## Next


- [Creating a database](/guide/database/create): add a config, create the database, build
- [First build](/getting-started/first-build)
- [CLI flag conventions](/cli/flags): where `-c` and `--yes` go
