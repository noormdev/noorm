---
entity: users
group: identity
pk:
  - user_id
columns:
  user_id:
    type: integer
  handle:
    type: text
examples:
  - user_id: 1
    handle: ada
---

# users

Unchanged from the relational version. The identity tables are never the problem.
