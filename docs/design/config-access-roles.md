# Per-config access roles

Issue: https://github.com/noormdev/noorm/issues/40


## Problem


Access control is a single `protected: boolean` per config. It cannot express intermediate access levels, cannot give different levels to different callers on the same config, and cannot hide a config from MCP entirely. Enforcement is also scattered: only `sql`/`run_sql` check `protected` on the MCP path — `change_run`, `change_ff`, `change_revert`, `run_file`, and `run_build` reach `ctx.noorm.*` with no gate, and `checkProtection` has no runtime callers at all.


## Model


Roles live on the config, not the actor. The actor is just a **channel** — who is asking:

- `user` — CLI, TUI, and SDK (`createContext` defaults here)
- `mcp` — the MCP server

Each config declares what each channel gets:

    access: {
        user: 'viewer' | 'operator' | 'admin',
        mcp:  false | 'viewer' | 'operator' | 'admin',
    }

`mcp: false` means invisible: absent from `list_configs`, and `connect` fails with the byte-identical error an unknown config produces. Omission must not leak existence. `mcp: 'viewer'` is the softer posture — the agent sees schema and reads, touches nothing.

The `access: {}` grouping (rather than flat top-level `user:` / `mcp:` keys) is deliberate: a top-level `user` key would sit lines away from `connection.user` (the database login) and read ambiguously.


## Role matrix


Hard-coded. Cells: allow (✓) / confirm / deny (✗). Not user-extensible.

| permission | viewer | operator | admin |
|---|---|---|---|
| explore | ✓ | ✓ | ✓ |
| sql:read | ✓ | ✓ | ✓ |
| sql:write | ✗ | ✓ | ✓ |
| sql:ddl | ✗ | ✗ | ✓ |
| change:run / change:ff | ✗ | confirm | ✓ |
| change:revert | ✗ | confirm | ✓ |
| run:build / run:file / run:dir | ✗ | confirm | ✓ |
| db:create | ✗ | confirm | ✓ |
| db:reset | ✗ | confirm | ✓ |
| db:destroy | ✗ | ✗ | confirm |
| config:rm | ✗ | confirm | confirm |

`confirm` is channel-resolved:

- **user channel** — prompt for `yes-<config>` (the phrase `protected` used to own). `NOORM_YES=1` still skips it, so CI is unaffected.
- **mcp channel** — collapses to deny, with a message directing to the CLI. There is no human on the other end of stdio; an agent typing its own confirmation phrase is theater. An agent that legitimately needs to run changes on a dev database gets `mcp: 'admin'` on that config — dev is disposable.

The confirm-in-role design is what lets `protected` die without losing the prod guardrail: `operator` *is* "can do it, but types `yes-prod` first"; `admin` is frictionless. A human on an `operator` config cannot ad-hoc DDL prod — they go through a change file. That is a posture, not a limitation.


## SQL classification


Raw SQL (`sql`, `run_sql`) is gated by what the statements actually do. Generalize the existing `isReadOnlyStatement` (sql-parser-cst first, keyword fallback) into:

    classifyStatements(sql, dialect) → 'read' | 'write' | 'ddl'

- Statement classes: SELECT/EXPLAIN/SHOW/DESCRIBE → `read`; INSERT/UPDATE/DELETE/MERGE → `write`; CREATE/ALTER/DROP/TRUNCATE/GRANT/REVOKE → `ddl`.
- Multi-statement input takes the highest class present.
- Unparseable input or unknown statement types classify as `ddl` — **fail closed**.
- `EXEC` / `CALL` classify as `ddl`. A stored procedure is opaque and can do anything; fail-closed wins. This is painful for proc-heavy MSSQL shops and is the first cell to revisit with real usage — but loosening later is safe, tightening later is a breaking change.

The classifier applies **only** to the raw-SQL surface. Change files and run files are command-gated (`change:*`, `run:*`), not content-classified. The resulting posture is coherent with the product premise: ad-hoc DML is a role question, but DDL only travels through tracked, revertible change files.


## Enforcement


One function in core:

    checkPolicy(channel, config, permission) → { allowed, requiresConfirmation, confirmationPhrase?, blockedReason? }

Same result shape as the old `ProtectionCheck`, so confirm-dialog plumbing carries over.

- **MCP**: `RpcCommand` gains a required `permission` field. A single gate in `run_noorm_cmd` dispatch resolves (channel, config, command.permission) before any handler runs. Every current and future command is covered by construction — the class of bug where a new command forgets its check cannot exist.
- **CLI/TUI**: same `checkPolicy`, prompting on `confirm`.
- **SDK**: `createContext` stamps channel `user`. Side effect worth having: a `viewer` config is read-only even from application code — enforced above the driver, belt to the DB-grant suspenders.
- **Invisibility**: `list_configs` filters `mcp: false` configs for the mcp channel; `SessionManager.connect`/`getContext` reject them with the unknown-config error.


## Settings stages and display


Scoping surfaced two `protected` consumers beyond the config itself; both get explicit mappings rather than silent deletion:

- **Stage defaults** (`settings.yml`) may set `protected: true`, and stage enforcement forbids overriding it to `false`. The stage keyword survives as authoring vocabulary, redefined as an **access ceiling**: a stage with `protected: true` clamps resolved access to at most `{ user: 'operator', mcp: 'viewer' }`. A config may be stricter (`viewer`, `mcp: false`), never looser. Adding full `access` blocks to stage defaults is a separate issue.
- **Rule matching and display** need a one-word notion of "this config is guarded." Defined as `guarded(config) := access.user !== 'admin'`. Settings rules' `match.protected` matches `guarded`, TUI yellow-border styling keys off `guarded`, and `config list`'s `[protected]` tag becomes the access levels.

The SDK's existing destructive-op guards (`src/sdk/guards.ts`) stop consulting `protected` and consult `checkPolicy` on the `user` channel — one enforcement path, not two.


## Migration


`protected` dies as a concept. On state load, one version migration maps it:

- `protected: true`  → `access: { user: 'operator', mcp: 'viewer' }`
- `protected: false` → `access: { user: 'admin',    mcp: 'admin'  }`

Both preserve today's observed behavior, with one intended tightening: protected configs newly deny MCP `change_run` et al. — that is the enforcement-gap fix riding along. The stored field is parsed and migrated for one version, then removed from types and code.


## Out of scope


- User-defined or custom roles — the set is fixed in the app.
- Identity/authn — channel is process context; no user accounts.
- Content-classifying change/run files — they are command-gated by design.
