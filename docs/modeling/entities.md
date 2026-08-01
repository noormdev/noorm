---
title: Entities and key inheritance
description: The ignatius entity format, what the tool derives from your key shape, and why IDEF1X key inheritance is the premise the whole tool is built on.
---

# Entities and key inheritance


IDEF1X is the premise ignatius is built on. In IDEF1X an entity is defined by how it is identified, and identity flows down through relationships: a child that depends on a parent carries the parent's key inside its own. That single idea decides the cardinality of an edge, whether the edge is identifying, and how the entity gets classified. ignatius implements that premise directly. You describe the key shape, and the notation follows.

You can still model an ORM-style schema where every table has one surrogate `id`. ignatius draws that correctly too. It is not what the tool optimizes for.

::: tip Modeling IDEF1X with an agent
IDEF1X is a methodology, not a file format. The calls it asks you to make (what counts as an entity, where identity comes from, which relationships are identifying) are the ones no tool can make for you.

If you want an agent reasoning in those terms alongside you, there is a separate [`idef1x` skill](https://www.skills.sh/damusix/skills/idef1x) that installs with the same `skills` CLI as the modeling skill:

```bash
npx skills add https://github.com/damusix/skills --skill idef1x
```

It advises on method. The [`noorm-modeling` skill](/modeling/modeling-skill) writes the files. Neither is required to use ignatius, and the rest of this page assumes neither.
:::


## The folder format


A folder is a model root when it contains an `ignatius.yml` file. Five top-level folders are recognized, and everything else at the root is left alone.

```
models/
    ignatius.yml
    data/
        identity/
            Party.md
            Person.md
            Business.md
        transactional/
            SalesInvoice.md
            SI_Line.md
    groups/
        identity.md
        transactional.md
    externals/          # optional, shared DFD externals
    stores/             # optional, shared non-db DFD stores
    flows/              # optional, data flow diagrams
    notes/              # free-form, never scanned
```

Entities live under `data/`. The subdirectory is organizational convenience only: an entity's group comes from its `group:` frontmatter field, not from the folder it sits in. `groups/` is optional, and a model with no groups parses without error.

`ignatius.yml` marks the root and carries display config. The minimum is one line.

```yaml
name: My Schema
```

Add `version`, `description`, and `updated` for model metadata, a `theme` block to override colors and spacing, and a `branding` block for a logo, title, or copyright line. The model is yours, and the default chrome is a placeholder you are meant to replace. See [Branding your model](/modeling/branding).


## An entity file


Frontmatter carries the structure. The body is free-form documentation. The attribute table you see in the viewer is generated from the frontmatter, so do not write one in the body.

```markdown
---
entity: SalesInvoice
group: transactional
pk:
    - party_id
    - sales_invoice_id
columns:
    party_id:
        type: integer
        desc: "Billed party, foreign key to Party."
    sales_invoice_id:
        type: integer
        desc: "Identifier of the invoice within the party."
    issued_at:
        type: datetime
        desc: "Timestamp the invoice was issued."
        default: now
    total:
        type: decimal
        desc: "Invoice total; reconciles to the sum of its line items."
examples:
    - party_id: 2
      sales_invoice_id: 5001
      issued_at: "2024-03-05T14:25:00Z"
      total: 138.00
relationships:
    - target: Party
      on:
          party_id: party_id
      predicate: { fwd: owes on, rev: is owed by }
---

# SalesInvoice

A **SalesInvoice** is a bill issued to a [[Party]] for amounts owed. It is the
demand for payment, the document a `Payment` is ultimately applied against,
line by line.
```

Note what is absent: no `classification`, no per-edge `identifying`, no `cardinality`. ignatius derives all three.


### Columns


Each column takes a logical `type` and three optional fields.

| Field | Default | Meaning |
|---|---|---|
| `type` | required | One of `text`, `integer`, `decimal`, `boolean`, `date`, `datetime`, `binary` |
| `nullable` | `false` | Whether the column accepts null |
| `default` | none | A default value note |
| `desc` | none | A short note on what the column is for |

The types are logical, not physical. ignatius models information, so it does not care whether your `text` becomes `VARCHAR(255)` or `TEXT`. That decision belongs in the SQL files noorm runs.


### Relationships


A relationship names a `target` entity and maps foreign-key columns with `on: { child_column: parent_column }`. The `predicate` labels the edge in the graph and the dictionary.

```yaml
relationships:
    - target: Party
      on:
          party_id: party_id
      predicate: is a
```

A predicate can carry both reading directions with `{ fwd, rev }`, so the edge reads correctly whichever way you traverse it.


#### Lazy predicates and real ones


In IDEF1X, entities are nouns and relationships are verbs. The predicate is where that verb goes, and it is the part of the model a tool cannot derive for you. Everything else on the edge comes from the keys.

`has many`, `belongs to`, and `has one` are the reflex answers, and they are all restatements of something already on the diagram. "Party has many SalesOrders" tells you the cardinality the crow's-foot marker is already showing. It says nothing about the business. The relationship exists because a party **places** orders, and that is the fact the schema is there to record.

| Lazy | What it restates | What the business actually says |
|---|---|---|
| `belongs to` | the foreign key | `is placed by`, `is owed by`, `is part of` |
| `has many` | the cardinality marker | `contains`, `journals`, `is broken down into` |
| `has one` | the key shape | `is realized as`, `is settled via` |

The replacements are not synonyms for the lazy versions. `contains` and `is part of` assert composition, that the child is a constituent of the parent rather than merely pointing at it. `is sold via` and `is realized as` assert that one thing is the concrete form another takes. Those are different claims about the world, and picking between them is modeling work.


#### The sentence has to ring true


Read the relationship aloud as a sentence, in both directions. If it is not something a person who runs the business would say, and nod at, then either the predicate is wrong or the relationship is.

This is the cheapest correctness check in the model, and it catches things no structural rule can. A predicate you cannot phrase truthfully is usually a relationship that does not belong, or an entity whose purpose you have not settled. When the sentence does ring true, it *is* the business case for the entity carrying it: the reason that table exists, stated in one line, in the language of the people who asked for it.

The reference model reads like this in both directions:

| Relationship | Forward, parent to child | Reverse, child to parent |
|---|---|---|
| `SI_Line → SalesInvoice` | SalesInvoice **contains** SI_Line | SI_Line **is part of** SalesInvoice |
| `SalesOrder → Party` | Party **places** SalesOrder | SalesOrder **is placed by** Party |
| `SalesInvoice → Party` | Party **owes on** SalesInvoice | SalesInvoice **is owed by** Party |
| `Business → Party` | Party **is realized as** Business | Business **is a** Party |
| `SOL_Subscription → Subscription` | Subscription **is sold via** SOL_Subscription | SOL_Subscription **sells** Subscription |

Read the whole diagram with predicates like those and it narrates the business. Read it with `has many` everywhere and it narrates the foreign keys, which you could have got from the DDL.


#### Both directions are authored, neither is derived


`fwd` reads parent to child. `rev` reads child to parent. ignatius does not invent one from the other, because English does not work that way: the inverse of "is realized as" is "is a", not "is realized as by".

```yaml
relationships:
    - target: Identity
      on:
          party_id: party_id
      predicate: { fwd: is realized as, rev: is a }
```

A plain string sets both directions to the same phrase, which is fine when one reading works both ways (`is a`) and is the right first move when you have not settled the reverse yet.

```yaml
predicate: is a
```

Supply only one key of the object form and the other defaults to empty.

The graph draws edges parent to child and labels them with the forward predicate, so the label matches the direction of the line. Hover an entity and every edge touching it re-reads outward from that entity: edges where it is the child flip to the reverse predicate, and edges where it is the parent stay forward. The dictionary, which has no hover, shows the forward predicate and appends the reverse in a muted style when the two differ.

One thing worth carrying past the diagram: once a relationship has a real verb, the foreign key can take its name. A column named for the sentence documents itself, and the schema, the dictionary, and the application code end up speaking the same language as the people who asked for the feature.


### Example rows


An entity can carry sample instances in `examples:`, a list of row objects keyed by column name.

```yaml
examples:
    - party_id: 1
      type: BUSINESS
    - party_id: 2
      type: PERSON
```

They render as a collapsible table in the entity dialog and the dictionary. Two or three realistic rows are enough. Their job is to make the rules concrete: a sample row that violates a constraint you believe in reveals a modeling error that no structural check can find. Every key must be a real column or PK column, and the live server flags unknown keys with an `entity.example_unknown_column` warning.


### Linking entities in prose


Double brackets in the body become links.

```markdown
A **Person** is the specialization of a [[Party]] that is a natural human.
A customer settles invoices with a [[PaymentMethod|payment method]] on file.
```

`[[Party]]` links to Party and displays "Party". `[[PaymentMethod|payment method]]` links to PaymentMethod and displays "payment method". In the graph the link opens that entity's dialog; in the dictionary it jumps to its section. The target must match an entity id exactly, case-sensitive. A link to an entity that does not exist renders as muted, non-clickable text and is reported as a `body.unknown_link` finding, so a typo never passes silently.


## Key inheritance in practice


Here is the pattern the tool is shaped around, taken from the reference model that ships with ignatius.

```
Party          pk: party_id
SalesInvoice   pk: party_id, sales_invoice_id
SI_Line        pk: party_id, sales_invoice_id, line_seq
```

`SalesInvoice` does not get an independent `invoice_id`. It inherits `party_id` from `Party` and adds its own discriminator. `SI_Line` inherits both and adds a line sequence. Every line item carries its full lineage in its own identity, so the owning party is available without a join, and a line item that belongs to the wrong invoice is not expressible.

Three things fall out of that automatically:

- The edge from `SalesInvoice` to `Party` is **identifying**, because the foreign-key column sits inside the child's primary key.
- The cardinality is **one-to-many**, because the child has primary-key columns beyond the foreign key.
- `SalesInvoice` classifies as **dependent**, because it has exactly one identifying parent.

None of that was declared. Changing the key shape changes all three on the next reload.


## What gets derived


### Cardinality


Cardinality comes from the primary-key layout, the relationship type, and foreign-key nullability. There is no `cardinality` field.

- An identifying edge where the child's primary key equals the foreign key exactly is one-to-one.
- A child with primary-key columns beyond the foreign key is one-to-many.
- A nullable foreign key makes the parent side optional.

An edge is identifying when its foreign-key columns are part of the child's primary key. That too comes from the key shape, never from a per-edge flag.


### Classification


Classification comes from how an entity connects to others, applied in this order.

1. **Classifier**, flagged as a reference or classifier entity.
2. **Subtype**, a member of another entity's subtype cluster.
3. **Associative**, two or more identifying parents.
4. **Dependent**, exactly one identifying parent.
5. **Independent**, none of the above.

Classification sets the node shape, so the diagram reflects structure rather than a label you maintain. If a file declares a `classification` that contradicts the derived one, the validator surfaces the mismatch instead of trusting the label.


### Subtype clusters


A basetype declares its members in `subtypes:`, with a discriminator mapping per member.

```yaml
subtypes:
    - exclusive: true
      desc: Every Party is exactly one of Business or Person
      members:
          Business:
              type: PartyType.code.BUSINESS
          Person:
              type: PartyType.code.PERSON
```

Clusters render with diamond joiners between the basetype and its members. An exclusive cluster shows an X in the diamond and needs a discriminator column saying which subtype a basetype row is. An inclusive cluster leaves the diamond empty and needs no discriminator, because several subtypes can coexist for the same row. An exclusive cluster with no discriminator raises `cluster.no_discriminator`.


## Lineage: how key inheritance pays off in the viewer


A key-inherited entity shares its primary-key ancestry with a whole family. Selecting one should surface the family, and ignatius does that with a lineage spotlight: dotted lines in the dictionary and dotted inferred-upstream rays in the graph.

The rule is precise. A **key edge** is one whose child-side foreign-key columns are all contained in the child's primary key. That is a subset test, not an equality test, which is what makes it correct for both cases:

- A subtype member pointing at its basetype, where the foreign key equals the full primary key.
- `SalesInvoice → Party`, where `party_id` is a proper subset of `{party_id, sales_invoice_id}`. This is the identifying one-to-many case, and an equality test would miss it.

An entity's lineage is the transitive connected component of that entity in the graph of key edges only, traversed in both directions. Secondary foreign keys are excluded. A classifier reference like `Party → PartyType` is a real relationship but not a shared-key ancestry, so it never pulls an unrelated entity into the spotlight.

Subtype clusters fall out for free, since every member-to-basetype relationship is itself a key edge.

The practical effect: select `SSN` in the reference model and the spotlight reaches `SalesInvoice`, `SI_Line`, `SalesOrder`, `SO_Line`, and `PaymentAllocation`, because all of them carry `party_id` inside a larger key. That is the family that moves together when the identity spine changes. On an all-surrogate schema the same feature has nothing to show, because nothing shares a key.


## The two key conventions


A model can use either convention, and can mix them per entity. The modeling skill detects which one a model uses from the shape of its existing entities rather than asking you to pick a mode.

| Convention | Primary key shape | Foreign key placement |
|---|---|---|
| `key-inherited` | Composite: the parent's primary-key columns plus a local discriminator | Foreign-key columns live inside the child's primary key |
| `orm-oriented` | A single surrogate `id`, typically integer or uuid | Foreign-key columns sit outside the primary key as plain columns |

ignatius ships three variants of the same data model to compare directly: `key-inherited`, `orm-hybrid`, and `orm-pure`. Serving each in turn is the fastest way to see what the convention costs and buys, because the entities and the business meaning are held constant while only the keys change.

Mixing is legitimate. A transactional spine can inherit keys while a lookup table keeps a surrogate code. Do it deliberately rather than by accident, and record the reason in the entity body.


## Groups


A group is a markdown file in `groups/` with a label and a color in frontmatter and a description in the body.

```markdown
---
label: Identity & Accounts
color: "#2ea043"
---

Party identity, classifications, and ID documents.
```

Groups set a border color and a pastel fill for their entities. They do not affect layout. An entity whose `group` names a file that does not exist renders without a color band and raises an `entity.unknown_group` warning.


## Related


- [Data flows](/modeling/data-flows) puts these entities to work as data stores in process diagrams.
- [The case for proper relational design](/guide/relational-design) makes the argument for inherited keys in the database itself.
- The [`idef1x` skill](https://www.skills.sh/damusix/skills/idef1x) coaches an agent through the methodology itself, separately from ignatius.
- The [derivation guide](https://github.com/noormdev/ignatius/blob/main/docs/guides/derivation.md) and the [folder format reference](https://github.com/noormdev/ignatius/blob/main/docs/guides/folder-format.md) carry the exhaustive rules.
