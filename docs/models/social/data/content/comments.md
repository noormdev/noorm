---
entity: comments
group: content
pk:
  - comment_id
columns:
  comment_id:
    type: integer
  target_type:
    type: text
    desc: "Discriminator. Joins a unique key so it can travel into each subtype's foreign key."
  created_at:
    type: datetime
examples:
  - comment_id: 1
    target_type: USER
    created_at: "2026-04-02T11:00:00Z"
subtypes:
  - exclusive: true
    desc: Every comment targets exactly one kind of thing
    members:
      user_comments:
        target_type: USER
      group_comments:
        target_type: GROUP
      post_comments:
        target_type: POST
      comment_comments:
        target_type: COMMENT
---

# comments

A comment. This is the entity ORMs reach for polymorphism to model, and the one that suffers most for it.
