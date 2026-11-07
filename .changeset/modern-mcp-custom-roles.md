---
'@noormdev/cli': minor
'@noormdev/sdk': minor
---

Support project-defined access roles and partial overrides of built-in viewer, operator, and admin permissions. Resolve inherited permissions consistently across guarded noorm APIs and preserve immutable protected-stage ceilings. Built-in defaults, including operator DML access, remain unchanged without explicit overrides.

Upgrade the stdio MCP server to protocol 2026-07-28 with discovery, per-request metadata, scoped human approval through form elicitation, JSON database exploration resources, and eight user-selected prompt cookbooks, including headless automation and test/deployment CI. Database calls require an explicit config; legacy initialization and MCP connect/disconnect/status commands are no longer supported. Approvals are short-lived, single-use, and bound to the request, target, effective policy, and captured executable content. Agent CLI confirm permissions remain denied even with yes flags; human confirmation paths remain available.

MCP migration: replace `run_noorm_cmd` with the individual tool named by `command`, moving `payload` fields alongside `config`. Replace `noorm_help` with `tools/list` and its schemas. The old tools have been removed. Clients must support the modern revision and pass an explicit config instead of establishing a database session. CLI and SDK release together in the repository's fixed version group.
