---
entity: tags
group: tagging
pk:
  - tag_id
columns:
  tag_id:
    type: integer
  target_type:
    type: text
    desc: "Discriminator, drawn from the tag_target_types table rather than a CHECK list. Joins a unique key so it can travel into each subtype's foreign key."
  created_at:
    type: datetime
examples:
  - tag_id: 1
    target_type: POST
    created_at: "2026-04-02T11:00:00Z"
subtypes:
  - exclusive: true
    desc: Every tag application points at exactly one kind of thing
    members:
      post_tags:
        target_type: POST
      photo_tags:
        target_type: PHOTO
      comment_tags:
        target_type: COMMENT
---

# tags

A tag application. The label itself is common; what was tagged is the subtype.
