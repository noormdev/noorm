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

On Alpine Linux, the standalone CLI needs `libstdc++` and no separate Node.js or Bun runtime. For the shell installer, install `curl`, CA certificates, and `libstdc++` first with `apk add curl ca-certificates libstdc++`. The next CLI release supplies native musl binaries and automatically selects them when installing. For manual downloads from GitHub Releases, choose `noorm-linux-x64-musl` or `noorm-linux-arm64-musl`; glibc Linux uses `noorm-linux-x64` or `noorm-linux-arm64`.

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

## SQL pipelines

For a workflow defined in `db/pipelines/close-period/pipeline.yml` with a declared `period` input:

```bash
noorm pipeline run close-period --period 2026-10
noorm pipeline history close-period --limit 20
```

Each invocation runs the workflow fresh with its own history. See the [SQL pipelines guide](https://noorm.dev/guide/sql-pipelines) for the manifest, SQL steps, and transaction options.



## Programmatic access

For type-safe database access in your applications, use the SDK:

```bash
npm install @noormdev/sdk kysely
```

[SDK Documentation](https://noorm.dev/getting-started/building-your-sdk)


## License

MIT
