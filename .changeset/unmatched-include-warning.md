---
"@noormdev/cli": patch
"@noormdev/sdk": patch
---

## Fixed
* `fix(run):` `run build` now names `build.include` entries that matched no files instead of reporting a plain success over zero files — include paths are relative to `paths.sql`, and the common `sql/01_tables` form silently matched nothing. `BatchResult` gains an optional `unmatchedInclude`.
