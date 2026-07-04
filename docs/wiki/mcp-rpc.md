---
type: Domain
---

# mcp-rpc

## What it does

MCP (Model Context Protocol) server that exposes noorm operations to AI agents. The MCP server wraps an RPC registry — commands are registered by name, then dispatched by the MCP `run_noorm_cmd` tool. A second tool `noorm_help` lists available commands. Session management tracks per-config connection state across MCP calls.

## CLI code

- `src/mcp/server.ts` — `createMcpServer`; builds `McpServer` with `run_noorm_cmd` and `noorm_help` tools
- `src/mcp/init.ts` — `initMcpServer`; initializes RPC registry, registers all commands, wires session
- `src/mcp/index.ts` — barrel export
- `src/rpc/registry.ts` — `RpcRegistry`; flat `Map<name, RpcCommand>` with register/get/list
- `src/rpc/session.ts` — `SessionManager`; tracks active Kysely connections per config name
- `src/rpc/protection.ts` — `RpcProtection`; validates commands against protected-config rules
- `src/rpc/commands/changes.ts` — RPC commands: `list_changes`, `run_change`, `revert_change`, `ff_changes`
- `src/rpc/commands/config.ts` — RPC commands: `list_configs`, `get_active_config`
- `src/rpc/commands/explore.ts` — RPC commands: `list_tables`, `describe_table`, `list_views`, `list_functions`
- `src/rpc/commands/query.ts` — RPC commands: `sql`, `run_sql`
- `src/rpc/commands/run.ts` — RPC commands: `run_file`, `run_build`
- `src/rpc/commands/session.ts` — RPC commands: `connect`, `disconnect`, `overview`
- `src/rpc/commands/index.ts` — command group barrel
- `src/rpc/types.ts` — `RpcCommand`, `RpcCommandInfo`, `RpcSession` type definitions
- `src/cli/mcp/init.ts` — `mcp init` CLI command; writes `.mcp.json` config file
- `src/cli/mcp/serve.ts` — `mcp serve` CLI command; starts MCP server over stdio

## Docs

- `docs/guide/automation/mcp.md` — MCP setup and usage guide
- `docs/dev/headless.md` — headless/MCP usage patterns

## Coupling

- MCP server wraps RPC registry — new RPC commands are automatically discoverable via `noorm_help`.
- RPC commands delegate to core modules (same as CLI) — core API changes need RPC command updates in parallel with CLI changes.
- `RpcProtection` uses `src/core/config/protection.ts` rules — config protection domain changes affect which RPC commands are allowed.
- `SessionManager` holds live Kysely connections — connection lifecycle must coordinate with `src/core/connection/manager.ts`.
- `src/cli/mcp/serve.ts` is the CLI entry; `src/mcp/init.ts` is the wiring; `src/mcp/server.ts` is the MCP layer.

## Conventions worth knowing

- MCP transport: stdio (JSON-RPC over stdin/stdout).
- `run_noorm_cmd` dispatches by command name string — command names are stable API surface.
- `noorm_help` lists all registered commands with descriptions and parameter schemas.
- `mcp init` writes `.mcp.json` with the `noorm mcp serve` invocation for Claude Desktop / IDE integration.
- Zod schemas on each RPC command define the `payload` shape validated at dispatch time.
- Tests in `tests/core/mcp/` cover server init and command dispatch; `tests/core/rpc/` covers registry, protection, session.
