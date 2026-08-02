---
entity: profiles
group: identity
pk:
  - user_id
columns:
  user_id:
    type: integer
  bio:
    type: text
examples:
  - user_id: 1
    bio: Keys should migrate, not point.
relationships:
  - target: users
    on:
      user_id: user_id
    predicate: { fwd: is described by, rev: describes }
---

# profiles

The only real foreign key left in this design, and only because a profile happens to belong to exactly one kind of thing.

Every other association below wanted to point at more than one kind, so it gave up pointing at all.
