---
"@noormdev/sdk": patch
"@noormdev/cli": patch
---

`ctx.impersonate()` closes its connection when the switch statement (`EXECUTE AS USER`, `SET ROLE`) or the revert statement (`REVERT`, `RESET ROLE`) fails, in callback and explicit mode. Before, callback mode returned the connection to the pool, where the next query could run as the impersonated principal, and a failed `scope.revert()` kept the connection checked out until `disconnect()`.

- Behavior change: after a failed `scope.revert()` the scope is over. The call still rejects with the revert error; a later `revert()` does nothing, where it re-ran the statement before.
- Behavior change: `disconnect()` during a callback-mode `impersonate()` rejects that call with `DisconnectedError` and closes its connection, as `withConnection` does. It waited for the callback before.
