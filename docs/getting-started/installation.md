# Installation


## Requirements

- A supported database:
    - PostgreSQL
    - MySQL
    - SQLite
    - SQL Server (MSSQL)


## Install the CLI

The CLI provides both an interactive terminal UI and headless mode for CI/CD.

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

### Windows

Download [noorm-windows-x64.exe](https://github.com/noormdev/noorm/releases) from the latest `@noormdev/cli` release, rename it to `noorm.exe`, and add it to your PATH.

### Verify

```bash
noorm --version
```

### Update

noorm can update itself:

```bash
# Headless
noorm -H update

# Or from the TUI home screen, press [u]
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


## Initialize a Project

After installation, initialize noorm in your project:

```bash
cd your-project
noorm init
```

This creates:

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
