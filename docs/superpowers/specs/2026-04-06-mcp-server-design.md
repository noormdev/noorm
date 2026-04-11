# noorm MCP Server — Design Spec

Date: 2026-04-06


## Overview

Add an MCP (Model Context Protocol) server to the noorm CLI so coding agents (Claude Code, Cursor, Codex, OpenCode) can interact with any configured database through noorm. Agents explore schemas, run queries, manage changes, and execute SQL files — all dialect-agnostic, all protection-aware.

Two new CLI commands: `noorm mcp serve` (start stdio server) and `noorm mcp init` (generate `.mcp.json`).


## Architecture

Three layers with clear boundaries:

```
src/rpc/         → Transport-agnostic command registry (Zod-validated, maps to SDK/core)
src/mcp/         → MCP transport layer (2 tools wrapping the RPC registry)
src/cli/headless → CLI routing (mcp serve, mcp init)
```

- **RPC layer** defines all available commands declaratively — name, description, examples, Zod input schema, handler mapped to SDK/core operations. No CLI, no MCP, no Logger dependencies.
- **MCP layer** wraps the RPC registry in 2 MCP tools (`run_noorm_cmd` + `noorm_help`), keeping the MCP footprint minimal.
- **CLI integration** wires `noorm mcp serve` and `noorm mcp init` into the existing route system.


## Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Config scope | Multi-config (single server, all configs) | Tools accept `config` param. Agents explore across environments without multiple servers. |
| Tool count | 2 MCP tools | `run_noorm_cmd` dispatches to RPC registry. `noorm_help` generates docs from command definitions. Minimal footprint. |
| Command mapping | Direct SDK mapping | RPC commands call SDK/core functions directly. No CLI Logger dependency, no stdout capture. |
| Connection model | Session-based (stateful) | `connect`/`disconnect` commands. Agent holds a `Context` across calls. Kysely + tarn handle pooling. |
| SQL protection | `sql-parser-cst` with keyword fallback | Try CST parser first (PostgreSQL mode for MSSQL). Fall back to keyword-based if parser throws. |
| Registry style | Flat `Map<string, RpcCommand>` | Simple lookup for ~13 commands. Grouped by file, not by namespace. |
| Explore granularity | Consolidated (overview, list, detail) | 3 commands via `fetchOverview`, `fetchList`, `fetchDetail` with `category` param. |
| Help generation | RPC-generated from Zod schemas | Descriptions and examples defined per-command. Single source of truth. |
| Command surface | Full access minus locks | explore, sql, session, config, changes, run. Lock commands excluded from v1. |
| Validation | Once per boundary | MCP validates envelope (`command`, `config`). RPC validates command payload. No double validation. |


## RPC Layer (`src/rpc/`)


### Types (`types.ts`)

```typescript
interface RpcCommand<TInput = unknown, TOutput = unknown> {
    name: string;
    description: string;
    examples: RpcExample[];
    inputSchema: z.ZodType<TInput>;
    handler: (input: TInput, session: SessionManager) => Promise<TOutput>;
}

interface RpcExample {
    description: string;
    input: Record<string, unknown>;
}
```

Handlers receive a `SessionManager` for connection access. Commands don't create their own contexts — they request one from the session manager.


### Registry (`registry.ts`)

A `Map<string, RpcCommand>` with four operations:

- `register(command)` — adds a command
- `get(name)` — looks up by name
- `list()` — all commands with names and descriptions
- `getHelp(name)` — generates docs from description, Zod schema field descriptions, and examples


### Session Manager (`session.ts`)

Manages active database connections as a `Map<string, Context>`.

