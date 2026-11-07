---
external: DatabaseEngine
description: The configured database executes prepared pipeline SQL under selected scheduling and transaction boundaries.
---

The database engine is the execution boundary for application SQL, outside noorm's bookkeeping model. It is the same resolved database selected by the caller's configuration, not a second connection configuration or a source or destination for cross-database data movement. Application tables are arbitrary and are not modeled as noorm audit entities.

## What DatabaseEngine does

- Receives a run ID, transaction policy, order mode, session and transaction boundaries, and scheduled prepared SQL against the configured database.
- Returns step execution results, timings and errors, and transaction outcomes, including uncertainty when commit or rollback cannot be established.

## Expectations

The caller applies the transaction policy and distinguishes step execution success from confirmed commit. A pipeline-wide graph executes serially on one pinned session; ready steps under step or none can run on separate sessions within the cap. Active statements may not be cancellable. Engine SQL and error details may contain sensitive values; normal caller results and history must not expose raw SQL or secrets.
