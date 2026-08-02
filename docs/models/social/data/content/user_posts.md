---
entity: user_posts
group: content
pk:
  - post_id
columns:
  post_id:
    type: integer
    desc: "The basetype's key, whole. That is what makes this a subtype rather than a child."
  owner_type:
    type: text
    default: "'USER'"
    desc: "Pinned to USER, so the composite foreign key can only resolve to a USER row."
  user_id:
    type: integer
    desc: "A real foreign key to a real table, which polymorphism cannot give you."
examples:
  - post_id: 1
    owner_type: USER
    user_id: 1
relationships:
  - target: posts
    on:
      post_id: post_id
    predicate: { fwd: is realized as, rev: is a }
  - target: users
    on:
      user_id: user_id
    predicate: { fwd: authors, rev: is authors by }
---

# user_posts

A [[posts]] belonging to a [[users]] row. Its key is the basetype's key, and `owner_type` is pinned so the pair can only attach to a row the basetype already marked `USER`.
