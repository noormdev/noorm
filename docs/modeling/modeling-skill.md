---
title: The modeling skill
description: /ignatius-modeling authors ignatius entities and data flow diagrams through guided Q&A in Claude Code, and verifies each file with ignatius validate.
---

# The modeling skill


`/ignatius-modeling` is a Claude Code skill that authors a model through question and answer, then checks its own work. It writes one entity, a data flow diagram, a fresh model skeleton, or a full discovery session that works the model out from how your business runs.

The skill exists because the hard part of modeling is not the YAML. It is knowing which questions to ask, in which order, and noticing when an answer contradicts an earlier one. The skill carries that interview structure, and you supply the domain knowledge.

**Prerequisites:** Claude Code with skill support, and the `ignatius` binary on your `$PATH` or built locally with `bun run build:cli`.


## Install


```bash
npx skills add https://github.com/noormdev/ignatius --skill ignatius-modeling
```

That adds `ignatius-modeling` to the current project's `.claude/skills/`. Add `-g` to install it globally for every project on the machine. Reload skills in Claude Code and `/ignatius-modeling` becomes available.


## Modes


| Invocation | What it does |
|---|---|
| `/ignatius-modeling entity` | Interactive Q&A to author one entity file |
| `/ignatius-modeling model` | Bootstrap a new model skeleton: `ignatius.yml`, group files, directories |
| `/ignatius-modeling flow` | Interactive Q&A to author a [data flow diagram](/modeling/data-flows) |
| `/ignatius-modeling discover` | Socratic interview that works the model out from how your business runs, generating entities and flows |
| `/ignatius-modeling` | Prompts you to choose a mode |


## Choosing between flow and discover


`flow` and `discover` are two doors into the same artifacts.

Pick `flow` when you can already name your processes. It walks the structure step by step: processes as verbs, externals, the decision between a `db:` store and a `kind:` store, the data each flow carries, sample rows, and the business narrative.

Pick `discover` when you know what the business does but have not decomposed it yet. The skill interviews you in plain language, derives the entities your processes require, writes those first, then writes the flows that reference them. When a real system already exists, whether a database, a schema dump, a codebase, or an API, `discover` reads it instead of interviewing you and then walks you through the judgment calls it cannot infer. To point it at a live database, see [Reverse-engineering an existing database](/modeling/reverse-engineering).

Both modes always produce example data. Every entity gets sample rows and every process gets input and output tables, because concrete instances expose wrong rules that pass every structural check.


## Convention detection


The skill works out which key convention a model uses from the shape of its existing entities rather than asking you to choose a mode up front, and a model can mix both styles per entity.

| Convention | Primary key shape | Foreign key placement |
|---|---|---|
| `key-inherited` | Composite: parent primary-key columns plus a local discriminator | Inside the child's primary key |
| `orm-oriented` | A single surrogate `id`, typically integer or uuid | Outside the primary key, as plain columns |

You never set `classification` or `identifying` by hand in either convention. The parser derives both from the key shape you describe. See [what gets derived](/modeling/entities#what-gets-derived).


## The verification loop


After writing each file the skill runs `ignatius validate <model-root>` and parses the findings from stderr. Findings are reported with fix hints, and you can ask the skill to revise and re-run, up to five attempts. A clean run with no findings confirms the file is valid.

This is the part that makes agent-authored models trustworthy. The skill is not asked to be right on the first try. It is asked to converge against a linter that checks unknown targets, dangling foreign-key columns, missing discriminators, unknown columns in flow contracts, and unbalanced decompositions.


## From model to schema


A validated model is a specification, and the same markdown a stakeholder reviewed is what the agent reads to build.

Once the model is agreed, point Claude Code at the model root and ask it to write the SQL. The entity files carry the keys, the columns, the relationships, and the prose explaining what each one is for, which is more context than a schema request usually gets. From there, [noorm](/getting-started/installation) takes over: SQL files in directories, `noorm run build` to build a fresh database, and changes for existing ones.

The division of labor is worth stating plainly. ignatius owns the decision about what the data is. noorm owns building and versioning it. Neither tool reaches into the other's job, and both keep the source of truth in files you own.


## Related


- [Entities and key inheritance](/modeling/entities) for the format the skill writes.
- [Data flows](/modeling/data-flows) for the diagram format.
- [Best practices](/modeling/best-practices) for how to review what the skill produces.
