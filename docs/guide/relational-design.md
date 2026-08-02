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

```sql
CREATE TABLE users (
    user_id     serial      PRIMARY KEY,
    email       text        NOT NULL UNIQUE,
    created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE todos (
    user_id     int         NOT NULL REFERENCES users (user_id),
    created_at  timestamptz NOT NULL,
    title       text        NOT NULL,

    PRIMARY KEY (user_id, created_at)
);

CREATE TABLE todo_items (
    user_id     int         NOT NULL,
    created_at  timestamptz NOT NULL,
    item_index  int         NOT NULL,
    body        text        NOT NULL,
    done        boolean     NOT NULL DEFAULT false,

    PRIMARY KEY (user_id, created_at, item_index),
    FOREIGN KEY (user_id, created_at) REFERENCES todos (user_id, created_at)
);
```

No `todo_id`, no `todo_item_id`. A todo is identified by whose it is and when it was made; an item by which list it sits on and where in that list.

Two things follow, and neither costs any application code.

`todo_items` carries `user_id` on every row, two levels down from where it was introduced. Finding the owner of an item is a column read, not a join.

The composite foreign key `(user_id, created_at)` makes cross-tenant corruption unrepresentable. An item cannot reference a list belonging to a different user, because the `user_id` in the item's own key has to match the one in the list's key. Compare the surrogate version:

```sql
-- The ORM shape. todo_id alone says nothing about who owns the list.
CREATE TABLE todo_items (
    todo_item_id serial PRIMARY KEY,
    todo_id      int    NOT NULL REFERENCES todos (todo_id),
    body         text   NOT NULL
);
```

Here `todo_id` points at a list, and nothing in the schema relates that list to a user. Every query that needs the owner joins for it, and every write that must not cross tenants is guarded in application code you have to remember to write.

*Try working that into your ORM. I'll wait...*


### What that model looks like

The diagram below is generated from the schema above, not drawn. It is a live [ignatius](/modeling/) export: click an entity for its columns, sample rows, and prose.

<div class="model-embed">
<iframe src="/models/todo-list.html" title="Inherited keys: users, todos, todo_items" loading="lazy"></iframe>
</div>

Note the two node shapes. `users` is square because nothing above it supplies its identity. `todos` and `todo_items` are rounded because they cannot be identified without their parent. Nobody labelled those. ignatius derived them from the key shape, which is the same information the `PRIMARY KEY` clauses above carry.

The hash marks on each edge mean the relationship is **identifying**: the parent's key is inside the child's, so the child depends on it for identity rather than merely pointing at it.


## ~~Polymorphism~~ Basetype-subtypes

ORMs love polymorphic associations: a `comments` table with `commentable_type` and `commentable_id`. Fast, flexible—and completely breaks referential integrity. Complex app logic, no foreign keys, slow and awkward statistics, and even more awkward queries.

Here is the shape they push you toward:

```sql
-- No foreign key is possible here: the table this
-- points at changes from row to row.
CREATE TABLE comments (
    comment_id       serial PRIMARY KEY,
    -- 'Post', 'Photo', 'Comment', …
    commentable_type text   NOT NULL,
    -- references nothing at all
    commentable_id   int    NOT NULL,
    body             text   NOT NULL
);
```

`commentable_id` is an integer the database has no opinion about. Point it at a row that was deleted, or at a `Photo` id while `commentable_type` says `Post`, and nothing objects. Counting comments per post means filtering on a string first.

Modelled out, the whole domain looks like this:

<div class="model-embed">
<iframe src="/models/polymorphic.html" title="Polymorphic associations: the same domain in seven tables" loading="lazy"></iframe>
</div>

Seven tables and one edge. `profiles` points at `users`, because a profile belongs to exactly one kind of thing and so was allowed to keep a foreign key. Everything else wanted to point at more than one kind, so it gave up pointing at all: `posts`, `photos`, `comments` and `tags` float unconnected, holding a type string and an integer nobody checks.

That is the diagram the ORM shape produces. Compare it with the one at the end of this section.

Proper relational design solved this years ago with **basetype-subtypes**:

```
independent entities: user, group
dependent entities:   profile
basetype-subtypes:    post     → user_post, group_post
                      photo    → user_photo, group_photo, profile_photo, user_post_photo, ...
                      comment  → user_comment, group_comment, post_comment, comment_comment, ...
                      tag      → post_tag, photo_tag, comment_tag, ...
```

