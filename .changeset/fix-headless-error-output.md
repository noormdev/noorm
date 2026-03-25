---
"@noormdev/cli": patch
---

### Fixed

- `fix(headless):` Produce structured JSON error output (`{ success, error }`) when `--json` is set — previously errors were only logged as text, leaving CI pipelines with no parseable output on failure
- `fix(headless):` Enrich SQL error messages with dialect-aware diagnostics (line numbers, error codes, procedure names, severity) via `getSqlErrorMessage` in all headless command error paths
- `fix(headless):` Standardize `run build` exit code from `2` to `1` to match the `0`/`1` convention used by all other headless commands
- `fix(headless):` Replace stale `.sql.eta` file extension references with `.sql.tmpl` across CLI argument parsing, help text, and documentation

### Added

- `feat(headless):` Add `sql` command to the home help commands list
- `feat(headless):` Document `.sql.tmpl` template file support in `run` help text
