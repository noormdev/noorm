---
title: Why noorm
description: noorm is the fifth attempt at one problem. Here is the problem, and the questions that kept making the tool bigger.
---

# Why noorm


I stopped using ORMs and needed something to run the SQL.

That is the whole origin. noorm is the fifth attempt at it. Earlier versions were built on oclif, then cmd-ts, then minimist, and each one got retired the same way: I asked it a question it could not answer.

The questions arrived roughly in this order.

**How do I run SQL?** The easy part, and the reason the first version existed. A directory of files and something to execute them in order.

**How do I undo it?** A change has to be reversible the first time you get one wrong on a database that matters. Forward and revert stop being optional somewhere around the second week.

**How do I test it?** Not against mocks. Against a real database, with guards that stop a test suite from pointing at the wrong one.

**What if a file has to differ per environment?** Templates, so one file renders differently for dev and production instead of forking into two files that drift.

**Where does the connection configuration live?** Not scattered across `.env` files that each machine has a slightly different copy of.

**How do I seed data?** And then: how do I move it between databases, in foreign-key order, across dialects.

**How do I get a fresh environment that matches?** Build the whole schema from files in seconds, so a new database and a new hire cost the same thing.

**Where do the secrets go?** Encrypted, shared with the team, and readable at runtime so an app can reload its configuration without anyone committing a password.

**How do I deploy a change and know staging and production actually match?** Checksums, an applied-change history, and every command scriptable with JSON output.

None of that was designed up front. It was excavated. Every feature in noorm exists because working without an ORM was worse without it.


## Then LLMs arrived


The constraint changed. Writing SQL stopped being the slow part, so the slow part became reviewing SQL that an agent wrote quickly and confidently and sometimes wrongly.

That pushed the tool in three directions at once.

**Safeguards**, so a confident mistake cannot reach production: per-channel [access roles](/guide/environments/configs#access-roles), dry runs, checksums, and a typed confirmation on anything destructive.

**Guidance**, so an agent writes code that matches the conventions here instead of guessing at them. That is what the [agent skill](/getting-started/installation) is for.

**Planning**, because the cheapest moment to catch a bad schema is before it exists.

That last one turned into a separate tool. See [Information modeling](/modeling/).


## Where to start


<div class="next-steps">

[**Installation**](/getting-started/installation)
Get noorm installed and running.

[**Concepts**](/getting-started/concepts)
How SQL files and changes divide the work.

[**Information modeling**](/modeling/)
Design the data model before you write the schema.

</div>
