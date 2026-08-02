---
entity: photo_tags
group: tagging
pk:
  - tag_id
columns:
  tag_id:
    type: integer
    desc: "The basetype's key, whole. That is what makes this a subtype rather than a child."
  target_type:
    type: text
    default: "'PHOTO'"
    desc: "Pinned to PHOTO, so the composite foreign key can only resolve to a PHOTO row."
  photo_id:
    type: integer
    desc: "A real foreign key to a real table, which polymorphism cannot give you."
examples:
  - tag_id: 1
    target_type: PHOTO
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

A [[tags]] belonging to a [[photos]] row. Its key is the basetype's key, and `target_type` is pinned so the pair can only attach to a row the basetype already marked `PHOTO`.