That is the honest version of the trade. Polymorphism looks cheaper because it never makes you write this list down: one `comments` table absorbs every case, and the count of things you are actually modelling stays hidden in a string column. Here the count is on the page. Photo alone fans out four ways.

More tables, and every one of them is a real constraint instead of a convention. The mechanism is the same for each, so here is one cluster in full:

```sql
CREATE TABLE posts (
    post_id    serial      PRIMARY KEY,
    owner_type text        NOT NULL CHECK (owner_type IN ('USER', 'GROUP')),
    body       text        NOT NULL,
    posted_at  timestamptz NOT NULL DEFAULT now(),

    -- The discriminator has to be reachable by a
    -- foreign key, so it joins a key of its own.
    UNIQUE (post_id, owner_type)
);

CREATE TABLE user_posts (
    post_id    int  PRIMARY KEY,
    owner_type text NOT NULL DEFAULT 'USER' CHECK (owner_type = 'USER'),
    user_id    int  NOT NULL REFERENCES users (user_id),

    FOREIGN KEY (post_id, owner_type) REFERENCES posts (post_id, owner_type)
);

CREATE TABLE group_posts (
    post_id    int  PRIMARY KEY,
    owner_type text NOT NULL DEFAULT 'GROUP' CHECK (owner_type = 'GROUP'),
    group_id   int  NOT NULL REFERENCES groups (group_id),

    FOREIGN KEY (post_id, owner_type) REFERENCES posts (post_id, owner_type)
);
```

Read the last two tables together and the exclusivity is structural. `user_posts.owner_type` is pinned to `USER`, `group_posts.owner_type` to `GROUP`, and both carry it into the composite foreign key back to `posts`. A post the basetype marked `USER` therefore *cannot* accept a `group_posts` row. Not "should not". Cannot.

`user_id` and `group_id` are real foreign keys to real tables, which is precisely what the polymorphic version gives up. Counting a group's posts is a join, not a join plus a string comparison.

Repeat that for photo, comment and tag and you get the list above. It is more tables than the polymorphic version, and that is the whole trade: the tables are where the rules live, so they are not also living in application code you have to keep correct.

Each relationship gets its own table with proper constraints against its parent. A `user_post` has a foreign key to `user` and `post`. A `group_photo` has a foreign key to `group` and `photo`. No nulls, no type columns, no ambiguity.

You work with existence and non-existence—not "maybe exists" or calculate. You depend on physical existence, not hopeful logic. Statistics are straightforward. Queries are clean. The database enforces integrity at every level. Illegal states become impossible. The trade-off is more tables, but the benefit is less app logic.


### What that model looks like

<div class="model-embed tall">
<iframe src="/models/social.html" title="Basetype-subtypes: the full social graph" loading="lazy"></iframe>
</div>

All twenty entities, exactly as listed above. Four diamonds, one per cluster, each with an X marking it **exclusive**: a post is one or the other, never both. ignatius reads that from the structure rather than a label.

Solid lines run to a basetype, dashed ones to an owner. Dashed means non-identifying, so a photo's subject is a fact *about* it rather than part of what identifies it.

The point of seeing it whole is the edge count. Every line is a foreign key the database enforces.

Scroll back to the polymorphic diagram and the difference is not a matter of taste. Twenty entities bound by constraints, against seven that float. Fewer tables did not remove the relationships. It removed the database's knowledge of them, and moved every one into code you have to write, test, and keep correct.



## Metrics, and the truth at 1M rows

The usual claim is that polymorphism is slower. Here is a metric both designs have to answer, on a real database, so we can stop guessing.

**Comments per group, across every group.** Polymorphic:

```sql
SELECT p.owner_id AS group_id, count(*) AS comments
FROM posts p
JOIN comments c
  ON  c.commentable_id   = p.post_id
  AND c.commentable_type = 'POST'
WHERE p.owner_type = 'GROUP'
GROUP BY p.owner_id
ORDER BY comments DESC
LIMIT 10;
```

Two string comparisons before any counting starts, and the join predicate has to carry the type or it silently counts photos as posts. Basetype-subtypes:

```sql
SELECT gp.group_id, count(*) AS comments
FROM group_posts gp
JOIN post_comments pc ON pc.post_id = gp.post_id
GROUP BY gp.group_id
ORDER BY comments DESC
LIMIT 10;
```

No type filter anywhere. `group_posts` is already only group posts, `post_comments` is already only comments on posts. The tables did the filtering when the rows were written.


### What the numbers actually say

