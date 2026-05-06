# MCP (AI Agent Integration)


noorm runs an [MCP](https://modelcontextprotocol.io/) server over stdio. AI coding agents connect to it and get access to schema inspection, queries, changes, and config management.


## Quick Start

```bash
# Generate config for your agent (default: Claude Code)
noorm mcp init

# Or for Cursor
noorm mcp init --agent cursor
```

This writes (or extends) the agent's MCP configuration file. The agent picks up the noorm server on next launch.


## How It Works

The MCP server wraps noorm's internal RPC registry (the same command set behind the TUI) over stdio transport. Your agent connects, calls `noorm_help` to list available commands, then executes them through `run_noorm_cmd`.

```
┌─────────────┐     stdio     ┌─────────────────┐     RPC      ┌──────────┐
│  AI Agent   │ ◄──────────► │  noorm mcp serve │ ◄──────────► │ Database │
└─────────────┘               └─────────────────┘              └──────────┘
```

The server stays alive as long as the agent's process keeps stdin open.


## Available Tools

The server exposes two MCP tools:

| Tool | Purpose |
|------|---------|
| `run_noorm_cmd` | Execute a noorm command (connect, sql, overview, list_configs, etc.) |
| `noorm_help` | List available commands and their parameter schemas |

Commands load from the RPC registry at runtime, so the tool list matches whatever noorm version you have installed.


## Setup by Agent

### Claude Code

```bash
noorm mcp init
```

Writes to `.mcp.json` in the project root. Claude Code reads this on startup.

### Cursor

```bash
noorm mcp init --agent cursor
```

Writes to `.cursor/mcp.json`.


## Manual Configuration

If you need to configure the server manually (e.g., for a custom agent), add this to your MCP config:

```json
{
    "mcpServers": {
        "noorm": {
            "command": "npx",
            "args": ["noorm", "mcp", "serve"]
        }
    }
}
```

The server uses stdio transport — no ports, no HTTP.


## What the Agent Can Do

Once connected, your agent can:

- **Explore schemas** — list tables, columns, foreign keys, indexes
- **Run SQL** — execute queries and get structured results
- **Manage configs** — list, switch, and validate connections
- **Apply changes** — run forward/revert migrations
- **Build schemas** — execute SQL files
- **Inspect templates** — see available context before rendering

Config resolution, protection checks, and identity attribution work the same as the CLI.


## Security

The MCP server uses the identity and config of the shell session that spawned it. It has no way to escalate privileges beyond what `noorm` itself can do.

Protected configs still block destructive operations. Your agent must pass `--force` (via the payload) to override protection, same as a human caller.
