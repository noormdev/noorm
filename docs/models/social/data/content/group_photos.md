---
entity: group_photos
group: content
pk:
  - photo_id
columns:
  photo_id:
    type: integer
    desc: "The basetype's key, whole. That is what makes this a subtype rather than a child."
  group_id:
    type: integer
    desc: "A real foreign key to a real table, which polymorphism cannot give you."
examples:
  - photo_id: 1
    group_id: 1
relationships:
  - target: photos
    on:
      photo_id: photo_id
    predicate: { fwd: is realized as, rev: is a }
  - target: groups
    on:
      group_id: group_id
    predicate: { fwd: hosts, rev: is hosts by }
---

# group_photos

A [[photos]] belonging to a [[groups]] row. Its key is the basetype's key.
