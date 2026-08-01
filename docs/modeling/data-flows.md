---
title: Data flows
description: SSADM data flow diagrams in ignatius. Show how processes move data between people, the database, caches, files, and paper.
---

# Data flows


An entity diagram tells you what the data is. It does not tell you who touches it, or where it rests when it is not in a table.

ignatius answers that with data flow diagrams in the SSADM style, using Gane-Sarson notation: numbered process hubs, green external boxes for actors outside the system, and open-ended `D#` boxes for stores. Flows live in the same folder as the entities, in the same markdown format, and a `db:` store in a diagram is the same entity you modeled in the graph. Click it and the full entity dialog opens, with columns, relationships, and examples.


## Why the diagram includes more than tables


The useful part of a DFD is that a data store is not required to be a database table.

A cache holds derived state. A log file holds gateway responses nobody reads until a dispute. A queue holds work in flight. A signed paper form sits in a drawer, and a PDF sits in someone's mail. All of those are places your business keeps data, and all of them are places it can go missing, go stale, or leak. Model them and the diagram shows where information lives, including the parts that never reached the database.

The same applies to people. An external entity is a source or a sink that sits outside the system boundary: a customer, a supplier, a regulator, a support agent. Drawing them makes the handoffs explicit, which is where most process defects are.

Two distinctions are worth holding onto:

- **Stores are inside the system, externals are outside it.** Both can be the source or the sink of a flow, but only a store represents state the system owns.
- **Every entity is a store, not every store is an entity.** A `db:` store resolves to a real entity in the graph. A cache, file, queue, document, or manual record is a store and nothing more.


## Folder layout


Flows live in a `flows/` folder at the model root. Each diagram is a folder, and each process is a file inside it.

```
models/
    ignatius.yml
    data/
        identity/ ...           # entities live under data/
    externals/
        Customer.md             # shared external, usable by every diagram
    stores/
        gateway-log.md          # optional description of a non-entity store
    flows/
        order-to-cash/
            Create-Sales-Order.md   # process 1
            Create-Sales-Order/     # same-named folder is the sub-diagram
                Validate-Customer.md
                Record-Order.md
            Issue-Invoice.md        # process 2
            Collect-Payment.md      # process 3
        refund/
            Process-Return.md
```

Files under `flows/` are never scanned as entities. The file name minus `.md` is the process id used everywhere: in `proc:` tokens, in wiki links, and as the sub-diagram folder name. Name it as an imperative phrase with hyphens for spaces, so `Collect Payment` becomes `Collect-Payment.md`.


## A process file


Frontmatter declares the data contract. The body explains the business. The arrows on the diagram are generated from `inputs:` and `outputs:`.

```markdown
---
process: Collect Payment
number: 3
inputs:
    - from: ext:Customer
      data: payment details
    - from: db:PaymentMethod
      data: [party_id, payment_method_id, type, label]
outputs:
    - to: db:Payment
      data: [party_id, payment_method_id, payment_id, amount]
    - to: file:gateway-log
      data: gateway transaction reference, HTTP status, raw response
    - to: ext:Customer
      data: receipt
examples:
    in:
        - from: ext:Customer
          label: payment details
          rows:
              - { card: "****4242", amount: 49.99, currency: GBP }
    out:
        - to: db:Payment
          label: settled payment record
          rows:
              - { party_id: 1001, payment_method_id: 42, payment_id: 9001, amount: 49.99 }
---

Settles an invoice by recording a [[Payment]] and allocating it against the
invoice line it pays. A receipt is returned to the [[Customer]].
```

| Field | Required | Meaning |
|---|---|---|
| `process` | yes | The human label shown on the node |
| `number` | no | Local rank among sibling processes, falling back to file order. Full SSADM numbers like `1.2.1` are composed from the folder nesting |
| `inputs` / `outputs` | yes | The flows. Each names an endpoint and the `data:` it carries |
| `examples` | no | Sample in and out rows, rendered as tables in the process dialog, one entry per flow |

The `data:` field is both the arrow's label and its contract. On a `db:` endpoint it is always column names, a string for one or a list for several, and every name is checked against the entity's `pk` and `columns` under the `flow.unknown_attribute` rule. On any other endpoint it is an opaque label, so make it enumerate what the flow carries rather than summarize it in one word.

Bodies support the same `[[Entity]]` wiki links as entity files, and can also link to processes, externals, and stores by name. Links open the target's dialog in place.


