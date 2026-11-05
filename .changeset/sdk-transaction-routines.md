---
'@noormdev/sdk': minor
---

The handle `ctx.transaction(fn)` passes to `fn` now carries typed `proc`, `func`, and `tvf` that run on the transaction's connection, so a routine call runs under a `SET LOCAL statement_timeout` set earlier in the same transaction and rolls back with the transaction. `scope.transaction(fn)` on an impersonated scope passes a handle of the same type. The handle's type, `TransactionScope`, and the `RoutineCalls` interface are exported. On Postgres, `ImpersonatedScope.proc` now retries a `CALL` against a function as `SELECT * FROM`, as `ctx.proc` already did; before, it threw.
