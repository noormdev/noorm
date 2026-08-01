---
layout: home
title: noorm — Write SQL. Skip the ORM.
titleTemplate: false
description: A SQL-first schema and change manager for Postgres, MySQL, SQLite, and MSSQL. Your schema lives in SQL files. noorm builds it, versions it, and keeps every environment in sync.

hero:
  name: noorm
  text: "Write SQL. Skip the ORM."
  tagline: "The raw SQL manager people keep asking for. Schema in files, changes in git, one CLI to prod."
  actions:
    - theme: brand
      text: "Get started  →"
      link: /getting-started/installation
    - theme: alt
      text: View on GitHub
      link: https://github.com/noormdev/noorm

features:
  - icon:
      src: /icons/database.svg
    title: Schema lives in SQL files
    details: Your SQL files are the current schema. Fresh databases build from them in seconds. Existing ones catch up through versioned changes.
    link: /getting-started/concepts
    linkText: How it works
  - icon:
      src: /icons/cubes.svg
    title: Real relational design
    details: Compound keys, inherited keys, check constraints, subtype clusters. Model what your data actually is instead of one surrogate ID per table.
    link: /guide/relational-design
    linkText: The case for it
  - icon:
      src: /icons/git-branch.svg
    title: Procedures, functions, TVFs
    details: "Call stored procedures from TypeScript with typed params and result rows. Table-valued parameters included. The bridge ORMs never built."
    link: /reference/sdk#stored-procedures-functions-tvfs
    linkText: SDK reference
  - icon:
      src: /icons/fast-forward.svg
    title: Data pipelines
    details: Move data between databases in foreign-key order, across dialects, or out to portable files. Seed a QA environment from staging in one command.
    link: /guide/database/transfer
    linkText: Transfer data
  - icon:
      src: /icons/lock.svg
    title: Safe to point an agent at
    details: An MCP server exposes noorm to coding agents behind per-channel access roles. Admin at your terminal, read-only for the agent, invisible for prod.
    link: /guide/automation/mcp
    linkText: AI integration
  - icon:
      src: /icons/toolbox.svg
    title: One CLI, not five tabs
    details: Schema explorer, SQL terminal, encrypted vault, dynamic templates. Every command runs headless and emits JSON you can pipe into CI.
    link: /headless
    linkText: CLI reference
---


## Why noorm?

Migration tools make you describe your schema twice: once in the migrations that built it, and once in your head. The current state only exists if you replay every file in order, and the moment you need a compound key or a trigger you are writing raw SQL inside a wrapper that was designed to keep you away from it.

noorm inverts that. **Your SQL files are the current schema.** A fresh database runs them and is done. An existing database gets to the same place through **changes** — small forward/revert pairs that noorm tracks, checksums, and applies in order.

Everything else follows from that split:

- **Stages** keep dev, staging, and production configs apart, with access roles per environment
- **Templates** let one SQL file render differently per environment
- **The SDK** wraps it all in a type-safe client — Kysely queries, stored procedures, and TVFs
- **Headless mode** makes every command scriptable, with `--json` on anything worth parsing


## Quick start

```bash
# Install (no sudo needed)
curl -fsSL https://noorm.dev/install.sh | sh

# Or via npm
npm install -g @noormdev/cli

# Bootstrap a project
cd /my/project && noorm init
```

::: tip Corporate network?
If `noorm.dev` is blocked, install from the GitHub mirror:
```bash
curl -fsSL https://raw.githubusercontent.com/noormdev/noorm/master/install.sh | sh
```
:::

Write a SQL file, then build it:

```bash
mkdir -p sql/01_tables
echo "CREATE TABLE users (id SERIAL PRIMARY KEY, name TEXT);" > sql/01_tables/001_users.sql

noorm run build
```

```
✓ Executed 1 file
```

When the schema evolves, update the SQL file **and** add a change. The file keeps describing what the schema is; the change tells existing databases how to catch up:

```bash
# Edit sql/01_tables/001_users.sql to add an email column
# Add changes/2024-01-add-email/forward.sql

noorm change ff     # fast-forward: apply pending changes
```

A fresh database skips all of that — it just runs the files:

```bash
noorm config use test
noorm run build     # fresh DB gets the current schema directly
```

**SQL files = current schema. Changes = how existing databases get there.**

Setup wizards (`config add`, `config edit`, secret management) run in the TUI — launch it with `noorm ui`. Everything else runs headless:

```bash
noorm run build             # Build the schema from SQL files
noorm change ff             # Apply all pending changes
noorm db explore --json     # Inspect the database as JSON
noorm vault set API_KEY ... # Push a team secret to the encrypted vault
```


## Plan it before you build it

Most schemas get designed while they are being built, one migration at a time, and nobody outside the code can see the shape until it is already in production.

[ignatius](/modeling/) is the planning half. Describe your entities and processes in markdown and it renders an IDEF1X entity diagram, a searchable data dictionary, and SSADM data flow diagrams that show how data moves between people, the database, caches, files, and paper. Export it to a single HTML file, get agreement from the people who care, then hand the same markdown to your agent as the specification for the SQL.

```bash
curl -fsSL https://raw.githubusercontent.com/noormdev/ignatius/main/install.sh | sh
ignatius serve ./models -o
```

ignatius decides what the data is. noorm builds it. Both keep the source of truth in files you own. See [Information modeling](/modeling/).


## Next steps

<div class="next-steps">

[**Installation**](/getting-started/installation)
Get noorm installed and running.

[**First Build**](/getting-started/first-build)
Complete the tutorial and see the core value.

[**Building Your SDK**](/getting-started/building-your-sdk)
Create a type-safe database package for your apps.

[**Information Modeling**](/modeling/)
Design the data model before you write the schema.

</div>
