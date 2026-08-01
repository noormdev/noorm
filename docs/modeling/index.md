---
title: Information modeling
description: Plan the data model before you build it. ignatius turns a folder of markdown into an IDEF1X entity diagram, a searchable data dictionary, and SSADM data flow diagrams.
---

# Information modeling


Most schemas get designed while they are being built. A table appears because a feature needed it, a column gets added because a bug needed it, and the shape of the whole thing only exists in the migration history and in the head of whoever wrote it. By the time anyone can see the model, it is already in production and expensive to change.

[ignatius](https://github.com/noormdev/ignatius) moves that work earlier. It is a planning tool for information modeling: you describe entities, keys, and relationships in markdown files, and it renders them as an interactive diagram you can hand to another person. The binary never connects to a database and never generates DDL. Its output is a picture of what you intend to build, precise enough to argue about before anyone writes SQL.

<!-- Wrapped in a div because `video` is not a CommonMark block-level tag:
     left bare, markdown-it splits the multi-line element across paragraphs and
     Vue's SFC parser then rejects the orphaned closing tag. -->
<div class="demo-video">
<video src="/video/ignatius.mp4" poster="/video/ignatius-poster.jpg" width="1316" height="858" controls muted playsinline preload="none"></video>
</div>

Above: a model of an LLM memory database, walked through all three views. The entity dialog, the searchable dictionary with its key-inheritance lineage, and a decomposed process flow where an external LLM agent creates and files artifacts.


## What it produces


One folder of markdown files drives three views of the same model.

| View | What it shows |
|---|---|
| Data Graph | An IDEF1X entity-relationship diagram in crow's-foot notation. Pan, zoom, click an entity to open its full definition. |
| Data Dictionary | Every entity, process, external, and store in one searchable reference page. |
| Data Flows | SSADM data flow diagrams showing how processes move data between people, the database, and everything else. |

The diagrams are generated, never drawn. You write the structure as text, and ignatius derives the cardinality, the entity classification, and the subtype clusters from the key shape you described. Change a foreign key and the notation updates on the next reload. A model that lives in markdown diffs like code, reviews like code, and cannot drift from a picture somebody drew once in a diagramming app.


## Why a web instead of a list


A table list tells you what exists. It does not tell you how anything connects, or why any of it is there.

The graph gives you the web: which entities hang off which, where identity comes from, which clusters are subtypes of a common basetype. Each entity carries a prose body explaining what it is and what business function it serves, so the answer to "why does this table exist" lives next to the table. Each entity also carries example rows. Two or three realistic instances make the rules concrete, and a sample row that violates a constraint you believed in reveals a modeling error no structural check will catch.

You make better decisions with a full view of the thing you are about to build. That is the whole argument for doing this before the schema exists rather than after.


## Written for people and for models


The source is markdown with YAML frontmatter, which suits both readers.

A stakeholder gets the rendered app: a diagram they can explore, a dictionary they can search, and prose that explains the business meaning rather than the storage layout. `ignatius export` writes all three views into one self-contained HTML file with no external dependencies, so a reviewer opens it from `file://` and needs nothing installed.

A coding agent gets plain text it can read and write directly. ignatius comes with the [`noorm-modeling` skill](/modeling/modeling-skill) for Claude Code, which authors entity and flow files through guided Q&A and verifies each one with `ignatius validate` before moving on.


## The workflow


Model first, get agreement, then build.

1. **Model.** Describe the entities and the processes in markdown, either by hand or through the modeling skill.
2. **Review.** Serve the model or export it to HTML and walk stakeholders through the graph and the flows. Arguments about the shape of the data are cheap here and expensive later.
3. **Build.** Once the model is agreed, hand it to your agent as the specification. The files that describe the model are the same files the LLM reads to write the schema.

noorm is the other half of that last step. ignatius describes what you intend to build. noorm builds it, versions it, and keeps every environment in sync. The two share a bias: your schema belongs in files you own, not in an object model a tool derived for you.


## Why a separate tool


noorm already explores schemas and runs SQL, so it is fair to ask why modeling is a second binary instead of a `noorm model` subcommand. Three reasons, and they all come back to ignatius being useful at a moment when noorm is not.

**It never touches a database.** ignatius carries no driver and emits no DDL. Its value is being usable before the database exists, which is exactly the moment a tool that requires a connection has nothing to offer. Putting the planning step inside noorm would gate it behind the thing you have not built yet.

**It does not need noorm.** Nothing in the format is noorm-specific: markdown in, IDEF1X and SSADM diagrams out, with no dialect anywhere in the pipeline. A team on Prisma, ActiveRecord, or hand-written migrations gets the same thing from it. Making it a subcommand would shrink its audience to noorm users and buy nothing.

**The audiences differ.** `ignatius export` produces a file for the person approving a design, not the person deploying a schema. That reader is not going to install a schema and change manager to look at a diagram.

There is a practical consequence worth knowing as you read: the two ship on their own cadences from their own repositories. That is why these pages carry the narrative and link out to the ignatius repo for the exhaustive rule catalogs rather than copying them here, where they would drift out of date.


## Two notations, two questions


ignatius answers a different question in each of its diagram views.

**IDEF1X** answers "what is the data, and how is it identified". It is the premise the entity side is built on, which is why key inheritance gets first-class treatment: identifying relationships, compound keys that carry their lineage, and subtype clusters with exclusive or inclusive discriminators. See [Entities and key inheritance](/modeling/entities).

**SSADM data flow diagrams** answer "who touches the data, and where does it live". Processes, external actors, and data stores. Stores are not only tables. A cache, a log file, a queue, a paper form, and a document all appear as first-class stores, so the diagram shows where data rests rather than only the part of it that reached a database. See [Data flows](/modeling/data-flows).


## Next steps


<div class="next-steps">

[**Installation**](/modeling/installation)
Install the binary and the modeling skill.

[**Entities and key inheritance**](/modeling/entities)
The entity format, what gets derived, and the two key conventions.

[**Data flows**](/modeling/data-flows)
Processes, externals, stores, and sub-diagrams.

[**Reverse-engineering**](/modeling/reverse-engineering)
Extract a model from a database you already run.

[**Best practices**](/modeling/best-practices)
How to get a model worth showing to a stakeholder.

</div>
