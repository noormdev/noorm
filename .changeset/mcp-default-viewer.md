---
"@noormdev/cli": major
"@noormdev/sdk": major
---

## Access default: agents no longer get admin

### Changed

* `fix(policy)!:` a config with no explicit `access` now resolves to `{ user: 'admin', mcp: 'viewer' }` instead of `{ user: 'admin', mcp: 'admin' }`. A stock project writes no `access`, so every config was handing full admin to any connected MCP client — writes, DDL, `change_run`, `run_build`, database drops, and vault/secret reads all went through unchecked.
  * **The `user` channel is unchanged.** Nothing about the CLI, TUI, or SDK behaves differently.
  * **MCP agents keep read access.** `explore` and read-only SQL (`SELECT`, `EXPLAIN`, `SHOW`, `DESCRIBE`) still work with no setup.
  * **MCP agents lose write access by default.** If an agent needs to write, run changes, or run builds, set that config's `access.mcp` to `operator` or `admin` explicitly — via `noorm ui` → Config → Edit, or in the JSON before `config import`.
  * **Configs that already store an explicit `access` are untouched**, including ones holding `mcp: 'admin'`. If you created configs on an earlier build, that migration already wrote `admin/admin` to disk and it is preserved — run `noorm config list` and lower any `mcp:admin` you did not intend.
* `noorm config list` now prints the access tag for any config that differs from the default, so an `mcp: admin` escalation is visible. Previously the tag was hidden whenever the user channel was `admin`, which concealed exactly that case.
