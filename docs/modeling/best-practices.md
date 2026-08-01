---
title: Modeling best practices
description: How to produce an ignatius model that survives a stakeholder review and is worth handing to an agent as a specification.
---

# Modeling best practices


A model earns its keep when someone who does not write SQL can read it, disagree with it, and be right. These are the habits that get you there.


## Model the decision, not the storage


The question a model answers is what the data is and how it is identified. Column types are logical for that reason: `text`, `integer`, `decimal`, `boolean`, `date`, `datetime`, `binary`. Whether a column becomes `VARCHAR(255)` or `TEXT`, which index it gets, and how it partitions are build-time decisions that belong in the SQL files noorm runs.

Keeping those out of the model is what makes it reviewable by the people whose sign-off you need.


## Write the body


The frontmatter is the structure. The body is the reason the entity exists, and it is the part of the model that a schema dump can never give you.

Say what the thing is in business terms, what it is not, and what rule made you draw the boundary where you did. The reference model's `Party` entity explains why customers, vendors, and employees are one entity rather than three: a company that is both a customer and a vendor should not have two identities, and a person who becomes a customer after being an employee keeps one record. That paragraph is what a stakeholder argues with. The column list is not.

Link related entities in prose with `[[Entity]]`. A wiki link that points at a nonexistent entity renders muted and raises `body.unknown_link`, so the prose stays honest as the model changes.


## Always include examples


Add two or three realistic rows to every entity and input and output tables to every process. The modeling skill does this by default, and it is worth keeping when you author by hand.

Structural validation cannot catch a wrong rule, only a broken reference. Concrete instances can. Write the rows for a case you believe is legal, and if one of them looks wrong when you read it back, the rule is wrong. This is the cheapest modeling test that exists, and it is the one that finds the errors that survive to production.


## Let derivation do its job


Do not declare `classification`, `identifying`, or cardinality. Describe the primary key, the columns, and the `on:` mapping, and let ignatius work out the rest.

Two reasons. The derived answer stays correct when the key shape changes, and a hand-written label does not. And when a declared classification contradicts the derived one, the validator reports the mismatch rather than trusting you, which means a label you set by hand is at best redundant and at worst a finding to clean up later.


## Choose a key convention on purpose


Decide whether an entity inherits its parent's key or carries a surrogate `id`, and be able to say why.

Inherited keys carry lineage in the identity, so a child cannot be attached to the wrong parent and the owning party is available without a join. They also make the lineage spotlight useful, since the feature works on shared-key families and has nothing to show on an all-surrogate schema. Surrogate keys are simpler to write and fit reference tables that nothing depends on for identity.

Mixing conventions per entity is supported and often correct: a transactional spine that inherits keys alongside lookup tables that do not. Record the reason in the entity body so the next reader sees a decision instead of an inconsistency.

When a team disagrees about this, serve the three reference variants that ship with ignatius (`key-inherited`, `orm-hybrid`, `orm-pure`) and compare them directly. They model the same business with the same entities, so the only variable is the keys.


## Name processes as verbs


A process transforms data. `Collect-Payment`, `Issue-Invoice`, and `Validate-Customer` read as work. A noun like `Payment-Handler` describes a component, and components belong in an architecture diagram rather than a DFD.

The file name minus `.md` becomes the process id used in `proc:` tokens, wiki links, and the sub-diagram folder name, so pick it once and pick it well.


## Enumerate what a flow carries


On a `db:` endpoint the `data:` field is a column list, validated against the entity's keys and columns. On any other endpoint it is free text, and free text is where flows go vague.

Write "gateway transaction reference, HTTP status, raw response" rather than "log data". The label is the contract for what crosses that arrow, and a reviewer can only catch a missing field if the field would have been named. Anything long is truncated on the canvas with an ellipsis and shown in full on hover, so a thorough label costs you nothing visually.


## Model the stores that are not tables


The caches, log files, queues, exported spreadsheets, signed forms, and PDFs are where the surprises live. They hold data nobody versioned, nobody backed up, and nobody remembered when the retention policy was written.

