---
type: Domain
description: MCP server over stdio wrapping a flat RPC command registry, permission-gated dispatch
---

# mcp-rpc

## What it does

MCP (Model Context Protocol) server that exposes noorm operations to AI agents. The MCP server wraps an RPC registry — commands are registered by name, then dispatched by the MCP `run_noorm_cmd` tool. A second tool `noorm_help` lists available commands and generates parameter docs from each command's Zod schema. [`src/rpc/session.ts`](../../src/rpc/session.ts)'s `SessionManager` tracks per-config connection state (a `Map<string, Context>`) across MCP calls and carries the session's `channel` (`user`/`agent`).

Every `RpcCommand` declares a `permission: Permission | 'open'` (`core/policy` permissions, or `'open'` for commands that target no config and skip the gate). Dispatch in [`src/mcp/server.ts`](../../src/mcp/server.ts) checks non-`'open'` commands against the resolved session's config via `checkConfigPolicy` before the handler runs.

## CLI code

- [`src/mcp/server.ts`](../../src/mcp/server.ts) — `createMcpServer(registry, session)`; builds `McpServer` with two tools, `run_noorm_cmd` and `noorm_help`. Dispatch gates every non-`'open'` command via `checkConfigPolicy` (`core/policy`) against the resolved session context before the handler runs; errors from a handler are logged server-side with their stack via `console.error` and returned to the client as `{ error: message }` only (no stack)
- [`src/mcp/index.ts`](../../src/mcp/index.ts) — `startServer()`; builds `createRegistry()` + `new SessionManager('agent')`, wires `createMcpServer`, connects a `StdioServerTransport`, and registers `SIGINT`/`SIGTERM` handlers that call `session.disconnectAll()`. Never returns — the stdio event loop keeps the process alive
- [`src/mcp/init.ts`](../../src/mcp/init.ts) — `generateMcpConfig(projectRoot, { agent })`; creates or extends `.mcp.json` (agent `claude`, the default) or `.cursor/mcp.json` (agent `cursor`) with a `noorm` entry under `mcpServers` (`{ command: 'noorm', args: ['mcp', 'serve'] }`), merging into any existing file without touching other entries
- [`src/rpc/registry.ts`](../../src/rpc/registry.ts) — `RpcRegistry`; flat `Map<name, RpcCommand>` with `register`/`get`/`list`/`getHelp`. `getHelp` reads `.shape` off the Zod `inputSchema` at runtime to list parameters, plus each command's [`examples`](../../examples)
- [`src/rpc/session.ts`](../../src/rpc/session.ts) — `SessionManager`; tracks active `Context` connections per config name. Carries the session's `channel` (`user`/`agent`, default `'user'`) and enforces agent-channel invisibility in `connect()` — a config with `access.agent === false` (or no `access`, fail-closed) throws the byte-identical error as an unknown config name. `getContext()` without a config returns the sole active connection if exactly one exists, or throws naming all active connections if there are multiple
- [`src/rpc/commands/changes.ts`](../../src/rpc/commands/changes.ts) — RPC commands: `change_history` (`permission: 'explore'`), `change_run` (`permission: 'change:run'`), `change_ff` (`permission: 'change:ff'`), `change_revert` (`permission: 'change:revert'`)
- [`src/rpc/commands/config.ts`](../../src/rpc/commands/config.ts) — RPC command: `list_configs` (`permission: 'open'`; filters out `access.agent === false` configs for the agent channel via `isVisibleToChannel`)
- [`src/rpc/commands/explore.ts`](../../src/rpc/commands/explore.ts) — RPC commands (all `permission: 'explore'`): `overview` (counts by object type), `list` (by category: tables/views/procedures/functions/types/indexes/foreignKeys/triggers/locks/connections), `detail` (full detail for one object)
- [`src/rpc/commands/query.ts`](../../src/rpc/commands/query.ts) — RPC command: `sql` (dispatch-gates on `'sql:read'`; `executeRawSql` itself classifies the statement and checks `sql:write`/`sql:ddl` against the config's resolved role for the session's channel)
- [`src/rpc/commands/run.ts`](../../src/rpc/commands/run.ts) — RPC commands: `run_build` (`permission: 'run:build'`, checksum-based, `force` to skip), `run_file` (`permission: 'run:file'`)
- [`src/rpc/commands/session.ts`](../../src/rpc/commands/session.ts) — RPC commands: `connect`, `disconnect`, `status` (all `permission: 'open'`). `status` reports `{ connections, activeConfig, activeConnected }`, resolving `activeConfig` the same way a bare `connect` would (env override, then state), and nulls it out on the agent channel when the config is hidden
- [`src/rpc/commands/index.ts`](../../src/rpc/commands/index.ts) — `registerAllCommands(registry)`; registers all 14 commands (3 session + 1 config + 3 explore + 1 query + 4 changes + 2 run) into the registry
- [`src/rpc/types.ts`](../../src/rpc/types.ts) — `RpcCommand` (carries `permission: Permission | 'open'`, `handler(input, session)`), `RpcCommandInfo`, `RpcExample`, `RpcSession` (carries `readonly channel: Channel`), `RpcError` type/class definitions
- [`src/rpc/index.ts`](../../src/rpc/index.ts) — barrel export; `createRegistry()` builds an `RpcRegistry` and calls `registerAllCommands`
- [`src/cli/mcp/index.ts`](../../src/cli/mcp/index.ts) — Citty `mcp` command group with subcommands `init` and `serve`
- [`src/cli/mcp/init.ts`](../../src/cli/mcp/init.ts) — `noorm mcp init [--agent claude|cursor] [--json]`; calls `generateMcpConfig`
- [`src/cli/mcp/serve.ts`](../../src/cli/mcp/serve.ts) — `noorm mcp serve`; calls `startServer()`, intentionally never calls `process.exit()` since stdin keeps the loop alive

