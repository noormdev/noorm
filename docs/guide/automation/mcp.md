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

Pair it with the skill, which teaches the agent noorm's conventions rather than its tools:

```bash
npx skills add noormdev/noorm
```

MCP and the skill solve different halves of the same problem — MCP is what the agent can *do*, the skill is what it *knows*. An agent with MCP but no skill can query your schema and still write SDK code that wraps everything in `try`/`catch` this codebase never uses. See [Installation](/getting-started/installation#install-the-agent-skill-optional).


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

Config resolution and identity attribution work the same as the CLI. Access control does not: every command is gated by the config's **`mcp` role** before its handler ever runs, and there is no confirmation flow — the agent gets an answer, not a prompt.


## Access Roles

Every config declares a role per channel: `access: { user, mcp }`. The `mcp` role decides what an agent connected over this server can do to that config — independently of what a human gets in the CLI/TUI.

| Role | What the agent can do |
|------|------------------------|
| `viewer` | Explore schema, run read-only SQL (`SELECT`, `EXPLAIN`, `SHOW`, `DESCRIBE`) |
| `operator` | Everything `viewer` can, plus SQL writes (`INSERT`/`UPDATE`/`DELETE`) — destructive commands (`change_run`, `run_build`, etc.) are still out of reach |
| `admin` | Full access: writes, DDL, changes, builds — frictionless, no confirmation |
| `false` | Invisible — the config does not exist on this channel |

Raw SQL is classified by what the statement actually does (`sql:read` / `sql:write` / `sql:ddl`), not by which command the agent called — an agent with `mcp: viewer` gets a `SELECT` through but a same-shaped `INSERT` denied.

There is no human on the other end of stdio, so the matrix's `confirm` cells never prompt on this channel — they resolve straight to **deny**, with a message pointing at the CLI. An agent typing its own confirmation phrase would be theater, not a safeguard. If an agent legitimately needs to run changes on a database, give that config `mcp: 'admin'` — reserve it for configs where that's an acceptable risk (a disposable dev database, say), not production.

```yaml
# Shape of the config's `access` field — set via `noorm ui` → Config → Edit,
# or by editing the JSON before `config import` (see Config Sharing)
access:
    user: admin      # what you get in the CLI/TUI
    mcp: viewer      # what any connected agent gets
```


## Invisible Configs

Set `access.mcp: false` to hide a config from MCP entirely — it never appears in `list_configs`, and `connect`/`getContext` fail with the same error an unknown config name would produce. An agent enumerating configs cannot tell the difference between "doesn't exist" and "exists but is off-limits."


## Security

The MCP server uses the identity and config of the shell session that spawned it. It has no way to escalate privileges beyond what `noorm` itself can do, and it cannot escalate past the `mcp` role a config was given — there is no `--force` override on this channel.
