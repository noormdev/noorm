# Spec: per-config access roles

Design: `docs/design/config-access-roles.md` · Issue: noormdev/noorm#40

The body of this spec is current truth. Superseded decisions live only in the change log.


## Objective


Replace `Config.protected: boolean` with config-scoped, channel-keyed roles enforced by one central policy check. Add MCP invisibility (`mcp: false`). Gate raw SQL by statement classification. Close the existing gap where MCP `change_run`/`change_ff`/`change_revert`/`run_file`/`run_build` bypass protection entirely.


## Data model


    type Role = 'viewer' | 'operator' | 'admin'
    type Channel = 'user' | 'mcp'

    interface ConfigAccess {
        user: Role;
        mcp: Role | false;
    }

- `Config` gains required `access: ConfigAccess`. Zod default when absent: `{ user: 'admin', mcp: 'admin' }`.
- `ConfigSummary` gains `access: ConfigAccess`.
- Until CP6, `Config.protected` remains present and is **derived at load**: `protected = (access.user !== 'admin')`. No caller may write `protected` after CP2. CP6 deletes the field everywhere except the state migration parser.


## Permissions and matrix


    type Permission =
        | 'explore'
        | 'sql:read' | 'sql:write' | 'sql:ddl'
        | 'change:run' | 'change:ff' | 'change:revert'
        | 'run:build' | 'run:file' | 'run:dir'
        | 'db:create' | 'db:destroy'
        | 'config:rm'

Matrix (cells: `allow` / `confirm` / `deny`), hard-coded in `src/core/policy/`:

| permission | viewer | operator | admin |
|---|---|---|---|
| explore | allow | allow | allow |
| sql:read | allow | allow | allow |
| sql:write | deny | allow | allow |
| sql:ddl | deny | deny | allow |
| change:run, change:ff | deny | confirm | allow |
| change:revert | deny | confirm | allow |
| run:build, run:file, run:dir | deny | confirm | allow |
| db:create | deny | confirm | allow |
| db:destroy | deny | deny | confirm |
| config:rm | deny | confirm | confirm |

    type PolicyTarget = { name: string; access: ConfigAccess }
    // Config satisfies PolicyTarget structurally once CP2 adds `access`.

    checkPolicy(channel: Channel, target: PolicyTarget, permission: Permission): PolicyCheck
    // PolicyCheck = { allowed, requiresConfirmation, confirmationPhrase?, blockedReason? }
    // — same shape as the old ProtectionCheck. guarded(target) likewise takes PolicyTarget.

Channel resolution of `confirm`:

- `user`: `allowed: true, requiresConfirmation: true, confirmationPhrase: 'yes-<config.name>'`. `NOORM_YES=1` (`shouldSkipConfirmations()`) resolves it to plain allow.
- `mcp`: `allowed: false`, blockedReason directs to the CLI. `NOORM_YES` has no effect on the mcp channel.

`mcp: false` is not a role: policy is never consulted for an invisible config — visibility is enforced before policy (see Enforcement).

Helper: `guarded(config): boolean = config.access.user !== 'admin'` — used by TUI styling, `config list` display, and settings rule matching. Display-only; never an enforcement input.


## SQL classification


    classifyStatements(sql: string, dialect: Dialect): 'read' | 'write' | 'ddl'

Lives in `src/core/policy/classify.ts` (moved and generalized from `src/rpc/protection.ts`; that file is deleted once callers are rewired).

- CST first (`sql-parser-cst`), keyword fallback when the parser throws (existing strategy, including CTE handling).
- read: SELECT, EXPLAIN, SHOW, DESCRIBE/DESC. write: INSERT, UPDATE, DELETE, MERGE. ddl: everything else that parses (CREATE, ALTER, DROP, TRUNCATE, GRANT, REVOKE, SET, …).
- Multi-statement input: highest class wins (read < write < ddl).
- Empty input: `read`. Unparseable input, unknown statement type, `EXEC`/`CALL`: `ddl` — fail closed.
- Applies only to the `sql` RPC command surface. Change/run files are command-gated, never content-classified.


## Enforcement


1. **RPC**: `RpcCommand` gains required `permission: Permission | 'open'`. `'open'` = no config-scoped gate (`list_configs`, `connect`, `disconnect`, `noorm_help` internals); every other command declares its permission. Assignments: explore/overview/list/detail → `explore`; sql → `sql:read` (handler escalates: run `classifyStatements` and re-check with the actual class before executing); change_history → `explore`; change_run → `change:run`; change_ff → `change:ff`; change_revert → `change:revert`; run_build → `run:build`; run_file → `run:file`.
2. **Gate location**: `run_noorm_cmd` dispatch in `src/mcp/server.ts`. For non-`'open'` commands: resolve target config (explicit `config` arg, else session active config), then `checkPolicy('mcp', config, cmd.permission)`; deny → `isError` result with `blockedReason`, handler never runs.
3. **Channel ownership**: `SessionManager` is constructed with a `Channel` (`'mcp'` in `mcp serve`). It exposes the channel to the gate.
4. **Invisibility** (`mcp: false`, mcp channel only): `list_configs` omits the config; `SessionManager.connect` and `getContext` throw the **byte-identical** error an unknown config name produces (assert equality in tests). Session info returned by `connect` reports the channel's effective role instead of `protected`.
5. **SDK**: `CreateContextOptions` gains `channel?: Channel` (default `'user'`). `src/sdk/guards.ts` destructive-op checks call `checkPolicy` instead of reading `protected`.
6. **CLI/TUI**: same `checkPolicy` on the `user` channel. `SmartConfirm` takes a `PolicyCheck` (or the inputs to compute one) instead of `protected: boolean`; `ProtectedConfirm` keeps the `yes-<config>` phrase flow, driven by `confirmationPhrase`.
7. **Settings stages**: stage `protected: true` becomes an access **ceiling** at resolution (`src/core/config/resolver.ts`): resolved access is clamped to at most `{ user: 'operator', mcp: 'viewer' }`; stricter survives, looser is clamped. Settings rule `match.protected` matches `guarded(config)`. Stage/rule YAML vocabulary is unchanged in this issue.