## Endpoints


Every flow connects a process to something. The token's prefix says what.

| Token | Endpoint |
|---|---|
| `db:<Entity>` | A store backed by a modeled entity. Must match an entity id exactly |
| `ext:<Name>` | An external entity, an actor outside the system boundary |
| `proc:<Name>` | Another process, used for sub-diagram boundary flows |
| `cache:` `queue:` `file:` `doc:` `manual:` `other:` | A non-entity store of that kind |

The prefix set is closed. A store that fits none of the named kinds is authored as `other:<name>`; there is no way to invent a prefix. A bare, unprefixed name resolves only when it is unambiguous across all namespaces, and otherwise raises `flow.ambiguous_endpoint` asking you to qualify it.


### Externals


Describe an external once in `externals/<Name>.md` at the model root, with an `external:` label in frontmatter and a body covering its role, what it does, and what it expects back. Every diagram at any nesting depth can then reference `ext:<Name>`. There is no per-diagram override.


### Stores


A `db:` store needs no file. It is the entity, documented in the entity's own markdown. A non-`db` store exists by being referenced, and an optional `stores/<name>.md` adds a kind, a display title, and the reason it exists.

```markdown
---
kind: file
title: Payment Gateway Log
---

Append-only log of raw gateway responses. Used for reconciliation and dispute
resolution; never read back during normal processing. Retained for 7 years.
```

The kind vocabulary is `db`, `cache`, `queue`, `file`, `doc`, `manual`, and `other`. Kind drives the node's color in the diagram, theme-aware and overridable under `theme.flowKinds` in `ignatius.yml`.

Writing that body is where the value is. "Retained for 7 years" and "never read back during normal processing" are the facts that decide whether the store is a compliance asset or a liability, and they exist nowhere in a schema.


## Sub-diagrams


A process decomposes by placing a folder with the process's exact file name next to its file. The folder holds the child diagram, with its own process files numbered locally, and full dotted numbers composed from the nesting. Decomposition recurses as deep as it needs to. There is no depth cap, and the ancestor chain is preserved at every level, so a process four layers down reads as something like `1.4.2.1`.

The child diagram must be balanced with its parent: the data crossing the sub-diagram's boundary has to match the parent process's declared inputs and outputs, column for column on `db:` flows. The `flow.unbalanced_decomposition` rule checks that at every level, which is the thing hand-drawn DFDs always get wrong once the diagram is more than one page.

In the viewer, a process with a sub-diagram renders with a stacked-shadow affordance. Clicking drills down, and a breadcrumb leads back up.


## Viewing and validating


`ignatius serve` shows flows in the Flows view at `#view=flow`. The active diagram is deep-linkable through the `dfd=` hash parameter and survives a refresh. `ignatius export` writes the Flows view into the same single HTML file as the other two views.

Every node carries an ⓘ badge. A `db:` store opens the rich entity dialog; a process, external, or non-`db` store opens its markdown. The process dictionary, meaning every process, external, and store with its body and its input and output tables, is fused into the Dictionary view and searchable alongside the entities.

Hovering an edge that carries data reveals a tooltip listing everything crossing it, under a `source → target` header. That includes the full contents of `db:` column lists which are abbreviated on the canvas when they run long. Labels over 22 characters show a truncated preview with an ellipsis, so you can always see at a glance which edges are hiding detail, and the tooltip stays legible at any zoom level.

`ignatius validate` runs eleven `flow.*` rules whenever a `flows/` directory exists, covering unknown references, column contracts, connection shape, numbering, and decomposition balance. One rule is configurable: direct process-to-process flows warn by default and can be silenced with `flow_rules: { process_to_process: false }` in `ignatius.yml`.


## Authoring with the skill


The [`noorm-modeling` skill](/modeling/modeling-skill) has two doors into flows. `/noorm-modeling flow` walks you through a diagram step by step when you can already name your processes. `/noorm-modeling discover` interviews you about how the business runs and generates both the entities and the flows. Both verify their output with `ignatius validate`.


## Related


- [Entities and key inheritance](/modeling/entities) covers the entities these diagrams reference.
- The [flows guide](https://github.com/noormdev/ignatius/blob/main/docs/guides/flows.md) and the [validation catalog](https://github.com/noormdev/ignatius/blob/main/docs/guides/validation.md) carry the exhaustive reference.
