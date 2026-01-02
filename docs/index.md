---
layout: home

hero:
  name: noorm
  text: You write the SQL. It handles the rest.
  tagline: Schema management that knows what changed, runs only what's needed, and stays out of your way.
  actions:
    - theme: brand
      text: Get Started
      link: /getting-started/installation
    - theme: alt
      text: View on GitHub
      link: https://github.com/noormdev/noorm

features:
  - icon:
      src: /icons/bolt.svg
    title: Change Detection
    details: Modify a file, run build. Only the changed files execute. Checksums track what ran—no more guessing or re-running everything.
  - icon:
      src: /icons/code-branch.svg
    title: SQL Templates
    details: Dynamic SQL with Eta. Pull in config values, secrets, helper functions. Generate schema variations without duplicating files.
  - icon:
      src: /icons/flask.svg
    title: Schema Explorer
    details: Browse tables, views, indexes, foreign keys. See column types, constraints, row counts. All from your terminal.
  - icon:
      src: /icons/terminal.svg
    title: Query Terminal
    details: Interactive SQL REPL built in. Run ad-hoc queries, see formatted results, browse history. No separate database client needed.
---


## Why noorm?

**noorm is NOT an ORM.** ORMs replace your SQL with abstractions. noorm runs your SQL and tracks the results.

You write `.sql` files. noorm knows which ones changed, executes them in order, and remembers what ran. That's it.


## Quick Start

```bash
# Install
npm install -g noorm

# Initialize a project
noorm init

# Create your first SQL file
echo "CREATE TABLE users (id SERIAL PRIMARY KEY, name TEXT);" > sql/tables/users.sql

# Build it
noorm run build
```

```
✓ Executed 1 file
✓ Skipped 0 (unchanged)
```

Change the file and run again—noorm detects the change automatically.


## Two Ways to Work


### Terminal UI

Launch `noorm` for a full terminal interface. Navigate with keyboard shortcuts, manage configs, run migrations, explore your schema.

```
┌─────────────────────────────────────────┐
│  noorm                          v1.0.0  │
├─────────────────────────────────────────┤
│  [c] config     [g] changes    [r] run  │
│  [d] database   [l] lock       [s] set  │
│  [k] secrets    [i] identity   [q] quit │
└─────────────────────────────────────────┘
```

[TUI Quick Reference →](/tui)


### Headless Mode

For CI/CD pipelines and automation. JSON output, environment variable configuration, zero interaction required.

```bash
# In your CI pipeline
noorm -H run build
noorm -H --json change ff
```

[Headless Reference →](/headless)


## What You Can Do


### Build Your Schema

```bash
noorm run build        # Execute all schema files
noorm run build        # Run again—nothing changed, nothing executes
# edit a file...
noorm run build        # Only the changed file runs
```


### Use Templates

Generate dynamic SQL with config values, secrets, or computed data:

```sql
-- sql/tables/users.sql.tmpl
CREATE TABLE <%= $.config.prefix %>_users (
    id SERIAL PRIMARY KEY,
    name VARCHAR(<%= $.maxNameLength || 255 %>)
);
```


### Explore Your Database

```
┌─ Schema Overview ─────────────────────────┐
│  Tables: 12    Views: 3    Indexes: 8     │
│  Functions: 2  Procedures: 0              │
└───────────────────────────────────────────┘

Press [t] to browse tables, [v] for views...
```


### Run Queries

Built-in SQL terminal. No need for a separate database client.

```
noorm> SELECT * FROM users LIMIT 5;
┌────┬─────────┬───────────────────┐
│ id │ name    │ created_at        │
├────┼─────────┼───────────────────┤
│ 1  │ Alice   │ 2024-01-15 09:30  │
│ 2  │ Bob     │ 2024-01-16 14:22  │
└────┴─────────┴───────────────────┘
```


### Manage Migrations

Versioned changes with forward and revert scripts:

```bash
noorm change ff              # Apply all pending migrations
noorm change revert 2024-01  # Roll back a specific change
noorm change history         # See what ran and when
```


## Next Steps

<div class="next-steps">

[**Installation**](/getting-started/installation)
Get noorm installed and running in 2 minutes.

[**First Build**](/getting-started/first-build)
Complete the 5-minute tutorial and see the core value prop.

[**Concepts**](/getting-started/concepts)
Understand the mental model behind noorm.

</div>
