# Spec: per-config access roles

Design: `docs/design/config-access-roles.md` · Issue: noormdev/noorm#40

The body of this spec is current truth. Superseded decisions live only in the change log.


## Objective


Replace `Config.protected: boolean` with config-scoped, channel-keyed roles enforced by one central policy check. Add MCP invisibility (`agent: false`). Gate raw SQL by statement classification. Close the existing gap where MCP `change_run`/`change_ff`/`change_revert`/`run_file`/`run_build` bypass protection entirely. Let a project define its own roles in `settings.yml`, and serve MCP as a stateless `2026-07-28` server whose tools take an explicit config and ask a human to approve `confirm` cells.


## Data model


    type Role = string // built-in or defined in settings.yml
    type Channel = 'user' | 'agent'

    interface ConfigAccess {
        user: Role;
        agent: Role | false;
    }

- `Config.access` is required after parsing. Absent assignments default to `{ user: 'admin', agent: 'viewer' }`; explicitly malformed access is rejected rather than repaired to an overrideable role.
- `ConfigSummary` carries `access: ConfigAccess`. Config imports/exports retain custom role names; role definitions remain project settings.
- Effective policy, immutable stage ceilings, and project/connection identity are bound to non-enumerable access metadata during resolution and SDK context construction. They are not persisted or exported. Legacy `protected` input is migrated; it is not a current Config field.
- Enforcement code must not trust the optionality: on the `agent` channel, a config with absent `access` is **denied** (fail closed) — in practice unreachable, since configs reach enforcement via parse/migration.
- `Channel` names who is driving, not the transport. `resolveChannel(env?)` resolves `NOORM_CHANNEL`, then recognized agent-harness provenance, then `user`. MCP explicitly creates request contexts on `agent`, even under `NOORM_CHANNEL=user`; the interactive TUI uses `user`. Provenance detection is a safer default, not protection against an actor controlling the environment and database credentials.
- Stored state migrates `access.mcp` to `access.agent` at schema v3, preserving `false`. Malformed explicit access is preserved and diagnosed, not automatically replaced with `viewer`. `StateManager.repairConfigAccess` replaces malformed access while preserving other config data and secrets; removal also deletes config secrets. `StateManager` refuses to overwrite a config whose stored access is malformed. When the active config is malformed, the TUI stays usable: it treats that config as not active and shows a Home warning that names `noorm config repair-access <name>`.


## Permissions and matrix


The 27 permissions and their defaults are defined by `MATRIX` in `src/core/policy/matrix.ts`.

The default matrix below is defined in `src/core/policy/`. Project settings can override individual built-in cells and define additional roles:

```yaml
access:
  roles:
    operator:
      permissions:
        sql:write: confirm
    deployer:
      extends: operator
      permissions:
        run:build: allow
```

Built-in overrides preserve all unspecified defaults and cannot use `extends`. Custom roles may extend any known role (including another custom role), inheriting its effective project policy; without `extends`, unspecified permissions deny. Invalid permissions or values, unknown parents and inheritance cycles are rejected. Assign custom roles through the existing config access fields; `agent: false` still hides the config.

The user channel always reads `explore` and `sql:read` as `allow` (`USER_ALWAYS_ALLOWED` in `src/core/policy/matrix.ts`): the person at the keyboard can loosen any role, so gating those reads adds friction only. The cells apply to the `agent` channel alone, and the Access Roles editor labels them as agent-channel cells.

For protected stages, each effective cell is capped by the original, unmodified operator matrix for users or viewer matrix for agents (`deny` is stricter than `confirm`, which is stricter than `allow`). Overrides cannot relax this ceiling, and role names remain unchanged. Unknown assigned roles fail closed. The one exception to the ceiling is the `isTest` relaxation (item 6a). The ceiling applies when any of three sources marks the stage protected: the stage bound by the resolver, the config's own name, or an explicit `stage` option. A caller option can add restriction and never remove it. Copying or renaming a config from a protected stage to an unprotected name is refused at `StateManager` (`ProtectedStageEscapeError`), which is what CLI `config cp` and the TUI copy and rename screens delegate to. SDK transfer and vault destinations keep the ceiling through `bindSdkPolicy` in `src/sdk/guards.ts`.

Human confirmation can be supplied through interactive or yes-mode user flows; an agent cannot self-confirm with `--yes` or `NOORM_YES`.

