---
"@noormdev/cli": minor
"@noormdev/sdk": minor
---

## Schema exploration answers about the object you asked for

### Fixed

* `fix(explore):` procedure detail returns parameters. It filtered `information_schema.parameters` on a bare name where the column holds `name_oid`, so the list view reported a parameter count and the detail view always showed none — on every surface.
* `fix(explore):` SQLite quotes identifiers at all raw-SQL sites. A single table named with an embedded quote broke listing, overview and detail for *unrelated* tables.
* `fix(explore):` MySQL table detail reads indexes and foreign keys from the requested schema rather than the connected database, which produced self-contradictory output with the real index missing.
* `fix(explore):` `--schema` is honoured on the list commands, which declared it and ignored it.
* `fix(explore):` the overview counts from the same listings the detail views use, inside one guarded call that surfaces errors, instead of a second implementation that disagreed and hardcoded several counters to zero.
