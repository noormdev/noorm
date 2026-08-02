---
entity: todo_items
group: core
pk:
  - user_id
  - created_at
  - item_index
columns:
  user_id:
    type: integer
    desc: "Inherited from users, two levels up. Still part of this row's identity."
  created_at:
    type: datetime
    desc: "Inherited from todos. Names which list this item belongs to."
  item_index:
    type: integer
    desc: "Local discriminator. Position within its own list."
  body:
    type: text
    desc: "The task."
  done:
    type: boolean
    default: "false"
    desc: "Whether it has been completed."
examples:
  - user_id: 1
    created_at: "2026-03-01T10:00:00Z"
    item_index: 1
    body: Oat milk
    done: true
  - user_id: 1
    created_at: "2026-03-01T10:00:00Z"
    item_index: 2
    body: Coffee
    done: false
  - user_id: 2
    created_at: "2026-03-02T08:05:00Z"
    item_index: 1
    body: Tomatoes
    done: false
relationships:
  - target: todos
    on:
      user_id: user_id
      created_at: created_at
    predicate: { fwd: contains, rev: is part of }
---

# todo_items

An item on a [[todos]] list, and the entity that makes the argument.

Its key is `user_id, created_at, item_index`: the whole ancestry, plus one local discriminator. Read the example rows and the lineage is visible without a join. `user_id` is right there on every row, two levels down from where it was introduced.

That is the property the surrogate-key version gives up. With `todo_item_id` referencing `todo_id` referencing `user_id`, answering "whose item is this?" costs two joins, and nothing in the schema stops an item from being attached to a list that belongs to someone else.
