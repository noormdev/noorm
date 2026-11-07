---
type: Domain
reflects_rev: 43ecd2b9bfc709b22ab81b607d625326135ef738
description: Per-channel config authorization, role ceilings, and raw-SQL classification.
tags: [core, security, config]
---

# core-policy

## What it does

`core-policy` gives config-scoped actions a shared authorization contract across CLI, TUI, SDK, and MCP callers. Use it when deciding whether an action may proceed, whether a human must confirm it, or which permission raw SQL requires.

Roles belong to a config's `ConfigAccess`, not to an identity. `Channel` identifies who is driving (`user` or `agent`), independently of transport. `MATRIX` maps the selected role and permission to `allow`, `confirm`, or `deny`.

`checkConfigPolicy` rejects missing access, and `checkPolicy` rejects an invisible channel before consulting the matrix.

```mermaid
flowchart TD
    %% source: src/core/policy/check.ts, src/core/policy/matrix.ts
    C["checkConfigPolicy"] --> A{"config.access?"}
    A -->|absent| D["allowed: false"]
    A -->|present| P["checkPolicy"]
    P --> R{"access[channel]<br/>=== false?"}
    R -->|yes| D
    R -->|no| M["MATRIX[permission][role]"]
    M --> K["PolicyCheck"]
```

## How it works

### Permission cells

`MATRIX` is hard-coded, not user-extensible. The cells below apply before channel resolution.

| Permission | Viewer | Operator | Admin |
|---|---|---|---|
| `explore`, `sql:read`, `debug:read` | allow | allow | allow |
| `sql:write`, `vault:read`, `secret:read`, `transfer:plan` | deny | allow | allow |
| `sql:ddl` | deny | deny | allow |
| `change:run`, `change:ff`, `change:revert` | deny | confirm | allow |
| `run:build`, `run:file`, `run:dir` | deny | confirm | allow |
| `db:create`, `db:reset` | deny | confirm | allow |
| `vault:write`, `secret:write` | deny | confirm | allow |
| `change:rm`, `config:rm`, `config:write` | deny | confirm | confirm |
| `db:truncate`, `vault:propagate`, `lock:force` | deny | confirm | confirm |
| `db:destroy`, `db:teardown`, `debug:write` | deny | deny | confirm |

### Confirmation resolution

A `confirm` cell allows a human to proceed with `yes-<config>`, but denies an agent before consulting `NOORM_YES`.

```mermaid
flowchart TD
    %% source: src/core/policy/check.ts
    M{"MATRIX cell"} -->|allow| A["allowed: true"]
    M -->|deny| D["allowed: false"]
    M -->|confirm| C{"channel === agent?"}
    C -->|yes| D
    C -->|no| S{"shouldSkipConfirmations"}
    S -->|true| A
    S -->|false| P["confirmationPhraseFor<br/>yes-&lt;config&gt;"]
```

`checkConfigPolicy` returns the full `PolicyCheck`. `assertPolicy` throws when `allowed` is false; it does not prompt or enforce a positive `requiresConfirmation` result. Callers that present or require confirmation consume the full check.

### Channel provenance

`resolveChannel` accepts an exact `NOORM_CHANNEL` override before checking harness markers; invalid overrides fall through to detection.

```mermaid
flowchart TD
    %% source: src/core/policy/channel.ts, src/core/policy/harness.ts
    E{"NOORM_CHANNEL is<br/>user or agent?"} -->|yes| O["NOORM_CHANNEL"]
    E -->|no| H{"isAgentSession?"}
    H -->|yes| A["agent"]
    H -->|no| U["user"]
```

`detectAgentHarness` returns the first harness with a nonempty marker in `AGENT_HARNESSES`: Claude Code, Codex, Cursor, Gemini CLI, or generic `AI_AGENT`/`NOORM_AGENT`. `TERM_PROGRAM`, `CI`, and TTY state are not detection inputs. The MCP entrypoint supplies `agent` directly rather than calling `resolveChannel`.

### Role ceilings and access defaults

