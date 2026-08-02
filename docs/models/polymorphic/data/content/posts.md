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
    desc: "Which kind of row owner_id means. 'USER' | 'GROUP'. The database cannot check it."
  owner_id:
    type: integer
    desc: "References nothing. No foreign key is possible, because the target table changes per row."
  created_at:
    type: datetime
examples:
  - post_id: 1
    owner_type: USER
    owner_id: 1
    created_at: "2026-04-02T11:00:00Z"
---

# posts

A post, owned by a user or a group. Which one is a string.

`owner_id` is an ordinary integer. Point it at a deleted row, or at the right id in the wrong table, and nothing objects. Every rule about what it may reference lives in application code.
