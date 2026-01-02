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
# npm
npm install @noormdev/sdk

# yarn
yarn add @noormdev/sdk

# pnpm
pnpm add @noormdev/sdk
```

You'll also need to install a database driver for your dialect:

```bash
# PostgreSQL
npm install pg

# MySQL
npm install mysql2

# SQLite
npm install better-sqlite3

# SQL Server
npm install tedious tarn
```

::: tip Driver Installation
The SDK uses peer dependencies, so you only install the drivers you need. If you're only using SQLite for local development, you don't need `pg` or `mysql2`.
:::


## Database Drivers


### PostgreSQL

```bash
npm install pg
```

Connection example:

```
dialect: postgres
host: localhost
port: 5432
user: postgres
password: secret
database: myapp
```


### MySQL

```bash
npm install mysql2
```

Connection example:

```
dialect: mysql
host: localhost
port: 3306
user: root
password: secret
database: myapp
```


### SQLite

```bash
npm install better-sqlite3
```

Connection example:

```
dialect: sqlite
database: ./data/local.db
```

::: info SQLite Paths
SQLite database paths are relative to your project root. Use `./` prefix for clarity.
:::


### SQL Server (MSSQL)

```bash
npm install tedious tarn
```

Connection example:

```
dialect: mssql
host: localhost
port: 1433
user: sa
password: secret
database: myapp
```


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
└── changes/               # Versioned migrations
    └── .gitkeep
```

::: warning Git Ignore
Add `.noorm/state.enc` to your `.gitignore`. This file contains encrypted configs and secrets specific to each developer's machine. The `.noorm/settings.yml` should be committed—it's the shared project configuration.
:::


## Next Steps

You're ready to go! Continue to:

- [First Build](/getting-started/first-build) - Complete the 5-minute tutorial
- [Concepts](/getting-started/concepts) - Understand the mental model


## Troubleshooting


### Command not found: noorm

If you installed globally but the command isn't found:

1. Check your npm global bin directory:

   ```bash
   npm bin -g
   ```

2. Ensure it's in your PATH:

   ```bash
   export PATH="$(npm bin -g):$PATH"
   ```

3. Or use npx:

   ```bash
   npx @noormdev/cli
   ```


### SQLite native module issues

`better-sqlite3` requires compilation. If you see build errors:

```bash
# macOS
xcode-select --install

# Ubuntu/Debian
sudo apt-get install build-essential python3

# Windows
npm install --global windows-build-tools
```


### Permission errors on global install

```bash
# Option 1: Use sudo (not recommended)
sudo npm install -g @noormdev/cli

# Option 2: Fix npm permissions (recommended)
# See: https://docs.npmjs.com/resolving-eacces-permissions-errors
```
