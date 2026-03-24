---
"@noormdev/sdk": patch
---

### Fixed

- `fix(sdk):` Bundle all runtime dependencies — resolves `Cannot find package 'json5'` and similar errors when importing the SDK

### Changed

- `perf(sdk):` Lazy-load template data parsers (JSON5, YAML, CSV) — heavy parser libraries are now deferred until first use, reducing SDK startup time
