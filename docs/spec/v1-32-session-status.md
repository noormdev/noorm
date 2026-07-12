# Spec: Session-status RPC command (v1 ticket 32)


## Goal

Agents get `connect`/`disconnect` over RPC (`src/rpc/commands/session.ts`, permission `open`) and can hold multiple named connections, but have no way to ask "what am I connected to right now." Add a read-only `status` command alongside `connect`/`disconnect` that returns the connected config names plus the active config. This gives `SessionManager.hasConnection` and `listConnections` (`src/rpc/session.ts:166,175`; declared at `src/rpc/types.ts:40-41`) their production callers, closing audit finding AP-yagni-06 productively (decision D9, tickets/v1/00-DECISIONS.md).


## Contract

New `RpcCommand` named `status` in `src/rpc/commands/session.ts`, appended to the `sessionCommands` array. It surfaces over MCP automatically: `createMcpServer` (`src/mcp/server.ts`) discovers registry commands at runtime via `registry.get()`/`registry.list()`, so no MCP-side registration is needed.

- `name: 'status'`
- `permission: 'open'` — targets no config; skips the policy gate, same as `connect`/`disconnect`/`list_configs`.
- `inputSchema: z.object({})` — no required input; `{}` must parse.
- `description` and `examples` follow the existing conventions in the file.

Return shape (exact):

    {
        connections: string[];        // session.listConnections() — connected config names
        activeConfig: string | null;  // what a bare `connect` would target (see resolution below)
        activeConnected: boolean;     // activeConfig !== null && session.hasConnection(activeConfig)
    }

**Active-config resolution** must match what a bare `connect` targets. `resolveConfig` (`src/core/config/resolver.ts:214`) resolves `options.name ?? getEnvConfigName() ?? state.getActiveConfigName()`; with no name passed that is:

    getEnvConfigName() ?? manager.getActiveConfigName() ?? null

where `manager` comes from `initState()` (same pattern and same `RpcError('Failed to load state', ...)` translation as the `list_configs` handler in `src/rpc/commands/config.ts:17-24`).

**MCP-channel invisibility** (consistency with `list_configs` filtering and `connect`'s byte-identical-error deny): when `session.channel === 'mcp'` and the resolved active config name is either unknown to state or its summary has `access.mcp === false`, report `activeConfig: null` (and therefore `activeConnected: false`). A config hidden from the mcp channel must not leak its name through `status`. No filtering is needed on `connections` — `connect` is the sole writer into the session map and already denies hidden configs on the mcp channel. The `user` channel reports the resolved name unfiltered.

Error handling per project ruling D1 / `.claude/rules/typescript.md`: named errors propagate; `attempt()` only where the error is translated (the `initState()` call). Never try-catch.


## Checkpoints

| # | Checkpoint | Verification |
|---|-----------|--------------|
| CP1 | Failing tests first at the RPC layer for the `status` handler (new file `tests/core/rpc/session-status.test.ts`, real-state pattern mirrored from `tests/core/rpc/list-configs.test.ts`) | Tests fail before implementation for the right reason (command absent), green after |
| CP2 | `status` command implemented in `src/rpc/commands/session.ts`, registered via `sessionCommands` | `createRegistry().get('status')` returns the command; return shape matches contract |
| CP3 | Registration side-effects pinned: `tests/core/rpc/permissions.test.ts` EXPECTED_PERMISSIONS gains `status: 'open'`; `tests/core/rpc/registry-integration.test.ts` expectedCommands gains `'status'`, count 13 -> 14, validInputs gains `status: {}` | Both files green |
| CP4 | Targeted suite + typecheck + lint green | Commands in `## Verification` below |


## Test coverage (CP1 detail)

In `tests/core/rpc/session-status.test.ts` (describe `'rpc commands: status'`, per `.claude/rules/testing.md` naming):

1. Empty session, no active config -> `{ connections: [], activeConfig: null, activeConnected: false }`.
2. `connections` reflects `session.listConnections()`.
3. `activeConfig` reflects state's active config (set via the real `StateManager`).
4. `NOORM_CONFIG` env var overrides state's active config (save/clear/restore the env var around tests).
5. `activeConnected: true` when the active config is among the connections (proves `hasConnection` delegation).
6. `activeConnected: false` when the active config is not connected.
7. mcp channel + active config with `access.mcp === false` -> `activeConfig: null`, `activeConnected: false`.
8. user channel + same hidden config -> name reported (no invisibility on user channel).
9. `inputSchema` accepts `{}`.

Use the real-state harness from `list-configs.test.ts` (tmpdir + `setKeyOverride` + `initState`/`resetStateManager`); mock only the `RpcSession` (`channel`, `listConnections`, `hasConnection`).


## Acceptance criteria (ticket 32, verbatim)

- Over MCP, an agent can call the status command and see connected configs + active config; test at the RPC layer mirrors the connect/disconnect tests.
- `hasConnection`/`listConnections` now have production callers (closes AP-yagni-06 the productive way; ticket 22's contingency on these methods is void).


## Out of scope

- No changes to `connect`/`disconnect` behavior.
- No new session state; `SessionManager` and `RpcSession` are not modified beyond gaining callers.
- No MCP server changes (`src/mcp/server.ts`) — the registry wrap already surfaces new commands.
- No CLI/TUI surface.


## Verification

Centralized testing protocol — only the affected RPC test files plus typecheck and lint. No test groups, no `tests/integration`, no docker.

    bun test --serial tests/core/rpc/session-status.test.ts tests/core/rpc/permissions.test.ts tests/core/rpc/registry-integration.test.ts tests/core/rpc/commands.test.ts tests/core/rpc/session.test.ts
    bun run typecheck
    bun run lint


## Change log

- 2026-07-12 — initial spec from tickets/v1/32-session-status-command.md, D9 ruling, AP-yagni-06 evidence.
