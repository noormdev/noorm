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
    desc: "Discriminator. Joins a unique key so it can travel into each subtype's foreign key."
  created_at:
    type: datetime
examples:
  - photo_id: 1
    subject_type: USER
    created_at: "2026-04-02T11:00:00Z"
subtypes:
  - exclusive: true
    desc: Every photo hangs off exactly one kind of subject
    members:
      user_photos:
        subject_type: USER
      group_photos:
        subject_type: GROUP
      profile_photos:
        subject_type: PROFILE
      user_post_photos:
        subject_type: USER_POST
---

# photos

A photo. Four things can hold one, and each gets a real foreign key rather than a shared integer column.
