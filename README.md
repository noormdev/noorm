# noorm

A CLI for SQL-first database development. Manage SQL files, track changes, and run builds across dev, staging, and production — no ORM required.

**[Documentation](https://noorm.dev)** | **[Getting Started](https://noorm.dev/getting-started/installation)** | **[npm](https://www.npmjs.com/package/@noormdev/cli)**


## Install

```bash
curl -fsSL https://noorm.dev/install.sh | sh
```

Or via npm:

```bash
npm install -g @noormdev/cli
```

The install script is [fully transparent and open source](https://github.com/noormdev/noorm/blob/master/install.sh) — it downloads a prebuilt binary from [GitHub Releases](https://github.com/noormdev/noorm/releases), built from this repository's source. It installs to a user-writable directory already in your PATH when possible (e.g. `~/.local/bin`), falling back to `~/.local/bin` if none is found.

> Corporate network? Use the GitHub mirror:
> `curl -fsSL https://raw.githubusercontent.com/noormdev/noorm/master/install.sh | sh`


## What It Does

- **SQL files** define your current schema — no migration archaeology
- **Changes** evolve existing databases from any state to current
- **Stages** manage dev, staging, and production with different configs
- **SDK** provides type-safe programmatic access to your database

You write SQL. noorm executes it, tracks what ran, and keeps multiple environments in sync.

Supports **PostgreSQL**, **MySQL**, **SQLite**, and **SQL Server**.


## Quick Start

```bash
# Initialize a project
noorm init

# Launch the interactive TUI
noorm

# Or use headless mode
noorm -H config add
noorm -H run build
noorm -H change ff
```

From the TUI:

1. **[i] Identity** — Set your name (for team tracking)
2. **[c] Config → [a] Add** — Create a database config
3. **[r] Run → Build** — Execute your SQL files


## Why noorm?

ORMs push you toward surrogate IDs on every table and join-heavy queries. Proper relational design uses inherited keys, basetype-subtypes, and compound constraints — things ORMs can't express.

noorm lets you write the SQL your database was designed for, then manages execution across environments.

Read more: [noorm.dev](https://noorm.dev)


## SDK

For programmatic access in your applications:

```bash
npm install @noormdev/sdk kysely
```

Build type-safe domain classes — consumers (queries), producers (mutations), and guards (validation). One package, used everywhere.

[SDK Documentation](https://noorm.dev/getting-started/building-your-sdk)


## License

MIT
