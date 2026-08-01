---
title: Reverse-engineering an existing database
description: Point an agent at a database you already run and have it extract an ignatius model, using noorm's MCP server for read-only schema access.
---

# Reverse-engineering an existing database


Most databases worth modeling already exist. The schema is in production, the reasoning behind it left with someone two jobs ago, and the only description of it is the DDL.

You do not have to model that by hand. noorm exposes the schema to a coding agent over MCP, and the [`noorm-modeling` skill](/modeling/modeling-skill) knows how to turn what it reads into entity and flow files. Your job is to set up the access, keep it read-only, and review what comes back.

The result is an ignatius model of the system you already run: a diagram to hand to people, a dictionary of what every table is for, and a base to plan the next change against.


## Where this sits in IDEF1X


Extraction is not a detour around the methodology. It is a recognized path inside it. IDEF1X calls this the **bottom-up** approach, inferring a logical model from the physical artifacts that already exist, and the full round trip of reverse-engineer, adjust for new requirements, then forward-engineer is **re-engineering**.

The discipline is also specific about how far bottom-up gets you, which is worth knowing before you start rather than after. A *data model* describes a physical database. An *information model* describes the logical requirements a system satisfies. Reverse-engineering climbs from the first toward the second in levels:

| Level | What you get | What it is worth |
|---|---|---|
| 1 | Current-system documentation, a physical model | Guaranteed only to show what **is** |
| 2 | Application-level logical model | The requirements the system currently satisfies, with no claim about whether they are right |
| 3 | Business-level model | A basis for future design, and unreachable without the business participating directly |

An agent with schema access reaches level 1 quickly and gets a good way into level 2. It cannot reach level 3 on its own, because the information at that level was never in the database. It is in the heads of the people who run the business, and the only way out is to ask them.

The IDEF1X literature is blunt about the risk, and the warning is the reason this page ends with a review step rather than a success message: **a model of what you have is not a model of what you want.** Assumptions compound as you climb the levels, and their source is the past, mistakes included. That is also why the skill records anti-patterns instead of quietly correcting them. Faithful first, better second, with the "better" being a conversation you have afterward rather than something extraction decides for you.

