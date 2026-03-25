---
"@noormdev/cli": patch
---

### Fixed

- `fix(template):` Resolve `$helpers` loading in compiled binaries — bare specifier resolution now uses `Bun.build()` to bundle helper files with all dependencies, fixing `Cannot find package` errors in pnpm projects
- `fix(inspect):` Show `$helpers` exports in Inspect Template screen — categorization now uses source-based tracking instead of type-guessing, and load errors are surfaced instead of silently swallowed

### Added

- `feat(cli):` Add `dev/test-helpers` diagnostic command for verifying `$helpers` loading from any execution context
