---
entity: group_posts
group: content
pk:
  - post_id
columns:
  post_id:
    type: integer
    desc: "The basetype's key, whole. That is what makes this a subtype rather than a child."
  group_id:
    type: integer
    desc: "A real foreign key to a real table, which polymorphism cannot give you."
examples:
  - post_id: 1
    group_id: 1
relationships:
  - target: posts
    on:
      post_id: post_id
    predicate: { fwd: is realized as, rev: is a }
  - target: groups
    on:
      group_id: group_id
    predicate: { fwd: publishes, rev: is publishes by }
---

# group_posts

A [[posts]] belonging to a [[groups]] row. Its key is the basetype's key.
