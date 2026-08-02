---
entity: posts
group: content
pk:
  - post_id
columns:
  post_id:
    type: integer
  owner_type:
    type: text
    desc: "Discriminator. Joins a unique key so it can travel into each subtype's foreign key."
  created_at:
    type: datetime
examples:
  - post_id: 1
    owner_type: USER
    created_at: "2026-04-02T11:00:00Z"
subtypes:
  - exclusive: true
    desc: Every post is owned by exactly one of a user or a group
    members:
      user_posts:
        owner_type: USER
      group_posts:
        owner_type: GROUP
---

# posts

A post. Everything common to one lives here; who owns it is structural, not a column you branch on.
