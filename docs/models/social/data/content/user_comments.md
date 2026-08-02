---
entity: user_comments
group: content
pk:
  - comment_id
columns:
  comment_id:
    type: integer
    desc: "The basetype's key, whole. That is what makes this a subtype rather than a child."
  target_type:
    type: text
    default: "'USER'"
    desc: "Pinned to USER, so the composite foreign key can only resolve to a USER row."
  user_id:
    type: integer
    desc: "A real foreign key to a real table, which polymorphism cannot give you."
examples:
  - comment_id: 1
    target_type: USER
    user_id: 1
relationships:
  - target: comments
    on:
      comment_id: comment_id
    predicate: { fwd: is realized as, rev: is a }
  - target: users
    on:
      user_id: user_id
    predicate: { fwd: is left on, rev: is is by }
---

# user_comments

A [[comments]] belonging to a [[users]] row. Its key is the basetype's key, and `target_type` is pinned so the pair can only attach to a row the basetype already marked `USER`.
