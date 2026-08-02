---
entity: profiles
group: identity
pk:
  - user_id
columns:
  user_id:
    type: integer
    desc: "The user's key, whole. A profile has no identity of its own."
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

Dependent. Its key *is* the user's key, so a profile cannot exist without one and cannot be moved to another.
