# @noormdev/cli

A CLI for SQL-first database development. Manage SQL files, track changes, and run builds across dev, staging, and production — no ORM required.

**[Documentation](https://noorm.dev)** | **[Getting Started](https://noorm.dev/getting-started/installation)** | **[Source](https://github.com/noormdev/noorm)**


## Install

```bash
npm install -g @noormdev/cli
```

Installing this package downloads the prebuilt `noorm` binary for your platform from [GitHub Releases](https://github.com/noormdev/noorm/releases) and verifies its SHA-256 against the release's `checksums.txt` before making it executable. A mismatch aborts the install.

You can also install without npm:

```bash
curl -fsSL https://noorm.dev/install.sh | sh
```

Supports **PostgreSQL**, **MySQL**, **SQLite**, and **SQL Server** on macOS, Linux, and Windows.


## Quick Start

```bash
# Initialize a project
noorm init

# Launch the interactive TUI
noorm ui

# Or run commands headlessly
noorm config add
noorm run build
noorm change ff
```


## What It Does

- **SQL files** define your current schema — no migration archaeology
- **Changes** evolve existing databases from any state to current
- **Stages** manage dev, staging, and production with different configs

You write SQL. noorm executes it, tracks what ran, and keeps multiple environments in sync.

Every command runs non-interactively by default and emits structured output suitable for CI/CD — see the [headless reference](https://noorm.dev/headless).


## Programmatic access

For type-safe database access in your applications, use the SDK:

```bash
npm install @noormdev/sdk kysely
```

[SDK Documentation](https://noorm.dev/getting-started/building-your-sdk)


## License

MIT
