import { createHelpOnlyCommand } from './_helpers.js';

export const help = `
# MCP

Model Context Protocol server for coding agents.

## Usage

    noorm mcp [subcommand]

## Subcommands

    serve       Start the MCP server (stdio transport)
    init        Generate agent configuration files

## Description

The MCP server lets coding agents (Claude Code, Cursor, Codex, etc.)
interact with your databases through noorm. Agents can explore schemas,
run queries, manage changes, and execute SQL files.

## Quick Start

    noorm mcp init                  Generate .mcp.json
    noorm mcp serve                 Start server (agents do this automatically)

See \`noorm help mcp serve\` and \`noorm help mcp init\`.
`;

export const run = createHelpOnlyCommand(help);
