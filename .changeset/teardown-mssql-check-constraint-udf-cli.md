---
"@noormdev/cli": patch
---

fix(cli): noorm db teardown drops MSSQL CHECK constraints before functions

`noorm db teardown` (and `noorm db reset`) aborted with MSSQL error 3729 on
any schema where a scalar UDF is referenced by a CHECK constraint (the
canonical base/subtype "IsType" pattern). Functions are dropped before tables
to satisfy schema-bound dependents, which left the CHECK-constraint dependency
intact. Teardown now severs it first by dropping all user-schema CHECK
constraints (excluding the `noorm` schema) ahead of the function drops, so
both schema-bound functions and CHECK-backed functions tear down cleanly.
