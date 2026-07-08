---
id: policy-denial-observability
title: Policy denials leave no server-side trace; MCP server never inits logger
created: "2026-07-08"
origin: |
    challenge-swarm #40 (ops F3/F4)
kind: finding
severity: risk
review_by: "2026-09-06"
status: open
file: src/mcp/server.ts:106; src/mcp/index.ts:12
---

Denied actions (MCP gate, checkPolicy, SDK guards) emit no event/log. The MCP server process never calls enableAutoLoggerInit (only ui.ts and sql/repl.ts do), so even an added denial event would not record. Ops cannot answer 'which agent actions were denied on prod this week'. mcp:false invisibility has no ops-facing counterpart either: hidden-vs-typo'd config is indistinguishable server-side. Add a stderr/log (never the MCP response) denial trace and wire the MCP logger.
