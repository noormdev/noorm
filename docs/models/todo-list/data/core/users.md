---
entity: users
group: core
pk:
  - user_id
columns:
  user_id:
    type: integer
    desc: "Surrogate identity. The root of the key spine, so this one is allowed to be arbitrary."
  email:
    type: text
    desc: "Login identity. Unique, but not the primary key: it changes, and keys should not."
  created_at:
    type: datetime
    desc: "When the account was opened."
examples:
  - user_id: 1
    email: ada@example.com
    created_at: "2026-01-04T09:12:00Z"
  - user_id: 2
    email: grace@example.com
    created_at: "2026-02-11T16:40:00Z"
---

# users

The root of the model, and the only entity here with an identity of its own.

A surrogate key is the right call at the root: nothing above it can supply identity, and the natural candidate (`email`) is something people change. Everything below inherits `user_id` rather than minting its own.
