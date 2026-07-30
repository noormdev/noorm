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
npx skills add noormdev/noorm/skills
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

Config resolution and identity attribution work the same as the CLI. Access control does not: every command is gated by the config's **`agent` role** before its handler ever runs, and there is no confirmation flow — the agent gets an answer, not a prompt.


## Access Roles

Every config declares a role per channel: `access: { user, agent }`. The `agent` role decides what an AI agent can do to that config — independently of what a human gets in the CLI/TUI.

The channel names *who is driving*, not which binary was invoked. An agent that gets refused here and shells out to `noorm` on the command line is still an agent, and gets the same `agent` role: the CLI detects the harness it was spawned from. Raising or lowering `agent` therefore governs both routes at once. See [Access Roles](/guide/environments/configs#access-roles) for the detection rules and the `NOORM_CHANNEL` override.

A config that never declared `access` gets `{ user: 'admin', agent: 'viewer' }`. Agents can explore and read on a fresh project without any setup; anything that writes needs you to raise the `agent` role on purpose.

| Role | What the agent can do |
|------|------------------------|
| `viewer` | Explore schema, run read-only SQL (`SELECT`, `EXPLAIN`, `SHOW`, `DESCRIBE`) |
| `operator` | Everything `viewer` can, plus SQL writes (`INSERT`/`UPDATE`/`DELETE`) — destructive commands (`change_run`, `run_build`, etc.) are still out of reach |
| `admin` | Full access: writes, DDL, changes, builds — frictionless, no confirmation |
| `false` | Invisible — the config does not exist on this channel |

Raw SQL is classified by what the statement actually does (`sql:read` / `sql:write` / `sql:ddl`), not by which command the agent called — an agent with `agent: viewer` gets a `SELECT` through but a same-shaped `INSERT` denied.

The matrix's `confirm` cells never prompt on this channel — they resolve straight to **deny**. An agent typing its own confirmation phrase would be theater, not a safeguard, and on the CLI it would need only `--yes`. If an agent legitimately needs to run changes on a database, give that config `agent: 'admin'` — reserve it for configs where that's an acceptable risk (a disposable dev database, say), not production.

```yaml
# Shape of the config's `access` field — set via `noorm ui` → Config → Edit,
# or by editing the JSON before `config import` (see Config Sharing)
access:
    user: admin      # what you get in the CLI/TUI
    agent: viewer    # what any connected agent gets
```


## Invisible Configs

Set `access.agent: false` to hide a config from agents entirely — over MCP it never appears in `list_configs`, and `connect`/`getContext` fail with the same error an unknown config name would produce. `noorm config list` filters it the same way when an agent runs it. An agent enumerating configs cannot tell the difference between "doesn't exist" and "exists but is off-limits."


## Security

The MCP server uses the identity and config of the shell session that spawned it. It has no way to escalate privileges beyond what `noorm` itself can do, and it cannot escalate past the `agent` role a config was given — there is no `--force` override on this channel, and shelling out to the CLI reaches the same role rather than the human's.
