---
entity: photos
group: content
pk:
  - photo_id
columns:
  photo_id:
    type: integer
  subject_type:
    type: text
    desc: "Which kind of row subject_id means. 'USER' | 'GROUP' | 'PROFILE' | 'POST'. The database cannot check it."
  subject_id:
    type: integer
    desc: "References nothing. No foreign key is possible, because the target table changes per row."
  created_at:
    type: datetime
examples:
  - photo_id: 1
    subject_type: USER
    subject_id: 1
    created_at: "2026-04-02T11:00:00Z"
---

# photos

A photo, hanging off any of four things. Which one is a string.

`subject_id` is an ordinary integer. Point it at a deleted row, or at the right id in the wrong table, and nothing objects. Every rule about what it may reference lives in application code.