PostgreSQL 17, 1,000,000 posts and 5,000,000 comments, both designs indexed equivalently, best of three runs.

Answering the metric above, one join:

| | Polymorphic | Basetype-subtypes |
|---|---|---|
| Time | 149.9 ms | 134.6 ms |
| Pages read from disk | 7,852 | 5,022 |

Close enough that nobody should pick a schema over it.

Now add a hop. Comments on a group's posts, plus the tags on those comments:

```sql
-- Polymorphic. Every hop re-states its type filter.
SELECT p.owner_id, count(DISTINCT c.comment_id) AS comments, count(t.tag_id) AS tags
FROM posts p
JOIN comments c ON c.commentable_id = p.post_id  AND c.commentable_type = 'POST'
LEFT JOIN tags t ON t.target_id     = c.comment_id AND t.target_type   = 'COMMENT'
WHERE p.owner_type = 'GROUP'
GROUP BY p.owner_id;
```

```sql
-- Basetype-subtypes. No type filter anywhere.
SELECT gp.group_id, count(DISTINCT pc.comment_id) AS comments, count(ct.tag_id) AS tags
FROM group_posts gp
JOIN post_comments pc ON pc.post_id    = gp.post_id
LEFT JOIN comment_tags ct ON ct.comment_id = pc.comment_id
GROUP BY gp.group_id;
```

| | Polymorphic | Basetype-subtypes |
|---|---|---|
| Time | 638.2 ms | 452.7 ms |
| Pages read from disk | **47,765** | **4,638** |

That is the number to look at. Adding one hop took the polymorphic query from 7,852 pages to 47,765, a six-fold jump. The same hop left the relational query flat, 5,022 to 4,638.

The reason is mechanical. Every polymorphic join has to re-derive the same fact at read time: sift a large shared table for the fraction of rows that are the right *kind*. Two hops means doing that twice, over five million comments and two million tags, and the intermediate results are large enough that both designs spill to temp files.

The subtype version never sifts anything. `post_comments` is already only comments on posts. `comment_tags` is already only tags on comments. Each join lands on a table that is exactly the rows wanted, because the write path sorted that out once instead of every query sorting it out again.

That cost is per hop, so a third or fourth join pays it again while the subtype side does not. Only the two measurements above were taken; the rest follows from where the work happens.

Two caveats. The relational design uses **more** disk, 803 MB against the polymorphic 638 MB, because more tables mean more indexes and inherited keys are stored more than once. And on wall clock the two-hop gap is 1.4x, not 10x, because this data still mostly fits in cache. The read counts are what tell you which way that goes when it stops fitting.


### The part that has no benchmark

Delete a post that has comments.

```sql
DELETE FROM posts WHERE post_id = 2;
```

Polymorphic: `DELETE 1`. It works. The comment now points at a post that does not exist, and the metric still reports **1,000,000** post comments, exactly as before. The number is wrong and nothing anywhere says so.

Basetype-subtypes: the database refuses.

```
ERROR: update or delete on table "posts" violates foreign key
constraint "group_posts_post_id_owner_type_fkey"
```

You can find the orphans in the polymorphic design. It costs an anti-join across all five million comments, 154 ms here:

```sql
SELECT count(*) FROM comments c
WHERE c.commentable_type = 'POST'
  AND NOT EXISTS (SELECT 1 FROM posts p WHERE p.post_id = c.commentable_id);
```

But you have to know to ask, on every polymorphic column, forever, and the answer only tells you about damage already done. That query is not one your product needs. It is rent.

So you spend more disk and get back two things: queries whose cost grows more slowly as they get deeper, and the guarantee that the number on the dashboard is true. The polymorphic version spends less disk and pays for it per query, per hop, and in the reconciliation jobs it obliges you to write.

You pay for bad relational design later, in complexity and bugs. Sometimes you pay for it in metrics nobody knew to distrust.


## What this requires from a tool

Both patterns need things ORM-shaped migration tools make hard:

- **Compound primary keys** that you declare, not ones the tool derives from a single ID column.
- **Many more tables** than a naive design, which means execution order matters and has to be explicit.
- **Constraints, triggers, and procedures** as first-class schema objects, not escape-hatch raw SQL bolted onto a migration.

noorm gives you all three because it never parses your SQL into an object model. Your files are the schema. See [SQL File Organization](/guide/sql-files/organization) for how execution order works, and [Concepts](/getting-started/concepts) for how files and changes divide the work.