The TUI exposes role definitions under **Settings → Access Roles**. It lists implicit built-ins alongside custom roles, supports per-permission overrides and custom-role inheritance, and previews the effective cells with protected-stage user/agent ceilings. Saving validates the entire role map before persistence. Resetting a built-in removes its overrides, never the built-in role; deleting a custom role requires confirmation and no config or inheritance references. Cancelling an editor or confirmation leaves settings unchanged.

| permission | viewer | operator | admin |
|---|---|---|---|
| explore | allow | allow | allow |
| sql:read | allow | allow | allow |
| sql:write | deny | allow | allow |
| sql:ddl | deny | deny | allow |
| change:run, change:ff | deny | confirm | allow |
| change:revert | deny | confirm | allow |
| run:build, run:file, run:dir | deny | confirm | allow |
| pipeline:run | deny | confirm | allow |
| db:create | deny | confirm | allow |
| db:reset | deny | confirm | allow |
| db:destroy | deny | deny | confirm |
| config:rm | deny | confirm | confirm |
| change:rm | deny | confirm | confirm |
| db:truncate | deny | confirm | confirm |
| db:teardown | deny | deny | confirm |
| config:write | deny | confirm | confirm |
| vault:read, secret:read, transfer:plan | deny | allow | allow |
| vault:write, secret:write | deny | confirm | allow |
| lock:acquire | deny | allow | allow |
| vault:propagate, lock:force | deny | confirm | confirm |
| debug:read | allow | allow | allow |
| debug:write | deny | deny | confirm |

    type PolicyTarget = { name: string; access: ConfigAccess }
    checkPolicy(channel: Channel, target: PolicyTarget, permission: Permission): PolicyCheck
    // PolicyCheck = { allowed, requiresConfirmation, confirmationPhrase?, blockedReason? }

Enforcement requires the non-enumerable policy context attached to a resolved config. A detached copy or manually constructed target without that context is denied; spreading or serializing a config does not preserve it.

Channel resolution of `confirm`:

- `user`: `allowed: true, requiresConfirmation: true, confirmationPhrase: 'yes-<config.name>'`. `NOORM_YES=1` (`shouldSkipConfirmations()`) resolves it to plain allow.
- `agent`: ordinary policy checks return `allowed: false` for `confirm`; agent CLI and SDK calls cannot self-confirm, and `NOORM_YES` has no effect. MCP may mediate approval by a human through a supporting client; rejection or unavailable approval denies the action. A `deny` cell is never approvable.

`agent: false` is not a role: policy is never consulted for an invisible config — visibility is enforced before policy (see Enforcement).

Helper: `guarded(config): boolean = config.access.user !== 'admin'` — used by TUI styling and settings rule matching. Display-only; never an enforcement input.

The `config list` access tag is keyed to the default instead: `formatAccessTag` renders `user:<role> agent:<role|off>` for any config whose access differs from the default, and `null` otherwise. `guarded` cannot drive it, because `agent: 'admin'` is an escalation the user channel can't see.


## SQL classification


    classifyStatements(sql: string, dialect: Dialect): 'read' | 'write' | 'ddl'
    sqlPermissionsFor(sql: string, dialect: Dialect): Permission[]

Lives in `src/core/policy/classify.ts` (moved and generalized from `src/rpc/protection.ts`; that file is deleted once callers are rewired).

- CST first (`sql-parser-cst`), keyword fallback when the parser throws (existing strategy, including CTE handling).
- read: SELECT, EXPLAIN, SHOW, DESCRIBE/DESC. write: INSERT, UPDATE, DELETE, MERGE. ddl: everything else that parses (CREATE, ALTER, DROP, TRUNCATE, GRANT, REVOKE, SET, …).
- **Data-modifying CTEs**: a `WITH` whose any sub-statement is INSERT/UPDATE/DELETE/MERGE takes that sub-statement's class, even when the outer statement is `SELECT`. A `viewer`'s "touches nothing" guarantee requires this — `WITH t AS (DELETE … RETURNING …) SELECT * FROM t` is a write. Detect the DML node in the CST (and in the keyword fallback, a data-modifying keyword anywhere at CTE-definition depth), do not key only off the final keyword.
- **Side-effecting functions**: a call to a function on the `DESTRUCTIVE_FUNCTIONS` denylist (`src/core/policy/classify.ts`) requires `sql:write`, whether bare (`pg_terminate_backend(…)`) or schema-qualified (`pg_catalog.pg_terminate_backend(…)`). The list includes known side-effecting builtins and server-file readers such as `pg_read_file` and `pg_ls_dir`. This is deliberately a denylist, not an allowlist: `SELECT f()` is statically undecidable, so pure helpers (`count`, `now`, `coalesce`, …) stay `read` and unlisted side-effecting or disclosure functions are not blocked. The role is a guardrail, not an airtight sandbox; operators needing hard confidentiality or write isolation must use database-level `GRANT`s.
- Multi-statement input: authorization requires **every** represented permission, including nested statements and known dangerous calls. A denied permission blocks the entire batch even if another is allowed or confirmed; every permission requiring confirmation must be included in the approval before any statement runs. For example, `DELETE ...; CREATE TABLE ...` requires both `sql:write` and `sql:ddl`. The highest class (read < write < ddl) remains available for display, never as the authorization verdict.
- Dialect guardrails expand MySQL executable comments and lexically cross-check MSSQL batches. `SELECT ... INTO` requires `sql:ddl`; quoted strings and identifiers are handled as dialect-specific non-code regions.
- Empty input: `read`. Unparseable input, unknown statement type, `EXEC`/`CALL`: `ddl` — fail closed.
- Applies to the ad-hoc raw-SQL surfaces: the `sql` RPC command and the TUI SQL terminal. Change/run files are command-gated (trusted, tracked artifacts), never content-classified.


