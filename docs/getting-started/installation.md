# Installation


## Requirements

- A supported database:
    - PostgreSQL
    - MySQL
    - SQLite
    - SQL Server (MSSQL)


## Install the CLI

`noorm` is a non-interactive CLI by default. Every command emits structured output suitable for scripting or piping into CI/CD. Running `noorm ui` launches the optional Ink/React terminal wizard for when you'd rather point-and-click.

### macOS / Linux

```bash
curl -fsSL https://noorm.dev/install.sh | sh
```

This downloads a self-contained binary for your platform. The installer looks for a user-writable bin directory already in your PATH (`~/.local/bin`, `~/bin`, etc.) so you don't need sudo. No runtime dependencies needed.

::: tip Corporate network?
If `noorm.dev` is blocked, use the GitHub mirror:
```bash
curl -fsSL https://raw.githubusercontent.com/noormdev/noorm/master/install.sh | sh
```
:::

You can also override the install location:

```bash
NOORM_INSTALL_DIR=~/my-tools curl -fsSL https://noorm.dev/install.sh | sh
```

### npm

If you already work in a Node project, npm installs the same binary and puts it on your PATH for you:

```bash
npm install -g @noormdev/cli
```

The package is a thin wrapper: installing it downloads the prebuilt binary for your platform and verifies it, exactly as the shell installer does. `npx @noormdev/cli` works too if you'd rather not install globally.

This is the most convenient route on Windows, and the one to reach for when you want noorm pinned per-project rather than per-machine.

### Windows

Use the npm install above, or download [noorm-windows-x64.exe](https://github.com/noormdev/noorm/releases) from the latest `@noormdev/cli` release, rename it to `noorm.exe`, and add it to your PATH.

### Integrity verification

Every install path verifies the downloaded binary before it runs. The release publishes a `checksums.txt` alongside the binaries, and the installer (`install.sh`), the npm `postinstall` step, and `noorm update` each recompute the binary's SHA-256 and compare it against that file before making the binary executable. A mismatch aborts — a corrupted download or a tampered release asset never gets run.

Verification is fail-closed: if `checksums.txt` can't be fetched (an offline mirror, a network block, an older release without it), the install stops rather than trusting an unverified binary. To override that one case — and only that case — set `NOORM_INSECURE=1`:

```bash
NOORM_INSECURE=1 curl -fsSL https://noorm.dev/install.sh | sh

# self-update equivalent
noorm update --insecure
```

`NOORM_INSECURE` skips verification only when the checksums can't be reached. A confirmed hash mismatch always fails, escape hatch or not — the flag can't wave through a binary that has actually been altered.

### Verify

```bash
noorm --version
```

### Update

noorm can update itself:

```bash
noorm update

# Or launch the TUI (`noorm ui`) and press [u] from the home screen
```


## Install the SDK (Optional)

For programmatic access in scripts, tests, or custom tooling:

```bash
npm install @noormdev/sdk kysely
```

The SDK uses peer dependencies. Install the driver for your database:

| Dialect | Install |
|---------|---------|
| PostgreSQL | `npm install pg` |
| MySQL | `npm install mysql2` |
| SQLite | `npm install better-sqlite3` |
| SQL Server | `npm install tedious tarn` |

::: tip CLI Includes Drivers
The CLI bundles all drivers — no extra installation needed. These are only required if you're using the SDK directly.
:::


## Install the Agent Skill (Optional)

If you work with an AI coding agent — Claude Code, Codex, Cursor, Gemini CLI — install the noorm skill:

```bash
npx skills add noormdev/noorm/skills
```

Agents otherwise guess at noorm's conventions, and several of them are non-obvious enough to guess wrong: SDK methods throw named errors rather than returning them, `attempt()` is used deliberately rather than everywhere, the codebase uses no `try`/`catch`, and test helpers carry safety guards that exist for a reason. The skill covers all of it, plus the headless CLI flags used in CI.

It installs four references the agent reads on demand:

| Reference | Covers |
|-----------|--------|
| `sdk.md` | `createContext()`, Kysely patterns, error handling, testing |
| `cli.md` | Headless commands, flags, exit codes, CI usage |
| `templates.md` | `.sql.tmpl` syntax and data loaders |
| `config.md` | `settings.yml`, paths, stages, secrets |

::: tip Include paths are relative to `paths.sql`
The single most common mistake — by people and agents alike — is writing `build.include` entries relative to the project root. They resolve against `paths.sql`. The skill states this explicitly; `noorm run build` also warns when an include entry matches nothing.
:::


## Initialize a Project

After installation, launch the TUI in your project root — it detects the missing `.noorm/` directory and walks you through identity setup, project structure, and the first config:

```bash
cd your-project
noorm ui
```

The init wizard creates:

```
your-project/
├── .noorm/
│   ├── settings.yml           # Project settings (commit this)
│   └── state/
│       └── state.enc          # Encrypted state (don't commit)
├── sql/                       # Your SQL files
│   └── .gitkeep
└── changes/                   # Versioned changes
    └── .gitkeep
```

::: warning Git Ignore
Add `.noorm/state/` to your `.gitignore`. This folder contains encrypted configs and secrets specific to each developer's machine. The `.noorm/settings.yml` should be committed — it's the shared project configuration.
:::


## Next Steps

You're ready to go! Continue to:

- [First Build](/getting-started/first-build) - Complete the 5-minute tutorial
- [Concepts](/getting-started/concepts) - Understand the mental model
