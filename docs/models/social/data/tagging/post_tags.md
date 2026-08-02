---
entity: post_tags
group: tagging
pk:
  - tag_id
columns:
  tag_id:
    type: integer
    desc: "The basetype's key, whole. That is what makes this a subtype rather than a child."
  post_id:
    type: integer
    desc: "A real foreign key to a real table, which polymorphism cannot give you."
examples:
  - tag_id: 1
    post_id: 1
relationships:
  - target: tags
    on:
      tag_id: tag_id
    predicate: { fwd: is realized as, rev: is a }
  - target: posts
    on:
      post_id: post_id
    predicate: { fwd: labels, rev: is labels by }
---

# post_tags

A [[tags]] belonging to a [[posts]] row. Its key is the basetype's key.
