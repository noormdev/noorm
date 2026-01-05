# Installation


## Requirements

- **Node.js 18** or higher
- A supported database:
    - PostgreSQL
    - MySQL
    - SQLite
    - SQL Server (MSSQL)


## Install the CLI

The CLI provides both an interactive terminal UI and headless mode for CI/CD.

```bash
# npm
npm install -g @noormdev/cli

# yarn
yarn global add @noormdev/cli

# pnpm
pnpm add -g @noormdev/cli
```

Verify the installation:

```bash
noorm --version
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
The CLI bundles all drivers—no extra installation needed. These are only required if you're using the SDK directly.
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
│   ├── settings.yml       # Project configuration
│   └── state.enc          # Encrypted state (configs, secrets)
├── sql/                   # Your SQL files
│   └── .gitkeep
└── changes/               # Versioned changes
    └── .gitkeep
```

::: warning Git Ignore
Add `.noorm/state.enc` to your `.gitignore`. This file contains encrypted configs and secrets specific to each developer's machine. The `.noorm/settings.yml` should be committed—it's the shared project configuration.
:::


## Next Steps

You're ready to go! Continue to:

- [First Build](/getting-started/first-build) - Complete the 5-minute tutorial
- [Concepts](/getting-started/concepts) - Understand the mental model