- `connect(config?: string)` — calls `createContext({ config })`, connects, stores keyed by resolved config name. Returns config summary (name, dialect, database, protected status). If `config` is omitted, resolves the active config from state.
- `disconnect(config?: string)` — disconnects and removes by config name. If no config specified, disconnects all.
- `getContext(config?: string)` — returns active context by config name. If `config` is omitted, returns the most recently connected context (or the only one if there's just one). Throws if not connected with actionable error ("not connected — call connect first").
- `disconnectAll()` — cleanup for server shutdown.

Kysely + tarn handle connection pooling internally. The session manager holds `Context` instances, not raw connections.

**`config` flow:** The MCP `run_noorm_cmd` tool accepts `config` in its envelope. For session commands (`connect`, `disconnect`), `config` is passed as the command payload. For all other commands, `config` is passed to `session.getContext(config)` to select which active connection to use. An agent must `connect` to a config before using it in other commands.


### Protection (`protection.ts`)

`isReadOnlyStatement(sql: string, dialect: Dialect): boolean`

Strategy: CST parser first, keyword fallback.

1. Map noorm dialect to `sql-parser-cst` dialect: `sqlite` → `sqlite`, `postgres` → `postgresql`, `mysql` → `mysql`, `mssql` → `postgresql` (best-effort)
2. Parse with `sql-parser-cst`. Walk the CST, check each top-level statement's `type` field.
3. Allowed types: `select_stmt`, `explain_stmt`, `show_stmt`, `describe_stmt`
4. If parser throws (unsupported syntax), fall back to keyword-based:
   - Strip `--` line comments and `/* */` block comments
   - Split on semicolons
   - Check each non-empty statement's leading keyword (uppercased)
   - Allowed keywords: `SELECT`, `EXPLAIN`, `SHOW`, `DESCRIBE`, `DESC`, `WITH` (only if final statement after CTE is SELECT)
5. Everything else is blocked on protected configs.


### Commands (`commands/`)

Each file exports an array of `RpcCommand` definitions.

> **Note on `config?` in the tables below:** `config` is not part of any command's Zod schema. It comes from the MCP envelope and is used by the MCP layer to select the active session context before calling the command handler. Session commands (`connect`, `disconnect`) are the exception — they accept `config` in their own schemas since they manage sessions directly.

**`session.ts`** — Session management (no DB query)

| Command | Input | Maps To |
|---------|-------|---------|
| `connect` | `config?` | `createContext()` + `ctx.connect()` |
| `disconnect` | `config?` | `session.disconnect()` |

**`config.ts`** — Config listing (no DB connection needed)

| Command | Input | Maps To |
|---------|-------|---------|
| `list_configs` | — | `initState()` + `getStateManager().listConfigs()` |

**`explore.ts`** — Schema exploration (requires active session)

| Command | Input | Maps To |
|---------|-------|---------|
| `overview` | `config?` | `fetchOverview(db, dialect)` |
| `list` | `category, config?` | `fetchList(db, dialect, category)` |
| `detail` | `category, name, schema?, config?` | `fetchDetail(db, dialect, category, name, schema)` |

`category` is the existing `ExploreCategory` union: `tables`, `views`, `procedures`, `functions`, `types`, `indexes`, `foreignKeys`, `triggers`, `locks`, `connections`.

**`query.ts`** — SQL execution (protection-aware)

| Command | Input | Maps To |
|---------|-------|---------|
| `sql` | `query, config?` | Protection check + `executeRawSql(db, query, configName)` |

On protected configs, validates SQL via `isReadOnlyStatement()` before execution. Blocks with clear error if not read-only.

**`changes.ts`** — Change management

| Command | Input | Maps To |
|---------|-------|---------|
| `change_history` | `config?` | `ctx.noorm.changes.history()` |
| `change_run` | `name, config?` | `ctx.noorm.changes.run(name)` |
| `change_ff` | `config?` | `ctx.noorm.changes.ff()` |
| `change_revert` | `name, config?` | `ctx.noorm.changes.revert(name)` |

**`run.ts`** — SQL file execution

| Command | Input | Maps To |
|---------|-------|---------|
| `run_build` | `config?` | `ctx.noorm.run.build()` |
| `run_file` | `path, config?` | `ctx.noorm.run.file(path)` |

**`index.ts`** — Imports all command arrays, registers each into the registry.


### File Structure

```
src/rpc/
├── index.ts              # Public API: registry instance, SessionManager
├── types.ts              # RpcCommand, RpcExample interfaces
├── registry.ts           # register(), get(), list(), getHelp()
├── session.ts            # SessionManager — Map<string, Context>
├── protection.ts         # isReadOnlyStatement() — CST + keyword fallback
└── commands/
    ├── index.ts           # Registers all commands
    ├── session.ts         # connect, disconnect
    ├── config.ts          # list_configs
    ├── explore.ts         # overview, list, detail
    ├── query.ts           # sql (protection-aware)
    ├── changes.ts         # change_history, change_run, change_ff, change_revert
    └── run.ts             # run_build, run_file
```


## MCP Layer (`src/mcp/`)


### Server (`server.ts`)

Uses `@modelcontextprotocol/sdk@^1.12.1`:
- `McpServer` from `@modelcontextprotocol/sdk/server/mcp.js`
- `StdioServerTransport` from `@modelcontextprotocol/sdk/server/stdio.js`

Registers two tools via `server.tool(name, description, schema.shape, handler)`.

**`run_noorm_cmd`**

```typescript
schema = z.object({
    command: z.string().describe('Command name: "connect", "overview", "sql", etc.'),
    config: z.string().optional().describe('Config name (defaults to active)'),
    payload: z.record(z.unknown()).optional().describe('Command-specific input'),
});
```

Handler:
1. Look up command from registry — if not found, return error listing available commands
2. Merge `config` into payload (RPC commands don't include `config` in their own schemas)
3. Validate payload against command's Zod schema — on failure, return Zod issue details
4. Call `command.handler(validatedInput, session)`
5. Return `{ content: [{ type: 'text', text: JSON.stringify(result) }] }`
6. On error: `{ content: [{ type: 'text', text: JSON.stringify({ error }) }], isError: true }`

**`noorm_help`**

```typescript
schema = z.object({
    command: z.string().optional().describe('Command name for detailed help. Omit to list all.'),
});
```

Handler:
1. If `command` provided: return `registry.getHelp(command)` — description, Zod-derived parameter docs, examples
2. If omitted: return `registry.list()` — all command names with descriptions


### Entry Point (`index.ts`)

```typescript
export async function startServer(): Promise<void> {
    const session = new SessionManager();
    const server = createMcpServer(session);
    const transport = new StdioServerTransport();

    process.on('SIGINT', () => session.disconnectAll());
    process.on('SIGTERM', () => session.disconnectAll());

    await server.connect(transport);
}
```

Never returns — stdio event loop keeps the process alive.


### Config Init (`init.ts`)

`noorm mcp init` generates or extends `.mcp.json` at the project root:

```json
{
    "mcpServers": {
        "noorm": {
            "command": "noorm",
            "args": ["mcp", "serve"]
        }
    }
}
```

- If `.mcp.json` does not exist, creates it with the structure above
- If `.mcp.json` exists, reads it, merges the `noorm` entry into `mcpServers`, writes back — does not touch other entries
- Accepts `--agent` flag for agent-specific paths (e.g., `.cursor/mcp.json` for Cursor)
- Resolves `command` from the running binary path


### File Structure

```
src/mcp/
├── index.ts              # startServer()
├── server.ts             # McpServer with run_noorm_cmd + noorm_help
└── init.ts               # .mcp.json generation/extension
```


## CLI Integration


### Route changes (`src/cli/types.ts`)

Add to the `Route` union:
```typescript
| 'mcp'
| 'mcp/serve'
| 'mcp/init'
```


### Headless commands (`src/cli/headless/`)

- `mcp.ts` — help-only parent via `createHelpOnlyCommand(help)`
- `mcp-serve.ts` — registered but bypassed (see stdio short-circuit below)
- `mcp-init.ts` — calls `src/mcp/init.ts`, outputs result via logger


### Handler registration (`src/cli/headless/index.ts`)

Import and register all three in `HANDLERS`.


### Stdio short-circuit (`src/cli/index.tsx`)

`runHeadless()` creates a Logger writing to stdout, which would corrupt MCP's JSON-RPC channel. In `main()`, before `runHeadless()`:

```typescript
if (route === 'mcp/serve') {
    await startServer();
    process.exit(0);
}
```

Bypasses the logger entirely. `mcp/init` goes through normal `runHeadless()`.


### Route parsing

`noorm mcp serve` → tokens `['mcp', 'serve']` → both pass `isRouteSegment()`, neither in `TERMINAL_ACTIONS` → route = `mcp/serve`. No parser changes needed. Same for `mcp/init`.


## Dependencies

| Package | Version | Purpose |
|---------|---------|---------|
| `@modelcontextprotocol/sdk` | `^1.12.1` | MCP server + StdioServerTransport |
| `sql-parser-cst` | latest | SQL statement classification for protection |

Added to root `package.json` `dependencies`. `zod@^4.3.6` already present.


## Error Handling

RPC command handlers use `attempt()` from `@logosdx/utils`:

```typescript
const [result, err] = await attempt(() => ctx.noorm.db.overview());
if (err) throw new RpcError('Failed to fetch overview', err.message);
```

The MCP layer catches all errors at the tool handler boundary. Errors always include `stack` — this is a local process, not exposed externally:

```typescript
const [result, err] = await attempt(() => command.handler(input, session));
if (err) {
    return {
        content: [{ type: 'text', text: JSON.stringify({ error: err.message, stack: err.stack }) }],
        isError: true,
    };
}
```

Error categories:
- **Validation errors** — Zod issue details with field paths and messages
- **Connection errors** — "not connected — call connect first"
- **Protection errors** — "config is protected — only SELECT, EXPLAIN, SHOW, DESCRIBE allowed"
- **SDK/core errors** — wrapped with context via `RpcError`, stack always included

No custom error class hierarchy beyond `RpcError`.


## Testing

- **`protection.ts` unit tests** — `isReadOnlyStatement()` edge cases: SQL comments, CTEs (`WITH...SELECT` allowed, `WITH...INSERT` blocked), multi-statement, mixed case, MSSQL-specific syntax triggering keyword fallback, semicolons
- **`registry.ts` unit tests** — register, get, list, getHelp
- **`session.ts` unit tests** — connect, disconnect, getContext when not connected, disconnectAll
- **Command integration tests** — each command file tested against real databases (Docker PG, MySQL, MSSQL)
- **MCP server test** — start server, send JSON-RPC over stdio, verify `tools/list` and tool call responses


## What This Spec Does NOT Cover

- Lock management commands (deferred past v1)
- HTTP/SSE transport (stdio only for now)
- MCP resources or prompts (tools only)
- TUI screen for MCP (headless only)
