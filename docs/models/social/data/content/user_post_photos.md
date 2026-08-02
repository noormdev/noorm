---
entity: user_post_photos
group: content
pk:
  - photo_id
columns:
  photo_id:
    type: integer
    desc: "The basetype's key, whole. That is what makes this a subtype rather than a child."
  post_id:
    type: integer
    desc: "A real foreign key to a real table, which polymorphism cannot give you."
examples:
  - photo_id: 1
    post_id: 1
relationships:
  - target: photos
    on:
      photo_id: photo_id
    predicate: { fwd: is realized as, rev: is a }
  - target: user_posts
    on:
      post_id: post_id
    predicate: { fwd: is attached to, rev: is is by }
---

# user_post_photos

A [[photos]] belonging to a [[user_posts]] row. Its key is the basetype's key.
