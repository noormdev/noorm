---
title: Why noorm
description: noorm is the fifth attempt at one problem. Here is the problem, the CLIs that came before, and the questions that kept making the tool bigger.
---

# Why noorm


I stopped using ORMs and needed something to run the SQL.

That is the whole origin. Everything else in noorm arrived as an answer to a question I hit while working without one.


## The tools that came first


noorm is the fifth attempt. The first three were about the interface, and each one replaced the last because I needed something more robust: **minimist** first, then **cmd-ts**, then **oclif**. The bar kept rising. I wanted a CLI that was discoverable by someone being onboarded, easy to use without a manual, and easy to keep building on.

Then I scrapped all of it and moved to **citty** and **@clack/prompts**, which fit what noorm actually does far better than any of the three.

Around the same time I was experimenting with terminal interfaces and tried **Ink**. Testing it against the CLI settled something. Running commands means remembering commands. A screen that shows you your configs, your pending changes, and your schema while you decide is a better workflow than typing a verb and hoping you got the flags right, because the decision needs data in front of it and a CLI gives you none.

That produced the split noorm still has. Anything interactive lives in the [TUI](/tui): setup wizards, config editing, secrets, browsing the schema. Anything automatable lives in the [CLI](/headless), where it belongs, so the same operations run headless in CI with JSON output.


## The questions that kept arriving


None of this was designed up front. It was excavated. Each row is a question I could not answer with what I had at the time.

| Question | What it became |
|---|---|
| How do I run SQL? | A directory of files, executed in order |
| How do I undo one? | Forward and revert pairs, tracked per change |
| How do I test against it? | A real database with safety guards, not mocks |
| How do I express what DDL makes painful? | Templates that render SQL from YAML |
| How do I seed data? | Templates again, plus transfer between databases |
| Where does connection configuration live? | Configs you can export and hand to a teammate |
| How do I onboard someone onto four environments? | Stages, with required and optional variables |
| Where do team secrets live? | An encrypted vault table inside the database |
| What ran, by whom, and why did it break? | History that records the operator and the error |
| How do I re-run the idempotent objects? | Manifests |

Three of those are worth more than a table row.


### Templates are not just per-environment strings


Rendering one file differently for dev and production is the obvious use. It was not the reason.

Templates exist so seed data can be expressed and iterated on, and so YAML can become DDL that is miserable to write by hand. SQL Server's scheduled jobs are the clearest case: expressing a schedule semantically and rendering it into the DDL that creates the job beats hand-writing that DDL every time. The same goes for roles and permissions across stored procedures and views. A YAML list of who gets what is readable and diffable. The forty `GRANT` statements it renders into are neither.

So the templating layer is where iteration happens, and SQL is the output rather than the source you maintain.


### History records why, not just what


Every applied change is recorded with its status, when it ran, **who ran it**, and the **error message** if it failed. That last one is the part even ORMs skip.

It matters when a change fails, you fix it, and you run it again. Something that broke during the failed attempt may not surface for days. A history with the actual error lets you trace back to which run went wrong instead of guessing. Recording the operator means a pattern of failures has a name attached to it.

The reason for a change almost never gets written down anywhere. That is what `changelog.md` in the change folder is for: the justification, next to the SQL it justifies.

**Manifests** handle the objects that are meant to be re-run. Views, functions, stored procedures, and the templates that generate crons or permissions are all idempotent, so a manifest lists them and the change re-runs them. The point is that fixing a stored procedure stops being something that happens in a SQL editor at 11pm and starts being a tracked change like any other.


### Configuration is something you hand to someone


A config is exportable. Export uses X25519 key exchange with AES-256-GCM, and credentials are deliberately left out, so the recipient supplies their own username and password on import. You can export local dev, local test, staging, and production, send all four, and the other person fills in only the parts that are theirs.

**Stages** make that prescriptive. Rather than describing your environments in a README, you define them once, and everyone gets the same shape with the details left blank. A stage declares its variables as required or optional, and a build fails with a clear error when a required one is missing instead of rendering something half-formed. Configs are typed `local` or `remote`, which is the distinction that decides how careful the tool should be. Losing a local dev database costs nothing. Production is a different question, which is what [access roles](/guide/environments/configs#access-roles) gate.

**The vault** covers what stages cannot: secrets the whole team needs. Those live encrypted in the database itself, in `noorm.vault` where the dialect has schemas and a `__noorm_vault__` table where it does not, so they distribute automatically rather than over Slack. They sit lowest in the precedence chain, so a local override always wins.


## The Arrival of LLMs


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