## Docs

- [`docs/guide/automation/mcp.md`](../guide/automation/mcp.md) — MCP setup and usage guide
- [`docs/dev/headless.md`](../dev/headless.md) — headless/MCP usage patterns

## Coupling

- MCP server wraps the RPC registry — new RPC commands registered in [`src/rpc/commands/index.ts`](../../src/rpc/commands/index.ts) are automatically discoverable via `noorm_help` and callable via `run_noorm_cmd` with no further MCP-layer wiring.
- RPC commands delegate to core modules the same way CLI commands do (`ctx.noorm.changes.*` → `core-change`, `ctx.noorm.run.*` → `core-runner`, [`src/core/explore/operations.ts`](../../src/core/explore/operations.ts) → `core-db`, [`src/core/sql-terminal/executor.ts`](../../src/core/sql-terminal/executor.ts) → `core-identity`) — core API changes need RPC command updates in parallel with CLI changes.
- MCP dispatch gates every non-`'open'` `RpcCommand` via `checkConfigPolicy` from [`src/core/policy/`](../../src/core/policy) — `src/rpc/protection.ts` and `src/core/config/protection.ts` (the old protected-config rule checkers) were both deleted; policy is now the sole enforcement point.
- Every `RpcCommand` declares a `permission: Permission | 'open'` ([`src/rpc/types.ts`](../../src/rpc/types.ts)) — new RPC commands must pick a `core/policy` `Permission` or `'open'`, or the dispatch gate in [`src/mcp/server.ts`](../../src/mcp/server.ts) has nothing to check. [`tests/core/rpc/permissions.test.ts`](../../tests/core/rpc/permissions.test.ts) pins the exact `permission` value per command name against a hardcoded table, so a rename or reclassification must update that test too.
- `SessionManager` holds live `Context`/Kysely connections created via `createContext` from `sdk` ([`src/sdk/index.ts`](../../src/sdk/index.ts)) — connection lifecycle and config resolution errors (`configNotFoundMessage`) come from `core-config`'s resolver.
- [`src/cli/mcp/serve.ts`](../../src/cli/mcp/serve.ts) is the CLI entry; [`src/mcp/index.ts`](../../src/mcp/index.ts) (`startServer`) is the wiring; [`src/mcp/server.ts`](../../src/mcp/server.ts) is the MCP dispatch layer.
- [`src/cli/mcp/init.ts`](../../src/cli/mcp/init.ts) calls into [`src/mcp/init.ts`](../../src/mcp/init.ts)'s `generateMcpConfig`, which writes `.mcp.json`/`.cursor/mcp.json` — a `cli` domain command backed by mcp-rpc code.

## Conventions worth knowing

- MCP transport: stdio (JSON-RPC over stdin/stdout); `StdioServerTransport` from `@modelcontextprotocol/sdk`.
- `run_noorm_cmd` dispatches by command name string passed in its `command` field — command names are stable API surface. Its `config` field selects which active session/connection a command targets; for session commands (`connect`/`disconnect`) it is merged into the payload instead.
- For non-session commands invoked with a `config`, `createConfigScopedSession` in [`src/mcp/server.ts`](../../src/mcp/server.ts) wraps the `SessionManager` in a `Proxy` that intercepts only `getContext` to pin it to that config, forwarding all other session methods unchanged.
- `noorm_help` lists all registered commands with descriptions when called with no arguments, or full parameter/example detail for a single named command.
- `mcp init` writes `.mcp.json` (or `.cursor/mcp.json`) with a `noorm mcp serve` invocation for Claude Code / Cursor MCP discovery; existing files are merged, not overwritten.
- Zod schemas on each RPC command define the `payload` shape validated at dispatch time; validation failures return `{ error: 'Invalid payload', details: [...] }` with per-field Zod issue paths.
- Tests in [`tests/core/mcp/`](../../tests/core/mcp) cover `generateMcpConfig` (`init.test.ts`) and the full MCP dispatch pipeline via `InMemoryTransport` + `Client` (`server.test.ts`); [`tests/core/rpc/`](../../tests/core/rpc) covers registry behavior, command permissions, command handler logic, and session manager invisibility rules.
- `connect()` on the agent channel throws the identical `configNotFoundMessage` error (`core/config/resolver.ts`) for an unknown config and an invisible one (`access.agent === false` or missing `access`) — an agent cannot distinguish "doesn't exist" from "not permitted".
- `SessionInfo.role: Role` is the resolved role for the session's channel (`agent` resolves `access.agent`, `user` resolves `access.user`); an operator-role cell for the agent channel is still gated per-permission at dispatch, same as any other role.