The [`idef1x` skill](https://www.skills.sh/damusix/skills/idef1x) carries the methodology itself if you want an agent applying it alongside you.


## What you need

- noorm installed, with a config that connects to the database ([installation](/getting-started/installation))
- ignatius installed ([installation](/modeling/installation))
- The `noorm-modeling` skill, and optionally the noorm skill for SDK and CLI conventions
- An agent harness that speaks MCP, such as Claude Code or Cursor


## 1. Create the modeling space


A model root is any folder with an `ignatius.yml` in it. Let the skill scaffold one:

```bash
/noorm-modeling model
```

That writes `ignatius.yml`, the group files, and the directories. To do it by hand, a one-line `ignatius.yml` is a valid model root:

```bash
mkdir -p models/legacy && echo "name: Legacy Schema" > models/legacy/ignatius.yml
```

Put it in the repository whose schema it describes, so the model and the code stay in one history.


## 2. Connect noorm over MCP


noorm runs an MCP server over stdio. Generate the agent's config:

```bash
noorm mcp init                  # Claude Code, writes .mcp.json
noorm mcp init --agent cursor   # Cursor, writes .cursor/mcp.json
```

The agent picks up the server on next launch and gets two tools: `noorm_help` to list commands and `run_noorm_cmd` to execute them. The schema explorer, the SQL runner, and config management all arrive through those.

Make sure the config you want the agent reading is the active one, and that it points at the database you mean. Reverse-engineering staging when you meant production produces a confident model of the wrong thing.


## 3. Keep the config read-only


Every config carries a role per channel, `access: { user, agent }`, and the `agent` role governs what a coding agent can do regardless of whether it comes in over MCP or shells out to the `noorm` binary. noorm resolves the channel from the harness that spawned it, so an agent refused over MCP cannot route around the refusal on the command line.

| Role | What the agent can do |
|---|---|
| `viewer` | Explore schema, run read-only SQL (`SELECT`, `EXPLAIN`, `SHOW`, `DESCRIBE`) |
| `operator` | Adds `INSERT`/`UPDATE`/`DELETE`; destructive commands stay out of reach |
| `admin` | Everything, with no confirmation |
| `false` | The config is invisible on that channel |

`viewer` is all reverse-engineering needs, and it is already the default: a config that never declared `access` gets `{ user: 'admin', agent: 'viewer' }`. So this step is usually a check rather than a change. Confirm it in `noorm ui` under Config → Edit, and lower it back to `viewer` if someone raised it for other work.

Raw SQL is classified by what the statement does rather than which command asked, so an agent on `viewer` gets a `SELECT` through and a same-shaped `INSERT` denied.

::: warning Roles prevent accidents, not attacks
The `agent` role is a guardrail against a mistake, not a security boundary. It stops an agent from doing damage it never meant to do, which is the realistic failure. It does not stop one that has been talked into it: `NOORM_CHANNEL` is an environment variable, so anything able to influence the agent's instructions or its environment can reach around the role.

That is worth weighing here specifically, because reverse-engineering points an agent at a large amount of text you did not write. Table comments, column descriptions, and stored procedure bodies are all content a prompt injection can ride in on.

So for a database you care about, connect noorm with a database user that holds only `SELECT` and catalog permissions. Then the role is the second line of defense rather than the only one, and an instruction that gets past it still cannot write anything.
:::


## 4. Give the database user catalog access


The explorer reads your database's system catalogs. Which ones depends on the dialect:

| Dialect | Catalog noorm reads |
|---|---|
| PostgreSQL | `information_schema` views (`columns`, `table_constraints`, `key_column_usage`, `referential_constraints`, `parameters`) |
| MySQL | `information_schema` views (`columns`, `key_column_usage`, `referential_constraints`, `routines`, `parameters`) |
| SQL Server | `sys` catalog views (`sys.columns`, `sys.foreign_keys`, `sys.foreign_key_columns`, `sys.index_columns`) |
| SQLite | `sqlite_master` and `PRAGMA` (file access, no grants) |

This is the step that quietly ruins a model, because a permissions gap does not raise an error. It returns fewer rows.

PostgreSQL filters the information schema by privilege: "Only those tables and views are shown that the current user has access to (by way of being the owner or having some privilege)." SQL Server behaves the same way through metadata visibility, where "the visibility of metadata is limited to securables that a user either owns or on which the user has been granted some permission," and a user with no permission on a table gets an empty result set rather than a denial.

An agent reading through an under-privileged user therefore produces a model that looks finished and is silently missing tables. Grant catalog access before you start:

```sql
-- PostgreSQL: visibility follows privilege
GRANT USAGE ON SCHEMA public TO modeler;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO modeler;

-- MySQL: same idea, per schema
GRANT SELECT ON mydb.* TO 'modeler'@'%';

-- SQL Server: metadata visibility without data access
GRANT VIEW DEFINITION TO modeler;
```

Then check the count. Ask the agent, or run it yourself, for the table list noorm sees and compare it against what you know is there. A mismatch here is cheaper to catch now than after the model is written.


## 5. Ask the agent to reverse-engineer


Launch the harness and point it at both the database and the model root:

```
/noorm-modeling discover
```

`discover` interviews you when nothing exists yet. When a real system is available it reads that instead, and interviews you only about the judgment calls the schema cannot answer. Tell it where the model root is and that noorm's MCP server is connected.

Code is worth offering alongside the schema. Foreign keys give the agent your entities and relationships, but only the handlers, jobs, and stored procedures that touch the data can give it the processes for the [data flow diagrams](/modeling/data-flows). A `SELECT` inside a request handler is an input flow with a column list; an `INSERT` is an output flow. Point the agent at the repository and the flows come out at column level rather than as guesses.


## 6. What a good extraction does


The skill's method is worth knowing, because it is what you review against.

**It reads rather than invents.** Entities come from tables, attributes from columns with nullability preserved, relationships from foreign-key constraints, and subtype clusters from tables whose whole primary key equals their parent's. Whether an edge is identifying is derived from the key shape, never declared.

**It keeps the source's names.** `sales_orders` stays `sales_orders`. The entity id is what every relationship target, wiki link, and `db:` token has to match, so renaming during extraction breaks the correspondence with the real system. A rename is a decision to surface, not a cleanup to perform quietly.

**It detects your key convention instead of imposing one.** A composite primary key containing a foreign key reads as `key-inherited`; a lone surrogate `id` with foreign keys outside the key reads as `orm-oriented`. Mixed schemas stay mixed. See [the two key conventions](/modeling/entities#the-two-key-conventions).

**It records anti-patterns rather than fixing them.** Faithful first, better second. A junk-drawer table or a surrogate key where the real identity is composite gets captured as it is, then raised with you as a question. Silent improvement during extraction produces a model of a database you do not have.

**It grounds the model in real rows.** Sample data from the live system makes the best examples, which is why every entity and process should carry some. Mask anything sensitive before it lands in a file you commit.


## 7. Verify and review


```bash
ignatius validate models/legacy
ignatius serve models/legacy -o
```

`validate` exits `1` on errors and `0` otherwise, so it works as a gate. A clean run means the model is internally consistent. It does not mean the model is right, and the two failures worth hunting are ones no linter catches: a table the agent could not see, and a purpose it invented because the schema could not tell it one.

Read the entity bodies with that in mind. Any entity whose description restates its columns rather than explaining what it is for is a question the agent could not answer from the schema, and the answer is in your head or nobody's. Those paragraphs are the part of the model worth the most later, and the part only you can supply.

This is the climb from level 2 to level 3, and it is the work reverse-engineering cannot do for you. An extracted model tells you what the database is. Turning that into what the business means, and then into what it should be, takes the people who run it. Serve the model, walk them through it, and let the arguments start.


## Related


- [Entities and key inheritance](/modeling/entities)
- [Data flows](/modeling/data-flows)
- [The modeling skill](/modeling/modeling-skill)
- [MCP (AI agent integration)](/guide/automation/mcp) for the server itself
- [Access roles](/guide/environments/configs#access-roles) for channel detection and the `NOORM_CHANNEL` override
