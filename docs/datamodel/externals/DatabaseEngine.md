---
external: DatabaseEngine
description: The configured database executes ordered pipeline SQL and reports transaction outcomes.
---

The database engine is the execution boundary for application SQL, outside noorm's bookkeeping model. It is the same resolved database selected by the caller's configuration, not a second connection configuration or a source or destination for cross-database data movement. Application tables are arbitrary and are not modeled as noorm audit entities.

## What DatabaseEngine does

- Receives a run ID, transaction policy, and ordered prepared SQL steps for execution against the configured database.
- Returns ordered step results, errors, and the workflow transaction outcome, including an unknown outcome when commit or rollback cannot be established.

## Expectations

The caller applies the requested transaction policy and distinguishes step execution success from a confirmed commit. Engine SQL and error details may contain sensitive values; normal caller results and history must not expose raw SQL or secrets.
