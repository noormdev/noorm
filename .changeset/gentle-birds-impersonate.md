---
"@noormdev/sdk": minor
---

## Added

* `feat(sdk):` Per-request user impersonation via `ctx.impersonate()` — borrow a dedicated pool connection, switch database identity, and run queries as a specific principal with guaranteed revert
* `feat(sdk):` Callback mode (auto-reverts on completion or throw) and explicit mode (caller-managed lifecycle for cross-boundary use cases like Hapi request hooks)
* `feat(sdk):` MSSQL (`EXECUTE AS USER` / `REVERT`) and PostgreSQL (`SET ROLE` / `RESET ROLE`) dialect support with SQL injection prevention via username validation and dialect-specific quoting
