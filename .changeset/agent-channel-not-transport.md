---
"@noormdev/cli": major
"@noormdev/sdk": major
---

Resolve the access channel from who is driving, not which binary was invoked

`Channel` used to name the transport: `user` meant the CLI/TUI/SDK and `mcp`
meant the MCP server. Those only coincide when a human is at the keyboard. An
agent refused a write over MCP could see `noorm` on the PATH and shell out,
and because the CLI hardcoded `user` at every policy call site, that second
attempt ran with the human's role. On a stock config that turned deny into
allow for `sql:write`, `sql:ddl`, `db:create`, `run:build` and `vault:read`,
and turned `db:destroy` into a confirm that `--yes` satisfied.

Two breaking changes:

**The config fields are renamed.** `Channel` is now `'user' | 'agent'`, and
`ConfigAccess` is `{ user, agent }` instead of `{ user, mcp }`. `agent: false`
hides a config from agents on *both* transports, not just over MCP. Stored
state migrates automatically (state schema v3) and carries every value over
verbatim — `mcp: 'operator'` becomes `agent: 'operator'`, `mcp: false` becomes
`agent: false`. SDK callers passing `channel: 'mcp'` to `createContext` must
pass `'agent'`, and anything reading or writing `config.access.mcp` must use
`config.access.agent`. In the TUI, the "MCP Role" field is now "Agent Role".

**Agents shelling out to the CLI now get the agent role.** The CLI resolves
its channel from provenance via `resolveChannel()`: an allowlist of variables
the agent harnesses (Claude Code, Codex, Cursor, Gemini CLI) set for their own
child processes. A stock config gives agents `viewer`, so commands that used
to succeed inside an agent session are now refused — that is the fix, not a
regression. `TERM_PROGRAM`, `CI` and TTY state are deliberately not consulted;
they describe the terminal or the pipeline, not the caller.

Set `NOORM_CHANNEL=user` to opt out when a human is scripting from inside an
agent session, or `NOORM_CHANNEL=agent` to opt in with no harness present. An
agent can set that variable too; this defends against one routing around a
refusal, not one deliberately evading the check.
