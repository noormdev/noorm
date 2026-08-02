---
entity: tags
group: content
pk:
  - tag_id
columns:
  tag_id:
    type: integer
  target_type:
    type: text
    desc: "Which kind of row target_id means. 'POST' | 'PHOTO' | 'COMMENT'. The database cannot check it."
  target_id:
    type: integer
    desc: "References nothing. No foreign key is possible, because the target table changes per row."
  created_at:
    type: datetime
examples:
  - tag_id: 1
    target_type: POST
    target_id: 1
    created_at: "2026-04-02T11:00:00Z"
---

# tags

A tag application. Same shape, same silence.

`target_id` is an ordinary integer. Point it at a deleted row, or at the right id in the wrong table, and nothing objects. Every rule about what it may reference lives in application code.
