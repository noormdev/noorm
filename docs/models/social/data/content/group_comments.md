---
entity: group_comments
group: content
pk:
  - comment_id
columns:
  comment_id:
    type: integer
    desc: "The basetype's key, whole. That is what makes this a subtype rather than a child."
  group_id:
    type: integer
    desc: "A real foreign key to a real table, which polymorphism cannot give you."
examples:
  - comment_id: 1
    group_id: 1
relationships:
  - target: comments
    on:
      comment_id: comment_id
    predicate: { fwd: is realized as, rev: is a }
  - target: groups
    on:
      group_id: group_id
    predicate: { fwd: is left on, rev: is is by }
---

# group_comments

A [[comments]] belonging to a [[groups]] row. Its key is the basetype's key.
