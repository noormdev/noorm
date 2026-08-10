---
"@noormdev/sdk": minor
---

## Added

* `feat(sdk):` `ctx.withSchema<SDB>(name)` — derive a `Context` scoped to one schema, sharing the parent's connection, pool, and lifecycle
* `feat(sdk):` `proc`/`func`/`tvf` calls through a derived context are automatically qualified with the schema name, unless the caller already passed a dotted name
* `feat(sdk):` `transaction()` and `impersonate()` compose with a derived context — both stay scoped to the derived schema
