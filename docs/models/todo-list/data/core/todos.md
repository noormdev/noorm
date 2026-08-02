---
entity: todos
group: core
pk:
  - user_id
  - created_at
columns:
  user_id:
    type: integer
    desc: "Inherited from users. Part of this entity's own identity, not a pointer to it."
  created_at:
    type: datetime
    desc: "Local discriminator. Distinguishes one list from another within the same user."
  title:
    type: text
    desc: "What the list is called."
examples:
  - user_id: 1
    created_at: "2026-03-01T10:00:00Z"
    title: Groceries
  - user_id: 1
    created_at: "2026-03-04T18:22:00Z"
    title: Sprint 14
  - user_id: 2
    created_at: "2026-03-02T08:05:00Z"
    title: Groceries
relationships:
  - target: users
    on:
      user_id: user_id
    predicate: { fwd: keeps, rev: is kept by }
---

# todos

A list belonging to a [[users]] row. There is no `todo_id`.

Identity is `user_id` plus the moment the list was created. That is what makes the relationship **identifying**: a todo cannot be identified without knowing whose it is, so the parent's key lives inside the child's.

Two users can both have a list created at the same instant, and two lists can share a title. Neither collides, because the key carries the owner.
