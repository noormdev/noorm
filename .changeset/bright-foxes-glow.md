---
"@noormdev/sdk": minor
---

## DT Format

### Added

* `feat(dt):` Add `text` encoded type for large TEXT columns with smart gz64 compression
* `feat(dt):` Map MSSQL `nvarchar(max)` and `varchar(max)` to `text` encoded type
* `feat(dt):` Detect `(max)` suffix in MSSQL schema introspection via `max_length = -1`

### Changed

* `refactor(dt):` MySQL `text`, `mediumtext`, `longtext` now map to `text` (was `string`); `tinytext` stays `string`
* `refactor(dt):` MSSQL `text`, `ntext` now map to `text` (was `string`)