## Enforcement


1. **RPC**: each command declares `permission: Permission | 'open'`. MCP exposes config listing, exploration, SQL, run, and change commands as individual tools. There is no session state and no `connect`, `disconnect`, or `status` command.
2. **MCP gate**: every database request supplies an explicit config. Dispatch resolves current settings/configuration and checks the effective cell. SQL uses its classified permission before execution; `change_ff` also checks `change:run`. `allow` executes, `deny` blocks, and `confirm` uses MRTR form elicitation. The approval binds the exact operation, target, project, effective policy, and prepared executable content, expires after five minutes, and is consumed once. Only validated approval establishes a scoped grant honored by inner guards; it cannot override a `deny`.
3. **Protocol**: stdio uses MCP `2026-07-28`, `server/discover`, per-request metadata, modern result/cache fields, and no initialization handshake. Legacy clients are rejected. Request contexts/connections are released after each operation. Approval prompts redact secrets only (password and SSL material); user and database names stay visible so the approver can see the target. Config-qualified JSON metadata resources use the same `explore` permission and approval path.
4. **Invisibility**: `agent: false` configs are omitted from tool/resource discovery and unavailable to direct MCP reads/calls. Ordinary agent CLI calls still deny every `confirm`, even with yes flags; only MCP collects human approval through the supporting client.
5. **SDK**: guarded noorm APIs enforce the config's effective role for `options.channel` (default `user`). They have no prompt: unresolved confirmation fails unless supplied through a valid internal scope or user-channel `yes` mode. Agent yes mode never supplies consent. Direct `ctx.kysely` and routine calls remain a database-credential boundary, not intercepted role enforcement. Run/change permission continues authorizing internal template secret resolution; direct vault/secret retrieval APIs have their own read permissions.
5a. **Core-seam enforcement** (the "enforced above the driver" promise): the user-channel gate lives at the core boundary each surface funnels through — `runFile`/`runFiles` (`core/runner`), data transfer (`core/transfer`), the SQL terminal executor (ad-hoc SQL → `classifyStatements` then gate), and `changes.run`/`ff`/`revert` (`core/change`). The `Context` carries its `Channel`, so SDK, TUI, and CLI callers all inherit one enforcement path rather than each re-implementing checks per screen/namespace. Run/change files gate on their command permission (not content-classified); only the ad-hoc SQL terminal is classified.
5b. **Explore gate**: reads behind `explore` take a required `gate` parameter in `fetchOverview`/`fetchList`/`fetchDetail` (`core/explore`). `truncateData` and `teardownSchema` pass the `GATED_BY_CALLER` sentinel as `gate` for their object-inventory reads, so their own `db:*` check governs the read instead of `explore`. The SDK's `runGatedExplore` wraps the `db.*` explore methods and `changes.history`/`historyForChange`/`getFileHistory` and `pipelines.history`/`getRun`; `db.previewTeardown` checks `db:teardown` (deny only) on every channel. The user channel always passes `explore` and `sql:read`.
5c. **Tracking tables**: `RECORDS_TO_TRACKING` (`src/core/policy/matrix.ts`) classifies every permission, and `TRACKED_WRITES` (`src/core/policy/check.ts`) is the list it marks as recording to noorm's tracking tables: `change:run`, `change:ff`, `change:revert`, `change:rm`, `run:build`, `run:file`, `run:dir`, `pipeline:run`, `db:create`, `db:reset`, `db:teardown`, `vault:read`, `vault:write`, `vault:propagate`, `lock:acquire`, `lock:force` and `debug:write`. `vault:read` is on the list because a vault reader is enrolled in the identities table, which is how propagation reaches it. `mayWriteTracking(channel, config)` is true when the caller has a writable cell for at least one of them. `allow` is writable on both channels. `confirm` is writable on the user channel, and on the agent channel only under a validated human approval (item 2), because an agent cannot confirm by itself. `prepareTrackingSchema` (`src/core/version/tracking.ts`) creates or migrates the tables for such a caller outside a dry run. Any other caller, and any dry run, creates and migrates nothing: a database with no tracking tables reads as empty, and tables that need a migration throw an error that names the current and the required schema version. Config activation (`syncIdentityWithConfig`) follows the same rule and registers no identity for a caller that cannot write. The SDK readers `lock.status`, `changes.history`, `changes.historyForChange`, `pipelines.history` and `pipelines.getRun` never create or migrate and throw the same versions error, ending `Reading <lock status | change history | pipeline history> does not migrate them: a role that can write must run a command once first.` SDK writes reach `prepareTrackingSchema` through `ensureTracking`, so an SDK dry run or preview on tables that need a migration throws the dry-run versions error. `lock.status` has no permission gate, but it refuses on a config hidden from the channel and deletes an expired lock only for a caller with `lock:acquire`.
6. **CLI/TUI**: inherit enforcement from the core seam (5a). The TUI lock acquire, release and force screens show the confirmation dialog when the `lock:acquire` or `lock:force` cell is `confirm`. `SmartConfirm` takes `requiresConfirmation` + `confirmationPhrase` instead of `protected: boolean`; `ProtectedConfirm` keeps the `yes-<config>` phrase flow, driven by `confirmationPhrase` — sourced from one `confirmationPhraseFor(name)` helper in `src/core/policy/`, never re-templated per screen. The matrix is the enforcement **floor** — screens may keep stricter confirm UX than the cell requires (TUI teardown/truncate retain their unconditional phrase-confirm for all roles, and additionally deny when `checkConfigPolicy('user', config, 'db:reset')` says deny).
6a. **isTest relaxation**: on a config whose `isTest` is true and whose assigned role resolves (built-in, or defined in `settings.yml`), every role, built-in or custom, reads the looser of its own cell and the project's admin cell (built-in admin plus any `settings.yml` override) for every permission on both channels, past the protected-stage ceiling, so an agent can build, change and test its own test database. `db:create`, `db:reset`, `db:truncate`, `db:teardown`, and `db:destroy` resolve to `allow` even where admin's cell is `confirm`. Admin's other `confirm` cells (`config:write`, `config:rm`, `change:rm`, `vault:propagate`, `lock:force`, `debug:write`) stay `confirm` unless the role's own cell is looser, and an agent cannot supply a confirmation. An unknown role still fails closed. `getConfigPermission` applies the relaxation from `PolicyContext.isTest`, which `bindPolicyContext` takes only from a trusted source: the stored config's own `isTest`, a stage default from `settings.yml`, or an env-only config. It holds only while the connection target (dialect, host, database, filename) is the one the trusted source declares; a port counts only when that source declares one, and an env or flag override of the target gives `false`. A rebind keeps a bound `isTest` while the credential-free target is unchanged (`PolicyContext.testTargetIdentity`), so changing only user or password keeps it. A stage default with `isTest: true` decides only when the stage declares a database; one that declares none falls under the env-only rule. An env-only `isTest` counts only when no stored config has that name, no stage declares `isTest: false` for it, no stage with `isTest: true` declares a database, no stage in play is protected, and the connection target (database, plus host on server dialects) comes from env or flags; otherwise the stored or stage value, else `false`. An env-only config whose name a stored config has is refused, whichever source supplied the name (the SDK context `name` in `ResolveOptions.unstoredName`, `flags.name`, `NOORM_NAME`, or the `__inline__` or `__env__` fallback), because local secrets, vault lookups and tracking records are keyed by config name; `NOORM_CONFIG` or the `config` option selects the stored config instead. `flags.name` outranks `NOORM_NAME`. On a selected stored config the same rule holds for the overlay: `NOORM_NAME` or `flags.name` may rename it to a name no stored config has, and is refused when another stored config has that name. Both that name and the one it displaced (`flags.name`, else `NOORM_NAME`, else `__inline__` or `__env__`) are checked: the stages of both feed the `isTest: false` check and the protected-stage ceiling, and when a stored config exists under the displaced name, `envOnlyIsTest` grants the flag only if it has `isTest: true` and the resolved target. The context name never selects stage defaults (`isTest`, `access`, connection fields): those come from the `stage` option, else from the displaced name's stage, exactly as they do without a name. A caller-chosen name can add restriction and never remove it. The bound target is also the target the driver receives: SDK `connection.driver` options are rejected when a key selects the target, the credentials, or TLS (`driverOptionsFor` in `src/core/connection/options.ts`), and noorm's own target, pool size, and TLS keys are applied after `driver`. Transfer and vault destinations carry the stored destination's `isTest`, so `db:reset` on a transfer destination and `dt.importFile` agree. An env or flag overlay on a stored config never grants it, so `NOORM_isTest=true noorm db drop --config prod` stays denied for an `isTest: false` config; an agent setting `NOORM_isTest=true` on an env-only config whose target it supplies is the intended harness path. `agent: false` still hides the config.
7. **Settings stages**: stage `protected: true` applies the immutable per-permission operator/user and viewer/agent ceilings described above; configured role names remain unchanged. Settings rule `match.protected` matches `guarded(config)`.


