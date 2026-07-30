---
"@noormdev/cli": minor
"@noormdev/sdk": patch
---

## Self-update input validation, log rotation and redaction

### Fixed

* `fix(update)!:` the version string from the npm registry is validated as semver before it reaches a URL or a shell. It was interpolated verbatim, and because `fetch` normalises `..`, a poisoned dist-tag could relocate **both the binary and its `checksums.txt`** to an attacker-controlled repository — so checksum verification passed against the attacker's own file.
* `fix(logger):` rotation reopens its write stream. It renamed the file out from under the open descriptor, so every subsequent write landed in the rotated file, `noorm.log` never reappeared, and rotation fired exactly once before growing unbounded.
* `fix(logger):` `settings.logging.enabled`, `.file`, `.maxSize` and `.maxFiles` are honoured. The CLI hardcoded all four, so every logging setting was inert across every command — and the log viewer read a different path than the CLI wrote.
* `fix(logger):` redaction covers this project's own variables. `NOORM_CONNECTION_PASSWORD` and `NOORM_IDENTITY_PRIVATE_KEY` were not masked, credential-bearing URIs passed through verbatim because values were never inspected, and `Error` objects were skipped wholesale. Log files are created `0600` rather than world-readable.
