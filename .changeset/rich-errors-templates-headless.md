---
"@noormdev/cli": minor
---

### Added

- `feat(headless):` Add `run inspect` command — inspect template context (data files, helpers, builtins, config, secrets) without executing, with `--json` support
- `feat(headless):` Add `run preview` command — render .sql.tmpl files and output raw SQL to stdout, pipeable to files or other tools

### Fixed

- `fix(errors):` Propagate SQL Server TDS diagnostic info (line numbers, error codes, procedure names, severity) through to TUI — errors now show e.g. `[Line 42, Err 207] Invalid column name` instead of just the message text
- `fix(errors):` Propagate PostgreSQL and MySQL diagnostic info (error codes, SQLSTATE, severity) through to TUI
- `fix(errors):` Handle Kysely-unpacked `AggregateError` arrays from TDS with multi-line display
- `fix(template):` Eta `autoTrim` left-trim was eating newlines after interpolation tags, joining SQL lines (e.g. `ENDAS`, `ENDIF NOT EXISTS`) — disabled autoTrim and implemented directive-line stripping for `-- {% %}` convention
- `fix(db):` Disconnect shared TUI connection before `DROP DATABASE` to prevent ECONNRESET errors
- `fix(db):` Show friendly "Not Created" notice instead of aggressive ERROR badge when database does not exist
- `fix(tui):` Show full multi-line SQL errors in all run/change screens instead of truncating to 60 characters
