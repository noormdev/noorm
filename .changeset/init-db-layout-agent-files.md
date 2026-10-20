---
'@noormdev/cli': minor
'@noormdev/sdk': minor
---

**Breaking:** the default for `paths.sql` and `paths.changes` is now `./db/sql` and `./db/changes`. A `settings.yml` with no `paths` key resolves there, so a project laid out at `./sql` and `./changes` must add `paths: { sql: ./sql, changes: ./changes }`. A `settings.yml` written by `noorm init` already carries `paths` and is unaffected.

`noorm init` now creates `db/sql/` and `db/changes/` instead of `sql/` and `changes/`, and writes `db/AGENTS.md`, which points coding agents at the `/noorm` skill and leaves a marker for your own steering, and `db/CLAUDE.md`, which imports it. Neither file is overwritten on re-init. Overwriting a settings file (`noorm init --force`, `noorm settings init --force`) keeps the `paths` already in it. The `noorm` skill now states what `sql/` and `changes/` are for, which edits belong in each, how to reference `sql/` files from a change with a `.txt` manifest, and when to use a `.sql.tmpl`.
