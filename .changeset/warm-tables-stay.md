---
"@noormdev/sdk": minor
---

## API/Services

### Fixed
* `fix(sdk):` `db.truncate()` and `db.teardown()` now respect `settings.teardown.preserveTables` and `postScript` from settings.yml
* `fix(sdk):` `db.truncate()` accepts optional `TruncateOptions` — user-provided `preserve`/`only` take priority over settings fallback
