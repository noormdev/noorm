<div align="center">

# noorm

### Write SQL. Skip the ORM.

A SQL-first schema and change manager for **PostgreSQL**, **MySQL**, **SQLite**, and **SQL Server**.<br>
Your schema lives in SQL files. noorm builds it, versions it, and keeps every environment in sync.

[![@noormdev/cli](https://img.shields.io/npm/v/@noormdev/cli?color=E05742&label=%40noormdev%2Fcli)](https://www.npmjs.com/package/@noormdev/cli)
[![@noormdev/sdk](https://img.shields.io/npm/v/@noormdev/sdk?color=916336&label=%40noormdev%2Fsdk)](https://www.npmjs.com/package/@noormdev/sdk)
[![CI](https://github.com/noormdev/noorm/actions/workflows/ci.yml/badge.svg)](https://github.com/noormdev/noorm/actions/workflows/ci.yml)
[![license](https://img.shields.io/badge/license-MIT-blue)](./LICENSE)

**[Documentation](https://noorm.dev)** · **[Getting started](https://noorm.dev/getting-started/installation)** · **[Terminal UI](https://noorm.dev/tui)** · **[SDK](https://noorm.dev/reference/sdk)**

</div>

<br>

<img src="https://raw.githubusercontent.com/noormdev/noorm/master/docs/public/image/tui.gif" alt="noorm's terminal UI: adding a config, creating the database, building the schema, fast-forwarding changes, and browsing the result in the schema explorer" width="100%">

<br>

## Install

```bash
curl -fsSL https://noorm.dev/install.sh | sh
```

Or via npm:

```bash
npm install -g @noormdev/cli
```

The install script is [fully transparent and open source](https://github.com/noormdev/noorm/blob/master/install.sh) — it downloads a prebuilt binary from [GitHub Releases](https://github.com/noormdev/noorm/releases), built from this repository's source. It installs to a user-writable directory already in your PATH when possible, falling back to `~/.local/bin`.

> Corporate network? Use the GitHub mirror:
> `curl -fsSL https://raw.githubusercontent.com/noormdev/noorm/master/install.sh | sh`


## Quick start

```bash
# Bootstrap a project — creates your identity and the sql/ and changes/ layout
noorm init

# Add a database config
noorm ui
```

Adding a config is the one step with no headless equivalent: it needs connection details and a live connection test, so `noorm config add` sends you to the TUI. From there, **[c] Config → [a] Add**, then **[r] Run → [b] Build** to execute your SQL files.

With a config in place, everything else runs headlessly:

```bash
noorm run build             # Build the schema from SQL files
noorm change ff             # Apply pending changes
noorm db explore --json     # Inspect the database as JSON
```

In CI there is no TUI to fall back on, so bootstrap from `NOORM_*` environment variables instead:

```bash
noorm ci init --name ci     # reads NOORM_IDENTITY_* and NOORM_CONNECTION_*
noorm run build
```


## How it works

Migration tools make you describe your schema twice: once in the migrations that built it, and once in your head. The current state only exists if you replay every file in order.

noorm inverts that.

|  |  |
|---|---|
| **SQL files** | Are your current schema. A fresh database runs them and is done. |
| **Changes** | Move an existing database from any state to current — forward/revert pairs that noorm tracks, checksums, and applies in order. |
| **Stages** | Keep dev, staging, and production apart, with access roles per environment. |
| **SDK** | Wraps it in a type-safe client — Kysely queries, stored procedures, and TVFs. |

You write SQL. noorm executes it, tracks what ran, and keeps environments in sync.


## Why noorm?

ORMs push you toward a surrogate ID on every table and join-heavy queries. Proper relational design uses inherited keys, basetype-subtypes, and compound constraints — things ORMs can't express, and that migration tools make painful to maintain.

noorm lets you write the SQL your database was designed for, then manages execution across environments.

Read the argument in full: **[The case for proper relational design](https://noorm.dev/guide/relational-design)**


## SDK

For programmatic access in your applications:

```bash
npm install @noormdev/sdk kysely
```

Build a dedicated database package with a domain class per area of your schema, each holding a typed `Context`. Kysely types mirror your database, integration tests run against a real one, and the same package works in servers, workers, and CLIs.

**[Building your SDK →](https://noorm.dev/getting-started/building-your-sdk)**


## Coding agents

If you use an AI coding agent, install the noorm skill so it writes against the real conventions instead of guessing:

```bash
npx skills add noormdev/noorm/skills
```

It teaches the agent the SDK surface, the CLI's headless flags, template syntax, and config layout — the parts that are easy to get subtly wrong.

noorm also runs as an [MCP server](https://noorm.dev/guide/automation/mcp), behind per-channel access roles: admin at your terminal, read-only for the agent, or invisible entirely.


## License

MIT
