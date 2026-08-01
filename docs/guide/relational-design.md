---
title: The case for proper relational design
description: Why inherited keys and basetype-subtypes beat the surrogate-ID-everywhere pattern ORMs push you toward.
---

# The case for proper relational design


noorm does not stop you from designing a database the way an ORM would. It just stops making that the only option you can reach. This page explains what you get back once the tool is out of the way.


## Inherited keys

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


## ~~Polymorphism~~ Basetype-subtypes

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


## What this requires from a tool

Both patterns need things ORM-shaped migration tools make hard:

- **Compound primary keys** that you declare, not ones the tool derives from a single ID column.
- **Many more tables** than a naive design, which means execution order matters and has to be explicit.
- **Constraints, triggers, and procedures** as first-class schema objects, not escape-hatch raw SQL bolted onto a migration.

noorm gives you all three because it never parses your SQL into an object model. Your files are the schema. See [SQL File Organization](/guide/sql-files/organization) for how execution order works, and [Concepts](/getting-started/concepts) for how files and changes divide the work.
