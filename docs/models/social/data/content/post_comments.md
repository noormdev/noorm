---
entity: post_comments
group: content
pk:
  - comment_id
columns:
  comment_id:
    type: integer
    desc: "The basetype's key, whole. That is what makes this a subtype rather than a child."
  post_id:
    type: integer
    desc: "A real foreign key to a real table, which polymorphism cannot give you."
examples:
  - comment_id: 1
    post_id: 1
relationships:
  - target: comments
    on:
      comment_id: comment_id
    predicate: { fwd: is realized as, rev: is a }
  - target: posts
    on:
      post_id: post_id
    predicate: { fwd: replies to, rev: is replies by }
---

# post_comments

A [[comments]] belonging to a [[posts]] row. Its key is the basetype's key.