`clampToCeiling` caps each channel independently, preserving stricter input access. `roleRank` orders `false < viewer < operator < admin`; `false` is valid only for the agent channel. `PROTECTED_STAGE_CEILING` is `{ user: 'operator', agent: 'viewer' }`.

For each channel, `clampToCeiling` returns the existing role unless it exceeds that channel's ceiling.

```mermaid
flowchart TD
    %% source: src/core/policy/ceiling.ts
    C["clampToCeiling"] --> R{"roleRank comparison<br/>access[channel] &lt;=<br/>ceiling[channel]?"}
    R -->|yes| A["access[channel]"]
    R -->|no| L["ceiling[channel]"]
```

`resolveLegacyAccess` preserves explicit `access`. Otherwise, legacy `protected: true` maps to `GUARDED_ACCESS` (`{ user: 'operator', agent: 'viewer' }`); false or absent maps to `DEFAULT_ACCESS` (`{ user: 'admin', agent: 'viewer' }`). An unrestricted legacy flag does not grant agent admin. Config resolution, stage application, and persistence belong to [`docs/wiki/core-state.md`](core-state.md).

`guarded` reads only `access.user !== 'admin'` for display and rule matching. `formatAccessTag` returns `user:<role> agent:<role|off>`, or `null` for `DEFAULT_ACCESS`. An explicit agent-admin grant remains visible even when the user role is admin.

### Raw-SQL classification

`classifyStatements` tries `sql-parser-cst` first and uses keyword analysis when parsing fails. Both paths select the highest impact, ordered `read < write < ddl`.

```mermaid
flowchart TD
    %% source: src/core/policy/classify.ts
    C["classifyStatements"] --> E{"sql.trim() === empty?"}
    E -->|yes| R["read"]
    E -->|no| P{"parse succeeds?"}
    P -->|yes| T["classifyCst"]
    P -->|no| K["classifyKeyword"]
    T --> S["SqlClass"]
    K --> S
```

The CST path traverses nested statement nodes, including CTE bodies and statements wrapped by `EXPLAIN`. The fallback masks literals, quoted identifiers, and comments by dialect before splitting statements and classifying keywords. MSSQL uses the PostgreSQL grammar as a best effort, so dialect-specific syntax can reach the fallback.

`SELECT`, `SHOW`, and `DESCRIBE` normally classify as `read`; `INSERT`, `UPDATE`, `DELETE`, and `MERGE` classify as `write`. `EXPLAIN` inherits the wrapped statement's impact. Data-modifying CTEs upgrade an outer read, and `SELECT INTO` variants classify as `ddl`. Unknown statement forms, schema operations, `SET`, `EXEC`, and `CALL` classify as `ddl`; empty or comment-only input is `read`.

`DESTRUCTIVE_FUNCTIONS` upgrades known side-effecting or server-filesystem calls to at least `write`, including `pg_terminate_backend`, `lo_import`, `setval`, and `pg_read_file`. It is a denylist, not proof that an arbitrary function is read-only.

## Where it lives

