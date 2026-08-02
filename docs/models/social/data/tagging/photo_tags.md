---
entity: photo_tags
group: tagging
pk:
  - tag_id
columns:
  tag_id:
    type: integer
    desc: "The basetype's key, whole. That is what makes this a subtype rather than a child."
  photo_id:
    type: integer
    desc: "A real foreign key to a real table, which polymorphism cannot give you."
examples:
  - tag_id: 1
    photo_id: 1
relationships:
  - target: tags
    on:
      tag_id: tag_id
    predicate: { fwd: is realized as, rev: is a }
  - target: photos
    on:
      photo_id: photo_id
    predicate: { fwd: labels, rev: is labels by }
---

# photo_tags

A [[tags]] belonging to a [[photos]] row. Its key is the basetype's key.
