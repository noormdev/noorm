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

Independent. Nothing above it supplies identity, so a surrogate key is the right call here and nowhere else.
