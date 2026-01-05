---
layout: home

hero:
  name: noorm
  text: SQL defines the truth. Everything else builds on top.
  tagline: Express what ORMs can't. Compound keys, check constraints, triggers, stored procedures—real SQL.
  image:
    src: /image/0105.gif
    alt: noorm TUI demo
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
    title: No Migration Sprawl
    details: Fresh databases don't replay 3 years of history. Run your SQL files directly and get the current schema. Test databases rebuild in seconds.
  - icon:
      src: /icons/code-branch.svg
    title: See Current State
    details: SQL files show what IS, not archaeology of what WAS. Open a file, see the schema. No tracing through 200 migrations to understand a table.
  - icon:
      src: /icons/flask.svg
    title: Raw SQL Power
    details: Compound keys, complex constraints, proper relational modeling. Write the schema ORMs won't let you express.
  - icon:
      src: /icons/terminal.svg
    title: Built-in Tools
    details: Schema explorer, SQL terminal, dynamic templates, encrypted secrets. Full database management without leaving your terminal.
---


## Why noorm?

**noorm is NOT an ORM.** ORMs replace your SQL with inefficient abstractions. noorm runs your SQL directly.

Raw SQL lets you design databases properly. Inherited keys, base/subtype hierarchies, complex constraints—the relational model as it was intended.

noorm makes it manageable. SQL files define your schema. Changes evolve existing databases. Execution tracking, environment configs, encrypted secrets, team collaboration—all handled from your terminal. You focus on the SQL.

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
# Install
npm install -g @noormdev/cli

# Launch the TUI
noorm
```

From the terminal interface, set up your project:

1. **[i] Identity** — Set your name (for team tracking)
2. **[c] Config → [a] Add** — Create a database config
3. **[r] Run → Build** — Execute your SQL files

Or use headless mode for scripting:

```bash
noorm -H init
noorm -H identity set "Your Name"
noorm -H config add
noorm -H run build
```

Create your SQL files:

```bash
mkdir -p sql/01_tables
echo "CREATE TABLE users (id SERIAL PRIMARY KEY, name TEXT);" > sql/01_tables/001_users.sql
```

Build your schema:

```bash
noorm -H run build
```

```
✓ Executed 1 file
```

Now your schema needs to evolve. Update your SQL file AND create a change:

```bash
# Update sql/01_tables/001_users.sql (add email column)
# Create changes/2024-01-add-email/forward.sql

noorm -H change ff     # Fast-forward: apply pending changes
```

Need a fresh test database? Create another config and build—no changes needed:

```bash
noorm -H config add    # Create test config
noorm -H run build     # Fresh DB gets current schema directly
```

**SQL files = current schema. Changes = how to get existing databases there.**


## Next Steps

<div class="next-steps">

[**Installation**](/getting-started/installation)
Get noorm installed and running in 2 minutes.

[**First Build**](/getting-started/first-build)
Complete the 5-minute tutorial and see the core value prop.

[**Concepts**](/getting-started/concepts)
Understand the mental model behind noorm.

</div>
