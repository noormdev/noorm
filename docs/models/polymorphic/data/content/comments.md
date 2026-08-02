---
entity: comments
group: content
pk:
  - comment_id
columns:
  comment_id:
    type: integer
  commentable_type:
    type: text
    desc: "Which kind of row commentable_id means. 'POST' | 'PHOTO' | 'COMMENT' | 'USER' | 'GROUP'. The database cannot check it."
  commentable_id:
    type: integer
    desc: "References nothing. No foreign key is possible, because the target table changes per row."
  created_at:
    type: datetime
examples:
  - comment_id: 1
    commentable_type: POST
    commentable_id: 1
    created_at: "2026-04-02T11:00:00Z"
---

# comments

The table ORMs reach for polymorphism to model. Five possible targets, none of them declared.

`commentable_id` is an ordinary integer. Point it at a deleted row, or at the right id in the wrong table, and nothing objects. Every rule about what it may reference lives in application code.
