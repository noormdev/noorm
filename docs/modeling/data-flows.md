---
title: Data flows
description: SSADM data flow diagrams in ignatius. Show where data comes from, including people outside the system, which process moves it, and which store keeps it, including stores that are not tables.
---

# Data flows


An entity diagram shows what the data is. A data flow diagram shows where it comes from, which process moves it, and where it rests, including the people and files that are not tables.

| Part | Answers | Endpoint token | Example |
|---|---|---|---|
| External | who sends data in or receives it, outside the system | `ext:<Name>` | `ext:Customer` |
| Process | what moves or transforms it | a file in the diagram folder, or `proc:<Name>` at a sub-diagram boundary | `Collect-Payment.md` |
| Store, entity | where it rests as a table | `db:<entity>` | `db:payment` |
| Store, other | where it rests when it is not a table | `cache:` `queue:` `file:` `doc:` `manual:` `other:` | `file:gateway-log` |

Three process files, one external, and a log file that no table holds draw this diagram:

<ModelViewer class="tall" model="order-to-cash" hash="view=flow&amp;dfd=order-to-cash" :tabs="false" label="order-to-cash data flows" title="Order-to-cash data flow diagram rendered by ignatius" />

One file declares the arrows into and out of Collect payment:

<div class="nh-file">
<div class="nh-panel-head"><span>model/flows/order-to-cash/Collect-Payment.md (excerpt)</span><span>you write this</span></div>

```markdown
---
process: Collect payment
number: 3
inputs:
  - from: ext:Customer
    label: payment
    data: card, amount
  - from: db:invoice_line
    label: open lines
    data: [party_id, invoice_no, line_no, amount]
outputs:
  - to: db:payment
    label: payment
    data: [party_id, payment_no, amount]
  - to: db:payment_allocation
    label: allocations
    data: [party_id, payment_no, invoice_no, line_no, amount]
  - to: file:gateway-log
    label: gateway response
    data: transaction reference, status, raw response
  - to: ext:Customer
    label: receipt
    data: payment number, status
---

Writes the [[payment]] and its [[payment_allocation]] rows in one transaction.
```

</div>


## What does a process file declare?


The file name minus `.md` is the process id, an imperative phrase like `Collect-Payment`. The frontmatter is the data contract and the body explains the business.

| Field | Meaning |
|---|---|
| `process` | The label on the node. Required |
| `number` | Rank among sibling processes. Without it, file order decides |
| `inputs`, `outputs` | The flows: an endpoint, a `label` for the arrow, and the `data` it carries |
| `examples` | Sample `in` and `out` rows, shown in the process dialog |

`data` is the contract. On a `db:` endpoint it is column names, and each is checked against the entity's `pk` and `columns`. On any other endpoint it is free text, so list what crosses: "transaction reference, status, raw response", not "log data".


## What do externals and non-table stores need?


An `ext:` token needs `externals/<Name>.md`, a body saying who the actor is and what it expects back. A `db:` store needs no file, because the entity is the store.

A store that is not a table exists by being referenced. An optional `stores/<name>.md` adds a `kind`, a `title`, and a body for facts no schema records:

```markdown
---
kind: file
title: Payment gateway log
---

Raw responses from the payment gateway, appended by Collect payment. Read only for reconciliation.
```

`kind` is one of `cache`, `queue`, `file`, `doc`, `manual`, or `other`. The viewer numbers stores by kind: `D1` for an entity, `F1` for a file, `C1` for a cache, and likewise `Q`, `Do`, `M`, and `O`.


## How do I break a process into smaller ones?


Put a folder named exactly like the process file, minus `.md`, next to it. The folder holds the child diagram.

```
flows/order-to-cash/
├── Place-Order.md
├── Place-Order/        the sub-diagram of Place-Order
│   ├── Validate-Customer.md
│   └── Record-Order.md
├── Issue-Invoice.md
└── Collect-Payment.md
```

Numbers compose from the nesting, with no depth limit. The child must balance with its parent: the data crossing its boundary matches the parent's inputs and outputs, column for column on `db:` flows. `flow.unbalanced_decomposition` checks every level.

ignatius also derives two diagrams you do not write: the Context diagram, with every external around one `System` box, and the overview the Flows view opens on, with one box per diagram folder. `Place order` is numbered `1.1` in the viewer because it sits in the first folder.

A folder describes itself with `description:` frontmatter in `flows/<diagram>/index.md`, which `ignatius index` leaves intact. A sub-diagram uses its process's `description`.


## How do I check it?


Press `f` in `ignatius serve` for the Flows view, and `i` for the flow index. Saving a file redraws it, and `#view=flow&dfd=order-to-cash` deep-links to a diagram. Hover an arrow to see everything crossing it.

`ignatius validate` runs the `flow.*` rules whenever `flows/` exists. Rename `payment_no` to `payment_id` in the `db:payment` output above and it warns:

```bash
ignatius validate model
```

```
warn  flow.unknown_attribute  order-to-cash/Collect-Payment  Column 'payment_id' on 'payment' not found in entity pk or columns.
✓ /home/you/shop/model: valid with 1 warning(s) across 11 entities.
```

Warnings exit `0` and errors exit `1`.


## What bites


| Mistake or symptom | Cause | Fix |
|---|---|---|
| `flow.unknown_external`, the arrows vanish | every `ext:` token needs `externals/<Name>.md` | add the file or fix the name |
| `flow.illegal_connection`, the arrow vanishes | neither end is a process, as in a store sending to an external | route it through a process |
| A process is missing, with no finding | a file without a `process:` field is skipped | add `process:` |
| A sub-diagram is ignored | the folder name differs from the process file name, or it holds no `.md` | rename it to match |


## Next


- [Entities and key inheritance](/modeling/entities): the entities these flows name
- [The modeling skill](/modeling/modeling-skill): `/ignatius-modeling flow` walks you through a diagram
- The [flows guide](https://github.com/noormdev/ignatius/blob/main/docs/guides/flows.md) covers clusters, stacks, and arrow labels
- The [validation catalog](https://github.com/noormdev/ignatius/blob/main/docs/guides/validation.md) lists every `flow.*` rule
