---
'@noormdev/cli': patch
'@noormdev/sdk': patch
---

SDK runs and changes create noorm's tracking tables when the database has none, so `run.build()`, `changes.ff()` and `db.reset()` work on a fresh database without a prior `noorm run build`. `db.reset()` now resolves with the build result and throws `ResetBuildError` when the rebuild fails; before, a failed rebuild resolved as if it had succeeded.

`db.reset()` checks the tracking schema version and reads the schema directory before it drops anything, so a newer tracking schema or an unreadable `db/sql` leaves the database untouched. `lock.acquire`, `lock.withLock` and `vault.init` also create the tracking tables on a fresh database.
