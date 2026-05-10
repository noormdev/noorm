---
layout: home

hero:
  name: noorm
  text: "Write SQL. Skip the ORM."
  tagline: "Define your schema as files. Deploy it to any environment."
  actions:
    - theme: brand
      text: "Get started  →"
      link: /getting-started/installation
    - theme: alt
      text: View on GitHub
      link: https://github.com/noormdev/noorm

features:
  - icon:
      src: /icons/fast-forward.svg
    title: Current Schema, Always
    details: SQL files define the schema as it exists today. Fresh databases build in seconds from these files. Existing databases get there through changes.
  - icon:
      src: /icons/database.svg
    title: Full Relational SQL
    details: Compound keys, check constraints, triggers, stored procedures. You write whatever SQL your database supports.
  - icon:
      src: /icons/toolbox.svg
    title: Built-in Tools
    details: Schema explorer, SQL terminal, dynamic templates, encrypted secrets. One CLI replaces five browser tabs.
  - icon:
      src: /icons/cubes.svg
    title: Type-Safe SDK
    details: "Build your API layer with domain classes: consumers for queries, producers for mutations. One package shared across services and frontends."
---


## Why noorm?

noorm is a command-line tool for SQL-first database development. You write compound keys, check constraints, triggers, stored procedures. noorm executes them, tracks what ran, and keeps environments in sync.

**What it does:**

- **SQL files** define your current schema
- **Changes** move existing databases from any state to current
- **Stages** separate dev, staging, and production configs
- **SDK** gives you type-safe programmatic access

### The Case for Proper Relational Design

ORMs push you toward a pattern: every table gets a surrogate ID, relationships happen through foreign keys, and you join your way back to find what you need. It works—until you're seven joins deep trying to figure out which user owns a deeply nested entity, and your messy left joins are adding NULL rows or creating cartesian products.

Proper relational design uses **inherited keys**. Instead of giving every entity an independent identity, child entities inherit their parent's key as part of their own.

**Example: A todo list**

```
users
  → user_id (surrogate, this is the root)

todos
  → user_id + created_at (inherits from user, no separate todo_id)

todo_items
  → user_id + created_at + item_index (inherits from todo)
```

With inherited keys, a `todo_item` carries its lineage in its identity. You don't need joins to find the user—it's right there in the key. The deeper your schema goes, the more this matters.

*Try working that into your ORM. I'll wait...*


### Furthermore: ~~Polymorphism~~ Basetype-Subtypes

ORMs love polymorphic associations: a `comments` table with `commentable_type` and `commentable_id`. Fast, flexible—and completely breaks referential integrity. Complex app logic, no foreign keys, slow and awkward statistics, and even more awkward queries.

Proper relational design solved this years ago with **basetype-subtypes**:

```
independent entities: user, group
dependent entities:   profile
basetype-subtypes:    post     → user_post, group_post
                      photo    → user_photo, group_photo, profile_photo, user_post_photo, ...
                      comment  → user_comment, group_comment, post_comment, comment_comment, ...
                      tag      → post_tag, photo_tag, comment_tag, ...
```

Each relationship gets its own table with proper constraints against its parent. A `user_post` has a foreign key to `user` and `post`. A `group_photo` has a foreign key to `group` and `photo`. No nulls, no type columns, no ambiguity.

You work with existence and non-existence—not "maybe exists" or calculate. You depend on physical existence, not hopeful logic. Statistics are straightforward. Queries are clean. The database enforces integrity at every level. Illegal states become impossible. The trade-off is more tables, but the benefit is less app logic.

You pay for bad relational design later in complexity and bugs.


## Quick Start

```bash
# Install (no sudo needed)
curl -fsSL https://noorm.dev/install.sh | sh

# Or via npm
npm install -g @noormdev/cli

# Launch the interactive TUI
noorm ui
```

> **Corporate network?** If `noorm.dev` is blocked, use the GitHub mirror:
> ```bash
> curl -fsSL https://raw.githubusercontent.com/noormdev/noorm/master/install.sh | sh
> ```

From the interactive TUI (`noorm ui`), set up your project:

1. **[i] Identity** — Set your name (for team tracking)
2. **[c] Config → [a] Add** — Create a database config
3. **[r] Run → Build** — Execute your SQL files

Or use the CLI directly. Commands run headlessly and emit structured JSON you can pipe into scripts:

```bash
noorm run build             # Build the schema from SQL files
noorm change ff             # Apply all pending changes
noorm --json db explore     # Inspect the database as JSON
noorm vault set API_KEY ... # Push a team secret to the encrypted vault
```

Wizard-only operations (`config add`, `config edit`, secret management) launch the TUI automatically. Set them up once via `noorm ui`, then run everything else from scripts.

Create your SQL files:

```bash
mkdir -p sql/01_tables
echo "CREATE TABLE users (id SERIAL PRIMARY KEY, name TEXT);" > sql/01_tables/001_users.sql
```

Build your schema:

```bash
noorm run build
```

```
✓ Executed 1 file
```

Now your schema needs to evolve. Update your SQL file AND create a change:

```bash
# Update sql/01_tables/001_users.sql (add email column)
# Create changes/2024-01-add-email/forward.sql

noorm change ff     # Fast-forward: apply pending changes
```

Need a fresh test database? Add another config and build—no changes needed:

```bash
noorm ui            # Use the wizard to add a `test` config
noorm config use test
noorm run build     # Fresh DB gets current schema directly
```

**SQL files = current schema. Changes = how to get existing databases there.**


## Next Steps

<div class="next-steps">

[**Installation**](/getting-started/installation)
Get noorm installed and running.

[**First Build**](/getting-started/first-build)
Complete the tutorial and see the core value.

[**Building Your SDK**](/getting-started/building-your-sdk)
Create a type-safe database package for your apps.

</div>
