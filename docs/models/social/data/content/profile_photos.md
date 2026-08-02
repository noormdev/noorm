---
entity: profile_photos
group: content
pk:
  - photo_id
columns:
  photo_id:
    type: integer
    desc: "The basetype's key, whole. That is what makes this a subtype rather than a child."
  subject_type:
    type: text
    default: "'PROFILE'"
    desc: "Pinned to PROFILE, so the composite foreign key can only resolve to a PROFILE row."
  user_id:
    type: integer
    desc: "A real foreign key to a real table, which polymorphism cannot give you."
examples:
  - photo_id: 1
    subject_type: PROFILE
    user_id: 1
relationships:
  - target: photos
    on:
      photo_id: photo_id
    predicate: { fwd: is realized as, rev: is a }
  - target: profiles
    on:
      user_id: user_id
    predicate: { fwd: illustrates, rev: is illustrates by }
---

# profile_photos

A [[photos]] belonging to a [[profiles]] row. Its key is the basetype's key, and `subject_type` is pinned so the pair can only attach to a row the basetype already marked `PROFILE`.
