---
"@noormdev/sdk": minor
---

## Connection

### Added

* `feat(db):` Connections now carry a connect timeout, so an unreachable host fails instead of hanging forever. Defaults to 15s; set `connection.connectTimeoutMs` per config to raise it for a database that resumes from an auto-paused state.
