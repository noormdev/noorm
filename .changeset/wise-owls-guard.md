---
"@noormdev/cli": minor
"@noormdev/sdk": minor
---

## Access Roles

Replace the per-config `protected: boolean` flag with per-channel access roles.

* `feat(policy):` Configs now carry `access: { user, mcp }`, each `'viewer' | 'operator' | 'admin'` (or `mcp: false` to hide the config entirely). Roles are enforced by one policy matrix instead of scattered `protected` checks — `viewer` reads only, `operator` writes and confirms destructive operations, `admin` is frictionless.
* `feat(mcp):` Every MCP command is now gated on `access.mcp` before it runs, closing the gap where `change_run`/`change_ff`/`change_revert`/`run_file`/`run_build` reached the database unchecked. `access.mcp: false` makes a config invisible to agents — absent from `list_configs`, and `connect` fails with the same error an unknown config produces. `confirm`-tier permissions collapse to a hard deny on the MCP channel (no human to type a confirmation phrase); give a config `mcp: 'admin'` if an agent legitimately needs to run changes there.
* `feat(sql):` Raw SQL (`noorm sql`, MCP `sql`) is now gated by what the statement actually does — classified `read`/`write`/`ddl` — instead of a blanket read-only check. Multi-statement input takes the highest class present; unparseable input or `EXEC`/`CALL` classify as `ddl` (fail closed).
* `feat(sdk):` `createContext({ channel })` — defaults to `'user'`; set `'mcp'` when embedding the SDK behind an MCP-like surface. New exported types `Channel`, `ConfigAccess`, `Role`. `ProtectedConfigError` is now raised from `checkPolicy` denials/unconfirmable actions rather than a bare `protected` check.
* `fix(config):` A legacy `protected: true` migrates automatically to `{ user: 'operator', mcp: 'viewer' }`, and `protected: false`/absent to `{ user: 'admin', mcp: 'admin' }`. The `protected` field is still accepted on `config import`/settings input for this release, then removed.
