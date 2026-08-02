---
'@noormdev/cli': patch
---

Read change-history timestamps as UTC on postgres and mysql

`executed_at` has no time zone and noorm writes UTC into it, but `pg` and
`mysql2` both read that back through the host's local zone. On a UTC-4 host a
change applied a second ago was reported as four hours in the future, which
surfaced in the TUI as "Applied ... in 4 hours" on the home screen and in
change history. MSSQL is unchanged — its driver was not measured.
