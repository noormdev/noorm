---
"@noormdev/cli": minor
---

## Added
* `feat(mcp):` Add MCP server for coding agent integration — `noorm mcp serve` starts a stdio JSON-RPC server, `noorm mcp init` generates `.mcp.json` config files
* `feat(rpc):` Add transport-agnostic RPC command registry with Zod-validated commands: `connect`, `disconnect`, `list_configs`, `overview`, `list`, `detail`, `sql`, `change_history`, `change_run`, `change_ff`, `change_revert`, `run_build`, `run_file`
* `feat(rpc):` Add SQL protection for read-only enforcement on protected configs using `sql-parser-cst` with keyword fallback
