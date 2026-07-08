---
type: Domain
---

# mcp-rpc

## What it does

MCP (Model Context Protocol) server that exposes noorm operations to AI agents. The MCP server wraps an RPC registry — commands are registered by name, then dispatched by the MCP `run_noorm_cmd` tool. A second tool `noorm_help` lists available commands. Session management tracks per-config connection state across MCP calls.

Every `RpcCommand` declares a `permission: Permission | 'open'` (`core/policy` permissions, or `'open'` for commands that target no config). Dispatch in [`src/mcp/server.ts`](../../src/mcp/server.ts) checks non-`'open'` commands against the resolved session's config via `checkConfigPolicy` before the handler runs.

## CLI code

- [`src/mcp/server.ts`](../../src/mcp/server.ts) — `createMcpServer`; builds `McpServer` with `run_noorm_cmd` and `noorm_help` tools. Dispatch gates every non-`'open'` command via `checkConfigPolicy` (`core/policy`) against the resolved session context before the handler runs
- [`src/mcp/init.ts`](../../src/mcp/init.ts) — `initMcpServer`; initializes RPC registry, registers all commands, wires session
- [`src/mcp/index.ts`](../../src/mcp/index.ts) — barrel export
- [`src/rpc/registry.ts`](../../src/rpc/registry.ts) — `RpcRegistry`; flat `Map<name, RpcCommand>` with register/get/list
- [`src/rpc/session.ts`](../../src/rpc/session.ts) — `SessionManager`; tracks active Kysely connections per config name. Carries the session's `channel` (`user`/`mcp`, default `'user'`) and enforces mcp-channel invisibility in `connect()` — a config with `access.mcp === false` (or no `access`) throws the same not-found error as an unknown config name
- [`src/rpc/commands/changes.ts`](../../src/rpc/commands/changes.ts) — RPC commands: `list_changes`, `run_change`, `revert_change`, `ff_changes`
- [`src/rpc/commands/config.ts`](../../src/rpc/commands/config.ts) — RPC commands: `list_configs` (`permission: 'open'`; filters out `access.mcp === false` configs for the mcp channel), `get_active_config`
- [`src/rpc/commands/explore.ts`](../../src/rpc/commands/explore.ts) — RPC commands: `list_tables`, `describe_table`, `list_views`, `list_functions`
- [`src/rpc/commands/query.ts`](../../src/rpc/commands/query.ts) — RPC commands: `sql` (dispatch-gates on `'sql:read'`; `executeRawSql` itself checks the classified statement class against the config's role), `run_sql`
- [`src/rpc/commands/run.ts`](../../src/rpc/commands/run.ts) — RPC commands: `run_file`, `run_build`
- [`src/rpc/commands/session.ts`](../../src/rpc/commands/session.ts) — RPC commands: `connect`, `disconnect` (both `permission: 'open'`), `overview`
- [`src/rpc/commands/index.ts`](../../src/rpc/commands/index.ts) — command group barrel
- [`src/rpc/types.ts`](../../src/rpc/types.ts) — `RpcCommand` (carries `permission: Permission | 'open'`), `RpcCommandInfo`, `RpcSession` (carries `readonly channel: Channel`) type definitions
- [`src/cli/mcp/init.ts`](../../src/cli/mcp/init.ts) — `mcp init` CLI command; writes `.mcp.json` config file
- [`src/cli/mcp/serve.ts`](../../src/cli/mcp/serve.ts) — `mcp serve` CLI command; starts MCP server over stdio

## Docs

- [`docs/guide/automation/mcp.md`](../guide/automation/mcp.md) — MCP setup and usage guide
- [`docs/dev/headless.md`](../dev/headless.md) — headless/MCP usage patterns

## Coupling

- MCP server wraps RPC registry — new RPC commands are automatically discoverable via `noorm_help`.
- RPC commands delegate to core modules (same as CLI) — core API changes need RPC command updates in parallel with CLI changes.
- MCP dispatch gates every non-`'open'` `RpcCommand` via `checkConfigPolicy` from [`src/core/policy/`](../../src/core/policy) — `src/rpc/protection.ts` and `src/core/config/protection.ts` (the old protected-config rule checkers) were both deleted; policy is now the sole enforcement point.
- Every `RpcCommand` declares a `permission: Permission | 'open'` ([`src/rpc/types.ts`](../../src/rpc/types.ts)) — new RPC commands must pick a `core/policy` `Permission` or `'open'`, or the dispatch gate in [`src/mcp/server.ts`](../../src/mcp/server.ts) has nothing to check.
- `SessionManager` holds live Kysely connections — connection lifecycle must coordinate with [`src/core/connection/manager.ts`](../../src/core/connection/manager.ts).
- [`src/cli/mcp/serve.ts`](../../src/cli/mcp/serve.ts) is the CLI entry; [`src/mcp/init.ts`](../../src/mcp/init.ts) is the wiring; [`src/mcp/server.ts`](../../src/mcp/server.ts) is the MCP layer.

## Conventions worth knowing

- MCP transport: stdio (JSON-RPC over stdin/stdout).
- `run_noorm_cmd` dispatches by command name string — command names are stable API surface.
- `noorm_help` lists all registered commands with descriptions and parameter schemas.
- `mcp init` writes `.mcp.json` with the `noorm mcp serve` invocation for Claude Desktop / IDE integration.
- Zod schemas on each RPC command define the `payload` shape validated at dispatch time.
- Tests in [`tests/core/mcp/`](../../tests/core/mcp) cover server init and command dispatch; [`tests/core/rpc/`](../../tests/core/rpc) covers registry, permissions, session.
- `connect()` on the mcp channel throws the identical `configNotFoundMessage` error (`core/config/resolver.ts`) for an unknown config and an invisible one (`access.mcp === false`) — an mcp caller cannot distinguish "doesn't exist" from "not permitted".
- `SessionInfo.protected: boolean` was replaced by `SessionInfo.role: Role` — the resolved role for the session's channel (`mcp` resolves `access.mcp`, `user` resolves `access.user`).
