---
"@noormdev/sdk": patch
---

### Fixed

- `fix(sdk):` Bundle all runtime dependencies — resolves `Cannot find package 'json5'` and similar errors when importing the SDK
- `fix(sdk):` Add `createRequire` banner for CJS packages that use `require('process')` in ESM bundles
- `fix(template):` Resolve `$helpers` loading in compiled binaries via `Bun.build()` bundling

### Changed

- `perf(sdk):` Lazy-load template data parsers (JSON5, YAML, CSV) — heavy parser libraries are now deferred until first use, reducing SDK startup time
- `perf(sdk):` Replace `voca` dependency with inline `camelCase` implementation (~1500 lines removed from bundle)
- `perf(sdk):` Stub `ansis` terminal color library — SDK consumers don't need ANSI output