Give each one a `stores/<name>.md` with its kind and a body explaining why it exists, what is written to it, and what happens to it over time. "Append-only log of raw gateway responses, never read back during normal processing, retained for 7 years" is a compliance fact that exists in no schema and in no codebase.


## Decompose only where it earns it


A sub-diagram is a folder named exactly after its parent process, and it must stay balanced with that parent: the data crossing its boundary has to match the parent's declared inputs and outputs, column for column on `db:` flows. `flow.unbalanced_decomposition` enforces that at every level.

That check is a feature, and it is also a cost. Decompose a process when the detail changes a decision, not to show completeness. Two levels that stay balanced beat four that drift.


## Keep validate clean


`ignatius validate` exits `1` on errors and `0` otherwise, and warnings alone do not fail it. Run it while authoring and wire it into CI next to your other checks.

Treat warnings as a queue rather than noise. `entity.unknown_group`, `cluster.no_discriminator`, and `flow.unknown_attribute` each name a real gap: a group file you never wrote, an exclusive cluster with no way to tell its subtypes apart, a flow promising a column the entity does not have. The model that fails a review is usually the one that accumulated twenty warnings nobody read.

The `models/broken-demo` folder in the ignatius repo is deliberately broken to exercise every rule, which makes it a fast way to learn what each finding looks like before you meet it on your own model.


## Review before you build


Export the model and put it in front of someone.

```bash
ignatius export ./models -o model.html
```

One self-contained HTML file with the graph, the dictionary, and the flows, working offline with nothing installed. Attach it to the ticket, mail it to the stakeholder, or commit it beside the model.

Put your own name on it first. The default logo, title, and copyright line are placeholders, and a document going to a client or an approver should carry your organization rather than the tool's. See [Branding your model](/modeling/branding).

This is the step the whole tool exists for. A wrong entity boundary costs a conversation now and a migration later. Get the disagreement out of people before the schema is real, then hand the agreed model to your agent as the specification for the SQL.


## Keep the model next to the code


Commit the model folder in the repository whose schema it describes. It diffs cleanly, so a schema change and its model change land in one reviewable commit, and the prose explaining why gets reviewed alongside the DDL.

A model that lives in a wiki or a drawing tool drifts within a quarter. One that lives in the repo and gates CI does not.


## A model that follows all of this


Reading a finished model beats reading rules about one. [`models/llm-memory-db-mssql`](https://github.com/noormdev/ignatius/tree/main/models/llm-memory-db-mssql) in the ignatius repo is the memory database an AI coding agent writes to, and it is the model in the [demo recording](/modeling/#information-modeling).

```bash
git clone https://github.com/noormdev/ignatius.git
ignatius serve ignatius/models/llm-memory-db-mssql -o
```

It runs 38 entities across 8 groups, 27 processes in 6 diagrams, and one external actor, and `ignatius validate` reports no findings. Things worth looking at while it is open:

- **Every entity and every process carries examples.** All 38 and all 27, with no exceptions, which is what the practice above asks for and what most models skip first.
- **The key conventions are mixed on purpose.** `Agent` and `Artifact` are surrogate roots, while `Milestone` → `Task` (`milestone_id, task_no`) → `Task_Artifact` (`milestone_id, task_no, artifact_id`) inherits the whole way down. The transactional spine inherits; the things with independent identity do not.
- **Classification is visible, not declared.** Reference tables, associatives like `Memory_Tag`, and the `StateTransition` subtype cluster all get their shape from their keys.
- **The bodies carry business rules.** `Agent` explains why rows default `agent_id` to a sentinel: memories written before an agent existed, or after one is deleted, stay intact instead of being orphaned. No schema records that.

Two practices it does not exercise, because the domain has no occasion for them: it has no non-`db` stores and no sub-diagrams. For those, read [`models/key-inherited`](https://github.com/noormdev/ignatius/tree/main/models/key-inherited), which validates clean at 24 entities and has both a `file:` store with a retention policy in its body and a decomposed process with a balanced child diagram.


## Related


- [Entities and key inheritance](/modeling/entities)
- [Data flows](/modeling/data-flows)
- [The modeling skill](/modeling/modeling-skill)