| Path | Role |
|---|---|
| [`src/core/policy/types.ts`](../../src/core/policy/types.ts) | `Role`, `Channel`, `ConfigAccess`, `Permission`, `PolicyTarget`, `PolicyCell`, and `PolicyCheck`. |
| [`src/core/policy/matrix.ts`](../../src/core/policy/matrix.ts) | Permission cells for each role. |
| [`src/core/policy/check.ts`](../../src/core/policy/check.ts) | Policy checks, assertions, visibility, confirmation phrases, and access display helpers. |
| [`src/core/policy/channel.ts`](../../src/core/policy/channel.ts), [`src/core/policy/harness.ts`](../../src/core/policy/harness.ts) | Channel precedence and the harness marker allowlist. |
| [`src/core/policy/ceiling.ts`](../../src/core/policy/ceiling.ts) | Per-channel clamping and the protected-stage ceiling. |
| [`src/core/policy/legacy-access.ts`](../../src/core/policy/legacy-access.ts) | Default access pairs and legacy-input resolution contract. |
| [`src/core/policy/classify.ts`](../../src/core/policy/classify.ts) | CST and keyword classifiers with destructive-function detection. |
| [`src/core/policy/index.ts`](../../src/core/policy/index.ts) | Public policy exports. |
| [`tests/core/policy/check.test.ts`](../../tests/core/policy/check.test.ts) | Independently authored expected cells, confirmation, fail-closed checks, and display behavior. |
| [`tests/core/policy/channel.test.ts`](../../tests/core/policy/channel.test.ts), [`tests/core/policy/agent-escalation.test.ts`](../../tests/core/policy/agent-escalation.test.ts) | Provenance precedence and matching agent authorization across transport routes. |
| [`tests/core/policy/default-access.test.ts`](../../tests/core/policy/default-access.test.ts), [`tests/core/policy/visibility.test.ts`](../../tests/core/policy/visibility.test.ts) | Parsed and migrated access defaults, explicit grants, and visibility. |
| [`tests/core/policy/classify.test.ts`](../../tests/core/policy/classify.test.ts), [`tests/core/policy/classify-corpus.test.ts`](../../tests/core/policy/classify-corpus.test.ts) | SQL classification and assertions that adversarial inputs exercise the intended parser path. |
| [`docs/design/config-access-roles.md`](../design/config-access-roles.md) | Role-model rationale; implementation files define the current channel and default-access contract. |

## Constraints

- Missing `access` denies authorization on either channel. Treating visibility as authorization would bypass this: `isVisibleToChannel` always returns true for `user`, even without access.
- `agent: false` hides a config rather than assigning a role. Visibility filtering belongs upstream; `checkPolicy` still denies if the hidden channel reaches it.
- `NOORM_YES` can skip user confirmation, but cannot override `deny` or an agent's `confirm` cell. Applying it before channel resolution would reopen destructive actions to agents.
- `config:write` requires confirmation even for admin. Replacing that cell with `allow` would let an agent-admin config authorize its own access changes.
- `assertPolicy` enforces denial only. Using it as a confirmation gate would let an allowed user action proceed without consuming `requiresConfirmation`.
- Ceilings must retain already-stricter roles and agent invisibility. Replacing access with the ceiling directly would loosen a viewer config or expose a hidden one.
- `guarded` and `formatAccessTag` are display helpers, not authorization gates. They cannot distinguish the permissions or confirmation requirements of a requested action.
- Environment provenance is evadable and does not authenticate a caller. Treating harness detection as a security boundary would promise protection that environment variables cannot provide.
- An unlisted side-effecting function can remain `read`. Treating the SQL classifier as a database-grant boundary would permit effects outside its denylist.
- CST and fallback classification must preserve nested impact and dialect quoting. Checking only an outer `SELECT` or `EXPLAIN` can misclassify writes, while splitting raw quoted text can hide later statements.

## Coupling

- [`docs/wiki/core-state.md`](core-state.md) owns config schemas, stage resolution and materialization, settings rules, state access validation, and migration. Those callers share `ConfigAccess`, `resolveLegacyAccess`, and the ceiling helpers rather than defining their own role ordering or default pairs.
- [`docs/wiki/cli.md`](cli.md) owns command routing, channel resolution at entrypoints, and the create/sync workflows that consume stage access and policy checks. [`docs/wiki/tui.md`](tui.md) owns confirmation dialogs and access display.
- [`docs/wiki/core-change.md`](core-change.md) and [`docs/wiki/core-runner.md`](core-runner.md) consume command permissions through `assertPolicy`; raw-SQL classification is a separate permission-selection surface.
- [`docs/wiki/core-db.md`](core-db.md) owns database lifecycle and transfer gates that consume policy results. [`docs/wiki/core-identity.md`](core-identity.md) owns vault, secret, and SQL-terminal callers.
- [`docs/wiki/sdk.md`](sdk.md) and [`docs/wiki/mcp-rpc.md`](mcp-rpc.md) own their transport/context guards. Their channel and confirmation handling must agree with the policy contract rather than reinterpret matrix cells.