## Migration


New state migration in `src/core/version/state/migrations/` (registered in `src/core/version/state/index.ts`, bump `CURRENT_VERSIONS.state`):

- `protected: true`  → `access: { user: 'operator', mcp: 'viewer' }`
- `protected: false` or absent → `access: { user: 'admin', mcp: 'admin' }`
- Stored `protected` field dropped from the persisted shape after migration.

`ConfigSchema` (zod) accepts a legacy `protected` key on input for one version (feeding the same mapping) and never emits it.


## Checkpoints


Each checkpoint ends green: `bash tmp/run-test-groups.sh` (mirrors CI's four fresh-process `bun test --serial` groups — a single whole-suite `bun test` cross-contaminates and does not reflect CI; DB containers from repo-root `docker-compose.yml` must be up), `bun run typecheck`, `bun run typecheck:tests`, `bun run lint`. Commit per green checkpoint.

| CP | Scope | Key files | Done when |
|---|---|---|---|
| 1 | Policy core, additive, unwired: types, matrix, `checkPolicy`, `guarded`, `classifyStatements` | new `src/core/policy/{types,matrix,check,classify,index}.ts`; new tests `tests/core/policy/` | Table-driven tests cover every matrix cell × both channels; classifier tests cover read/write/ddl, multi-statement max, CTE, EXEC/CALL→ddl, unparseable→ddl, empty→read. Existing suite untouched. |
| 2 | Config carries `access`: types, zod schema + default, state migration, resolver stage-ceiling clamp, `ConfigSummary.access`, `protected` becomes derived-at-load | `src/core/config/{types,schema,resolver}.ts`, `src/core/state/manager.ts`, `src/core/version/state/*`, `src/core/settings/rules.ts` (match via `guarded`) | Migration test: v-prev state with protected true/false loads with mapped access and no stored `protected`; resolver clamp tests (stricter survives, looser clamped); all existing tests green with derived `protected`. |
| 3 | MCP enforcement: `RpcCommand.permission`, dispatch gate, sql escalation via classifier, invisibility, session channel + role in session info | `src/rpc/{types,registry,session}.ts`, `src/rpc/commands/*.ts`, `src/mcp/server.ts`, `src/mcp/init.ts`; delete `src/rpc/protection.ts` after rewiring `query.ts` | Gate tests: viewer denies change_run/sql-write/ddl; operator denies change_run (confirm→deny) but allows sql write; admin allows; `mcp: false` absent from list_configs and connect error byte-identical to unknown config (string-equality assertion); sql on viewer allows SELECT, denies INSERT. |
| 4 | User-channel core: SDK guards via `checkPolicy`, `CreateContextOptions.channel`, CLI consumers (`ci/init` access defaults, `config/list` access display, `db/drop` policy check) | `src/sdk/{types,index,guards}.ts`, `src/cli/ci/init.ts`, `src/cli/config/list.ts`, `src/cli/db/drop.ts` | `tests/sdk/guards.test.ts` + `destructive-ops.test.ts` rewritten against access; CLI behavior covered by existing tests updated to fixtures with `access`. |
| 5 | TUI: `SmartConfirm`/`ProtectedConfirm` consume `PolicyCheck`; 12 screens swap `activeConfig.protected` for `checkPolicy`/`guarded`; ConfigAdd/Edit edit `access.user` + `access.mcp` (incl. `false`); Export/Import carry `access`; app-context stage defaults | `src/tui/components/dialogs/*.tsx`, `src/tui/screens/{change,config,db,run,lock,settings}/*.tsx`, `src/tui/app-context.tsx` | Typecheck green with zero `protected` reads in `src/tui/` except settings-stage vocabulary; existing TUI tests (if any) green. |
| 6 | Kill `protected`: delete field from `Config`/`ConfigSummary`/session info, delete `src/core/config/protection.ts` + its exports, sweep remaining reads, update all test fixtures | `src/core/config/{types,schema,index}.ts`, remaining consumers, `tests/**` fixtures | `rg -n '\.protected' src/ tests/` returns only settings stage/rule vocabulary and the state-migration parser; full suite + both typechecks green. |
| 7 | Docs + changeset: MCP guide access section, headless docs, config reference; minor changeset | `docs/guide/automation/mcp.md`, `docs/headless.md`, `docs/dev/headless.md`, config reference page, `.changeset/<name>.md` | Docs describe access model (matrix, `mcp: false`, migration note); changeset present with `minor`. |


## Conventions binding on builders


- Bun repo: run tests via `bash tmp/run-test-groups.sh` (CI-mirrored groups; see repo CLAUDE.md on cross-contamination). Typecheck both tsconfigs.
- Changeset frontmatter must reference `@noormdev/cli` and/or `@noormdev/sdk` — never `noorm` or `@noormdev/main` (breaks the Release workflow).
- Repo rules auto-load from `.claude/rules/` (typescript.md 4-block function structure + `attempt` tuples, tui-development.md, testing.md, documentation.md) — follow them.
- No `as` casts, no `any`; error tuples via `@logosdx/utils` `attempt`/`attemptSync` (existing idiom); native `#private` fields.
- TDD: failing test before implementation, per checkpoint.
- Discard scratch by moving it to `tmp/trash/`; never `rm`; do not chain shell commands.


## Change log


- 2026-07-07 — Initial spec from design doc + scoping report (issue #40).
