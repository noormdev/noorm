---
'@noormdev/cli': minor
'@noormdev/sdk': minor
---

`noorm init` now creates `db/sql/` and `db/changes/` instead of `sql/` and `changes/`, and writes `db/AGENTS.md` and `db/CLAUDE.md`. `AGENTS.md` points coding agents at the `/noorm` skill and points data modeling at ignatius and its `/ignatius-modeling` skill. It also leaves a marker for your own steering. `CLAUDE.md` imports `AGENTS.md`. Neither file is overwritten on re-init. Overwriting a settings file (`noorm init --force`, `noorm settings init --force`) keeps the `paths` already in it. The `noorm` skill now states what `sql/` and `changes/` are for, which edits belong in each, how to reference `sql/` files from a change with a `.txt` manifest, and when to use a `.sql.tmpl`.

The built-in default for `paths.sql` and `paths.changes` is now `./db/sql` and `./db/changes`, matching what `noorm init` creates. `noorm init` writes `paths` into `settings.yml`, so an initialized project keeps its layout. A project laid out at `./sql` and `./changes` whose `settings.yml` is missing, empty, or has no `paths` key now resolves to `./db/sql` and `./db/changes`. Add `paths: { sql: ./sql, changes: ./changes }` to `settings.yml`, or set `NOORM_PATHS_SQL` and `NOORM_PATHS_CHANGES`.