## Migration


New state migration in `src/core/version/state/migrations/` (registered in `src/core/version/state/index.ts`, bump `CURRENT_VERSIONS.state`):

- `protected: true`  → `access: { user: 'operator', agent: 'viewer' }`
- `protected: false` or absent → `access: { user: 'admin', agent: 'viewer' }` (the default; `protected: false` said "no restriction requested", which is not a grant of agent admin)
- A config that already stores an explicit `access` is left exactly as found, including `agent: 'admin'`.
- Stored `protected` field dropped from the persisted shape after migration.

`ConfigSchema` (zod) accepts a legacy `protected` key on input for one version (feeding the same mapping) and never emits it.


## Checkpoints


The checkpoint table is delivered history. Its rows name the design as first built (resolver clamp, session role, byte-identical connect error, `src/rpc/session.ts`); the change log records what replaced each.

Each checkpoint ends green: `bash tmp/run-test-groups.sh` (mirrors CI's four fresh-process `bun test --serial` groups — a single whole-suite `bun test` cross-contaminates and does not reflect CI; DB containers from repo-root `docker-compose.test.yml` must be up), `bun run typecheck`, `bun run typecheck:tests`, `bun run lint`. Commit per green checkpoint.

| CP | Scope | Key files | Done when |
|---|---|---|---|
| 1 | Policy core, additive, unwired: types, matrix, `checkPolicy`, `guarded`, `classifyStatements` | new `src/core/policy/{types,matrix,check,classify,index}.ts`; new tests `tests/core/policy/` | Table-driven tests cover every matrix cell × both channels; classifier tests cover read/write/ddl, multi-statement max, CTE, EXEC/CALL→ddl, unparseable→ddl, empty→read. Existing suite untouched. |
| 2 | Config carries `access`: types, zod schema + default, state migration, resolver stage-ceiling clamp, `ConfigSummary.access`, `protected` becomes derived-at-load | `src/core/config/{types,schema,resolver}.ts`, `src/core/state/manager.ts`, `src/core/version/state/*`, `src/core/settings/rules.ts` (match via `guarded`) | Migration test: v-prev state with protected true/false loads with mapped access and no stored `protected`; resolver clamp tests (stricter survives, looser clamped); all existing tests green with derived `protected`. |
| 3 | MCP enforcement: `RpcCommand.permission`, dispatch gate, sql escalation via classifier, invisibility, session channel + role in session info | `src/rpc/{types,registry,session}.ts`, `src/rpc/commands/*.ts`, `src/mcp/server.ts`, `src/mcp/init.ts`; delete `src/rpc/protection.ts` after rewiring `query.ts` | Gate tests: viewer denies change_run/sql-write/ddl; operator denies change_run (confirm→deny) but allows sql write; admin allows; `agent: false` absent from list_configs and connect error byte-identical to unknown config (string-equality assertion); sql on viewer allows SELECT, denies INSERT. |
| 4 | User-channel core: SDK guards via `checkPolicy`, `CreateContextOptions.channel`, CLI consumers (`ci/init` access defaults, `config/list` access display, `db/drop` policy check) | `src/sdk/{types,index,guards}.ts`, `src/cli/ci/init.ts`, `src/cli/config/list.ts`, `src/cli/db/drop.ts` | `tests/sdk/guards.test.ts` + `destructive-ops.test.ts` rewritten against access; CLI behavior covered by existing tests updated to fixtures with `access`. |
| 5 | TUI: `SmartConfirm`/`ProtectedConfirm` consume `PolicyCheck`; 12 screens swap `activeConfig.protected` for `checkPolicy`/`guarded`; ConfigAdd/Edit edit `access.user` + `access.agent` (incl. `false`); Export/Import carry `access`; app-context stage defaults | `src/tui/components/dialogs/*.tsx`, `src/tui/screens/{change,config,db,run,lock,settings}/*.tsx`, `src/tui/app-context.tsx` | Typecheck green with zero `protected` reads in `src/tui/` except settings-stage vocabulary; existing TUI tests (if any) green. |
| 6 | Kill `protected`: delete field from `Config`/`ConfigSummary`/session info, delete `src/core/config/protection.ts` + its exports, sweep remaining reads, update all test fixtures | `src/core/config/{types,schema,index}.ts`, remaining consumers, `tests/**` fixtures | `rg -n '\.protected' src/ tests/` returns only settings stage/rule vocabulary and the state-migration parser; full suite + both typechecks green. |
| 7 | Docs + changeset: MCP guide access section, headless docs, config reference; minor changeset | `docs/guide/automation/mcp.md`, `docs/headless.md`, `docs/dev/headless.md`, config reference page, `.changeset/<name>.md` | Docs describe access model (matrix, `agent: false`, migration note); changeset present with `minor`. |
| 8 | **Post-swarm hardening** (challenge-swarm findings). Classifier: CTE-DML + destructive-function denylist. Core-seam user-channel enforcement (run/change/transfer/sql-terminal). Correctness: SDK deny carries `blockedReason`, `ProtectedConfigError.operation` labels, single-source `confirmationPhraseFor`, fix TUI `guarded` fail-open vs `checkConfigPolicy` fail-closed mismatch. Hygiene: permission-value test, delete dead `stageEnforcesProtected`, fix two false-confidence tests, honest changeset prose. | `src/core/policy/{classify,check}.ts`, `src/core/{runner,transfer,change,sql-terminal}/*`, `src/sdk/**`, `src/tui/**`, `tests/**`, `.changeset/*` | viewer denied on CTE-DML + denylisted funcs (probe + tests); run/transfer/sql-terminal gated on user channel; permission-value table test pins every command; dead code gone; false-confidence tests each have one failing behavior; all groups + both typechecks green. |

**Deferred to follow-ups (out of scope for this PR — recorded in `.claude/project/followups/`):** downgrade version-guard + `state.enc.bak` (alpha, per product owner); `state.enc` atomic write + inter-process lock (pre-existing durability, broader than access-roles); policy-denial observability + MCP logger init (separate observability workstream); legacy `protected` input-path removal trigger keyed to a version; invisibility timing side-channel; single `ROLE_ORDER` constant.


## Conventions binding on builders


- Bun repo: run tests via `bash tmp/run-test-groups.sh` (CI-mirrored groups; see repo CLAUDE.md on cross-contamination). Typecheck both tsconfigs.
- Changeset frontmatter must reference `@noormdev/cli` and/or `@noormdev/sdk` — never `noorm` or `@noormdev/main` (breaks the Release workflow).
- Repo rules auto-load from `.claude/rules/` (typescript.md 4-block function structure + `attempt` tuples, tui-development.md, testing.md, documentation.md) — follow them.
- No `as` casts, no `any`; error tuples via `@logosdx/utils` `attempt`/`attemptSync` (existing idiom); native `#private` fields.
- TDD: failing test before implementation, per checkpoint.
- Discard scratch by moving it to `tmp/trash/`; never `rm`; do not chain shell commands.


## Change log


- 2026-07-07 — Initial spec from design doc + scoping report (issue #40).
- 2026-07-07 — CP1: `checkPolicy` takes a structural `PolicyTarget` (Config lacks `access` until CP2). Verification method corrected to CI-mirrored four-group runs.
- 2026-07-07 — CP2: `Config.access` optional until CP6 (CP4/CP5-owned constructors); fail-closed rule added for absent access on the agent channel. Stage `protected: true` override-block in `checkConfigCompleteness` replaced by the ceiling clamp (the old "stored wins" behavior was the bug the clamp fixes).
- 2026-07-07 — CP4: added `db:reset` permission (viewer deny / operator confirm / admin allow) for data-destructive-but-not-drop operations; the initial CP4 mapping of truncate/teardown/reset/importFile to `db:destroy` violated the migration section's behavior-preservation promise for open configs.
- 2026-07-08 — CP8 (post challenge-swarm): classifier now catches CTE-wrapped DML and a destructive-function denylist (viewer write-bypass was confirmed critical). User-channel enforcement moved to the core seam so run/change/transfer/sql-terminal are gated for SDK+TUI+CLI (the earlier "same checkPolicy" claim was only partly delivered). Correctness + hygiene fixes per the swarm. Downgrade guard, state.enc durability/atomicity, and denial observability explicitly deferred (alpha; pre-existing; separate workstreams).
- 2026-07-13 — `change:rm` added (viewer deny / operator confirm / admin confirm — admin gets confirm not allow because deleting an applied change also deletes its DB tracking row), refs `docs/spec/v1-44-change-rm-gate.md`.
- 2026-07-29 — Default access is `{ user: 'admin', agent: 'viewer' }`. **Superseded:** the default was `{ user: 'admin', agent: 'admin' }`, so a config that never declared `access` — which is every config in a stock project — handed the agent channel admin, and no gate in the matrix constrained an MCP client. `viewer` keeps the agent's real job (explore, `sql:read`) while write, DDL, destructive, and credential permissions need an explicit opt-in; `agent: false` was rejected because invisibility reports the same error as an unknown config and leaves an operator no way to diagnose it. Configs already storing an explicit `access` are untouched, including ones that stored `admin/admin` under the old default. `formatAccessTag` re-keyed from `guarded()` to "differs from the default" so `agent: 'admin'` shows up in `config list` instead of reading as unremarkable.
- 2026-07-29 — `Channel` names the caller, not the transport: `'user' | 'agent'`, and `ConfigAccess` is `{ user, agent }`. **Superseded:** `Channel` was `'user' | 'mcp'` and the CLI hardcoded `'user'` at every policy call site, so an agent refused a write over MCP could shell out to `noorm` and run it with the human's role — on a stock config that turned deny into allow for `sql:write`, `sql:ddl`, `db:create`, `run:build` and `vault:read`, and turned `db:destroy` into a confirm that `--yes` satisfied. The CLI now resolves the channel from provenance (`resolveChannel` in `src/core/policy/channel.ts`): `NOORM_CHANNEL` if explicitly `user`/`agent`, else an allowlist of agent-harness variables (`isAgentSession`, `src/core/policy/harness.ts`), else `user`; `mcp serve` still passes `'agent'` literally, above the override. `TERM_PROGRAM`, `CI` and TTY state are excluded — they describe the terminal or the pipeline, not the caller, and a false positive locks a human out of their own CLI. `agent: false` now hides a config on both transports (`noorm config list` filters it the way `list_configs` already did). Stored `access.mcp` migrates to `access.agent` verbatim at state schema v3. Detection is evadable by design; it defends against an agent routing around a refusal, not one deliberately evading.
- 2026-11-09 — Review fixes on PR #119.
    - `Role` is a string defined in settings. **Superseded:** `Role` was the closed union `'viewer' | 'operator' | 'admin'`. Custom roles may extend any known role, and an unresolvable stored role fails closed.
    - Per-permission ceilings replace the role clamp. **Superseded:** a protected stage clamped the config's role to operator or viewer. It now caps each effective cell by the unmodified operator (user) or viewer (agent) matrix, so role names stay unchanged and settings overrides cannot loosen the ceiling.
    - MCP is stateless `2026-07-28` with approvals and no connect. **Superseded:** the server kept a session, exposed `connect`/`disconnect`/`status` plus `run_noorm_cmd` and `noorm_help`, and answered a hidden config with a byte-identical connect error. `SessionManager` and the session commands are deleted.
    - Read permissions (`explore`, `sql:read`) are enforced on the agent channel only. **Superseded:** the user channel was gated on them too, which blocked a person from reading their own database without protecting anything, since the keyboard owner can edit the role. Every explore and change-history read now takes a gate; `db transfer --export` without `--tables` lists tables first, so it needs `explore` on the agent channel.
    - The protected-stage ceiling is the union of the resolver-bound stage, the config name, and an explicit `stage` option. **Superseded:** the SDK keyed the ceiling on `options.stage ?? config.name`, so passing an unprotected `stage`, renaming a protected config with `NOORM_NAME`, or copying or renaming one in state removed it. Protected-to-unprotected copy and rename are refused at `StateManager`. Transfer and vault destinations keep the ceiling.
    - A config with malformed access leaves the TUI usable. **Superseded:** a malformed active config made the unawaited `syncStateFromManagers` reject, so the TUI reported ready with no configs and no identity. The Home screen now warns and names `noorm config repair-access <name>`; stage sync and config add, copy, and import refuse to overwrite the malformed entry.
    - MCP approvals redact secrets only. **Superseded:** the prompt also masked the connection's user and database names, which hid the target from the approver. Only the password and SSL key, cert, and ca are redacted.
- 2026-11-09 — Added `pipeline:run` (viewer deny / operator confirm / admin allow, the `run:dir` cells) so a role can run named pipelines without directory runs, and the reverse. Pipeline history reads (`pipelines.history`, `getRun`) are gated by `explore` on the agent channel.
- 2026-11-09 — Item 6a: `isTest` configs run the database lifecycle permissions (`db:create`, `db:reset`, `db:truncate`, `db:teardown`, `db:destroy`) as `allow` for every resolvable role and both channels, so a test harness under an agent session can drop and recreate its own database. A flagged test database is disposable by the owner's decision, so the flag wins over the protected-stage ceiling, while `run:build`, unknown roles, and every other permission are unchanged. The flag counts only from the stored config, a stage default, or an env-only config, never from an env or flag overlay on a stored config; `noorm ci init --test` is refused on the agent channel for the same reason.
- 2026-11-09 — Item 6a widened: every resolvable role on an `isTest` config reads at least the project's admin cell on both channels, with the lifecycle cells at `allow`. **Superseded:** only the lifecycle cells were relaxed and `run:build` kept the role's cell, so an agent session (role `viewer`) could create an empty test database but not build its schema, and no agent could run a test suite against a real database.
- 2026-11-10 — Item 6a: the SDK gained a context `name` and `connection.driver`, and both are bound by the trust rule. A context `name` and the name it displaces both restrict: either one's stage can declare `isTest: false` or carry the protected ceiling, a `name` equal to a stored config's name is refused, and a stored config under the displaced name must be a test config with the same target. The `name` never selects stage defaults, which still come from `stage` or the displaced name's stage. Driver options cannot select the target, credentials, or TLS. **Superseded:** an env-only config had one name (`NOORM_NAME`, else `__inline__` or `__env__`), so the rule checked one name, and the driver received only fields noorm resolved. Checking the displaced name keeps `name` from moving a context off the name of a stored non-test config or a protected stage, and rejecting target keys keeps a trusted test config's access on the database the rule compared.
- 2026-11-10 — Added `lock:acquire` (viewer deny / operator allow / admin allow), checked by SDK `lock.acquire`, `lock.withLock` and `lock.release` before any tracking table is created, and by the TUI acquire and release screens; the TUI force screen now checks `lock:force`, and a refused TUI lock screen opens no connection. `lock.status` stays ungated. **Superseded:** only `lock.forceRelease` was gated, so a viewer or an agent could take a lock, which also created the tracking tables on a fresh database.
- 2026-11-10 — Item 6a: an env-only config is refused when a stored config has its name, whatever supplied the name. **Superseded:** only the SDK context `name` was refused, so `NOORM_NAME=prod` with env connection fields produced an env-only context that read stored config `prod`'s local secrets while connecting elsewhere. `flags.name` now outranks `NOORM_NAME` for stage defaults as it already did for the config's name. The overlay on a selected stored config is refused the same way: `NOORM_CONFIG=dev NOORM_NAME=prod` named the context `prod` on `dev`'s connection.
- 2026-11-10 — Added Enforcement 5c, the tracking-table rule. `TRACKED_WRITES` and `mayWriteTracking` are exported from `src/core/policy/`. A caller with no writable tracked-write cell, and any dry run, creates and migrates no tracking tables; on the agent channel a `confirm` cell does not count as writable. `db:create` and `db:teardown` are tracked writes. Config activation follows the rule, and SDK readers, dry runs and previews throw a versions error on tables that need a migration. **Superseded:** the CLI, the TUI and config activation ran `ensureSchemaVersion` on connect for every caller, so a `viewer`, an agent, or a `--dry-run` created or migrated noorm's tables on a database it could not write to. SDK `lock.status`, `changes.history` and `changes.historyForChange` queried older tables in their old layout, and SDK dry runs and previews skipped the version check.
- 2026-11-10 — `lock.status` refuses on a config hidden from the channel and deletes an expired lock only for a caller with `lock:acquire`. The TUI lock acquire, release and force screens show the confirmation dialog on a `confirm` cell. **Superseded:** `lock.status` deleted an expired lock for any caller and answered on an `agent: false` config, and the TUI lock screens ran a `confirm` cell without confirmation (force keyed its dialog off `guarded`).
