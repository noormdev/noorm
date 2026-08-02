---
entity: comment_comments
group: content
pk:
  - comment_id
columns:
  comment_id:
    type: integer
    desc: "The basetype's key, whole."
  target_type:
    type: text
    default: "'COMMENT'"
    desc: "Pinned to COMMENT."
  parent_comment_id:
    type: integer
    desc: "The comment being replied to. A real foreign key, even though it points back at the same basetype."
examples:
  - comment_id: 4
    target_type: COMMENT
    parent_comment_id: 3
relationships:
  - target: comments
    on:
      comment_id: comment_id
    predicate: { fwd: is realized as, rev: is a }
  - target: comments
    on:
      parent_comment_id: comment_id
    predicate: { fwd: is replied to by, rev: replies to }
---

# comment_comments

A reply. It is a subtype of [[comments]] and also references [[comments]] again as its target, which polymorphism models with the same untyped integer it uses for everything else.
