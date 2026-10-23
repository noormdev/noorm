---
title: From model to SQL
description: How each field of an ignatius entity file maps to a CREATE TABLE statement, from keys and foreign keys to constraint names, types, alternate keys, and subtypes.
---

# From model to SQL

Each entity file becomes one `CREATE TABLE`. Keys, foreign keys, and constraint names come from the frontmatter. The physical type is the one decision you make per dialect.

<div class="pair">

<div class="nh-file">
<div class="nh-panel-head"><span>model/data/sales/sales_order.md</span><span>you write this</span></div>

```yaml
---
entity: sales_order
group: sales
pk: [party_id, order_no]
columns:
  party_id:  { type: integer }
  order_no:  { type: integer }
  placed_at: { type: datetime, default: now }
  status:    { type: text, default: open }
examples:
  - { party_id: 2, order_no: 1, status: invoiced }
  - { party_id: 2, order_no: 2, status: open }
  - { party_id: 1, order_no: 1, status: paid }
relationships:
  - target: party
    on: { party_id: party_id }
    predicate:
      fwd: places
      rev: is placed by
---
```

</div>

<p class="pair-joint">becomes</p>

<div class="nh-file">
<div class="nh-panel-head"><span>db/sql/01_tables/02_sales_order.sql</span><span>what noorm runs</span></div>

```sql
CREATE TABLE sales_order (
    party_id   integer     NOT NULL,
    order_no   integer     NOT NULL,
    placed_at  timestamptz NOT NULL DEFAULT now(),
    status     text        NOT NULL DEFAULT 'open',
    CONSTRAINT sales_order_pk
        PRIMARY KEY (party_id, order_no),
    CONSTRAINT sales_order_isplacedby_party
        FOREIGN KEY (party_id) REFERENCES party (party_id)
);
```

</div>

</div>


## How each field maps


| Entity file | SQL |
|---|---|
| `pk:` | `PRIMARY KEY (…)` |
| `relationships[].on` | `FOREIGN KEY (…) REFERENCES …` |
| `predicate.rev` and `target` | the constraint name, `<table>_<reverse predicate>_<target>`: `sales_order_isplacedby_party` |
| `type: datetime` | the physical type for your dialect: `timestamptz` on Postgres, `datetime2` on SQL Server, `datetime` on MySQL |
| `ak:` with a `rule` | a `UNIQUE` constraint named for the rule: rule `is identified by sku` gives `product_isidentifiedby_sku` |
| `subtypes:` | one table per member, whose primary key is the foreign key to the basetype |

The predicate is the part a tool cannot derive, so it is also the part worth reading in review. A constraint named `sales_order_isplacedby_party` states the business rule the foreign key enforces. A name like `sales_order_party_id_fkey` states only which column it sits on.


## What inherited keys buy


`payment_allocation` has two identifying parents, `payment` and `invoice_line`. Both carry `party_id`, and the table stores it once:

```sql
CREATE TABLE payment_allocation (
    party_id    integer       NOT NULL,
    payment_no  integer       NOT NULL,
    invoice_no  integer       NOT NULL,
    line_no     integer       NOT NULL,
    amount      numeric(12,2) NOT NULL,
    CONSTRAINT payment_allocation_pk
        PRIMARY KEY (party_id, payment_no, invoice_no, line_no),
    CONSTRAINT payment_allocation_isdrawnfrom_payment
        FOREIGN KEY (party_id, payment_no)
        REFERENCES payment (party_id, payment_no),
    CONSTRAINT payment_allocation_settles_invoice_line
        FOREIGN KEY (party_id, invoice_no, line_no)
        REFERENCES invoice_line (party_id, invoice_no, line_no)
);
```

A payment from party 1 cannot settle an invoice line of party 2: the single `party_id` column would have to hold both values. Two foreign keys enforce it, with no trigger and no application check. The model's entry for `payment_allocation` shows both parents in its key, and the classification ignatius derived from that shape:

<ModelViewer class="tall" model="order-to-cash" hash="view=graph&amp;entity=payment_allocation" :tabs="false" label="payment_allocation in the model" title="Order-to-cash model with payment_allocation selected" />


## Check the model before you write the SQL


```bash
ignatius validate model/
```

```
✓ /home/you/shop/model: valid — 11 entities, no findings.
```

`validate` exits `1` when the model has errors and `0` otherwise, so it gates a pull request as it stands. The [full rule catalog](https://github.com/noormdev/ignatius/blob/main/docs/guides/validation.md) lists every check.

Next: [Reverse-engineering an existing database](/modeling/reverse-engineering)
