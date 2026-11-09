---
'@noormdev/cli': minor
'@noormdev/sdk': minor
---

Support project-defined access roles and partial overrides of built-in viewer, operator, and admin permissions. Resolve inherited permissions consistently across guarded noorm APIs and preserve immutable protected-stage ceilings. Built-in defaults, including operator DML access, remain unchanged without explicit overrides.

The SDK `Role` type accepts custom role names. Resolved configs carry non-enumerable policy context; detached copies without it are denied by guarded operations. Malformed stored access is preserved for diagnosis and repair rather than silently replaced.

Vault set, propagate, copy, and identity enrollment require `vault:read` when they unseal an existing vault key. Secret writes do not require secret read, and initializing a fresh vault can use write-only access.

Manage role definitions in the TUI under Settings → Access Roles. Create custom roles, edit inheritance and permission overrides, preview effective permissions and protected-stage ceilings, reset built-in overrides, and remove unused custom roles with confirmation.

Display the TUI Settings overview as a responsive table with separate section, purpose, and current-value columns. Preserve number-key navigation and keep long values from shifting adjacent columns.

Upgrade the stdio MCP server to protocol 2026-07-28 with discovery, per-request metadata, scoped human approval through form elicitation, JSON database exploration resources, and eight user-selected prompt cookbooks, including headless automation and test/deployment CI. Database calls require an explicit config; legacy initialization and MCP connect/disconnect/status commands are no longer supported. Approvals are short-lived, single-use, and bound to the request, target, effective policy, and captured executable content. Agent CLI confirm permissions remain denied even with yes flags; human confirmation paths remain available.

Approved template changes retain the checksum of the captured source while executing the captured rendered SQL, so subsequent ordinary change runs recognize unchanged templates. Ordinary file runs continue tracking rendered output.

Check every SQL permission represented in a batch, including nested writes, before execution. Allowed DDL cannot mask denied writes or skip required write confirmation.

MCP migration: replace `run_noorm_cmd` with the individual tool named by `command`, moving `payload` fields alongside `config`. Replace `noorm_help` with `tools/list` and its schemas. The old tools have been removed. Clients must support the modern revision and pass an explicit config instead of establishing a database session.

The read permissions `explore` and `sql:read` apply to the agent channel only; the user channel always reads them as allowed. On the agent channel, `explore` now gates every schema read and change-history read in the CLI, SDK, and MCP, including the table listing behind `db transfer --export` when `--tables` is omitted. `db.previewTeardown()` checks `db:teardown` the way `teardown({ dryRun: true })` does; a role that may not tear down cannot preview. A protected stage keeps its ceiling when the caller passes an explicit `stage`, when a config is copied or renamed to an unprotected name (now refused), and on SDK transfer and vault destinations. MCP approvals redact only the password and SSL material; user and database names stay visible. When the active config has malformed access, the TUI stays usable and Home names `noorm config repair-access <name>`.

Named SQL pipelines have their own `pipeline:run` permission (viewer deny, operator confirm, admin allow) instead of borrowing `run:dir`, so a role can run pipelines without directory runs and the reverse. On the agent channel, `pipelines.history`, `getRun`, and `noorm pipeline history`/`show` now require `explore`.
