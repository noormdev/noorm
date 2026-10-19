---
'@noormdev/cli': minor
'@noormdev/sdk': minor
---

`noorm init` now creates `db/sql/` and `db/changes/` instead of `sql/` and `changes/`, and writes `paths.sql: ./db/sql` and `paths.changes: ./db/changes` into `settings.yml`. It also writes `db/AGENTS.md`, which points coding agents at the `/noorm` skill and leaves a marker for your own steering, and `db/CLAUDE.md`, which imports it. Neither file is overwritten on re-init. Existing projects keep their layout: re-running `init`, including `--force`, keeps the `paths` already in `settings.yml`, and a `settings.yml` with no `paths` key still resolves to `./sql` and `./changes`. The `noorm` skill now states what `sql/` and `changes/` are for, which edits belong in each, how to reference `sql/` files from a change with a `.txt` manifest, and when to use a `.sql.tmpl`.
