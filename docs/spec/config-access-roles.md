# Spec: per-config access roles

Design: `docs/design/config-access-roles.md` · Issue: noormdev/noorm#40

The body of this spec is current truth. Superseded decisions live only in the change log.


## Objective


Replace `Config.protected: boolean` with config-scoped, channel-keyed roles enforced by one central policy check. Add MCP invisibility (`agent: false`). Gate raw SQL by statement classification. Close the existing gap where MCP `change_run`/`change_ff`/`change_revert`/`run_file`/`run_build` bypass protection entirely.


## Data model


    type Role = 'viewer' | 'operator' | 'admin'
    type Channel = 'user' | 'agent'

    interface ConfigAccess {
        user: Role;
        agent: Role | false;
    }

- `Config` gains `access?: ConfigAccess` — optional in the type until CP6 because CP4/CP5-owned files (`src/cli/ci/init.ts`, TUI config screens, app-context) construct `Config` literals without it; every config materialized through `parseConfig`/state load has it populated. **CP6 makes the field required** once those constructors are updated. Zod default when absent: `{ user: 'admin', agent: 'viewer' }` — the agent channel is never privileged without an explicit opt-in, because a stock project writes no `access` at all.
- `ConfigSummary` gains required `access: ConfigAccess`.
- Until CP6, `Config.protected` remains present and is **derived at load**: `protected = (access.user !== 'admin')`. It is never persisted (state `persist()` strips it; the zod schema never emits a stored value). No caller may write `protected` after CP2. CP6 deletes the field everywhere except the state migration parser.
- Enforcement code must not trust the optionality: on the `agent` channel, a config with absent `access` is **denied** (fail closed) — in practice unreachable, since configs reach enforcement via parse/migration.
- `Channel` names *who is driving*, not which binary was invoked. Callers never hardcode it outside the MCP server: `resolveChannel(env?)` (`src/core/policy/channel.ts`) resolves it as (1) `NOORM_CHANNEL` when exactly `user` or `agent`, (2) `isAgentSession()` (`src/core/policy/harness.ts`, an allowlist of harness-set variables) → `agent`, (3) `user`. `mcp serve` constructs `new SessionManager('agent')` literally and never calls `resolveChannel`, so stdio traffic is `agent` even under `NOORM_CHANNEL=user`. The TUI keeps a literal `'user'` — it needs a TTY and an interactive human.
- Stored state migrates `access.mcp` → `access.agent` verbatim at state schema **v3** (`src/core/version/state/migrations/v3.ts`), preserving `false`. v2 already emits the new key (it shares `repairConfigAccess`), so v3 is a no-op on anything coming up through it.


## Permissions and matrix


    type Permission =
        | 'explore'
        | 'sql:read' | 'sql:write' | 'sql:ddl'
        | 'change:run' | 'change:ff' | 'change:revert' | 'change:rm'
        | 'run:build' | 'run:file' | 'run:dir'
        | 'db:create' | 'db:reset' | 'db:destroy'
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
| db:reset | deny | confirm | allow |
| db:destroy | deny | deny | confirm |
| config:rm | deny | confirm | confirm |
| change:rm | deny | confirm | confirm |

    type PolicyTarget = { name: string; access: ConfigAccess }
    // Config satisfies PolicyTarget structurally once CP2 adds `access`.

    checkPolicy(channel: Channel, target: PolicyTarget, permission: Permission): PolicyCheck
    // PolicyCheck = { allowed, requiresConfirmation, confirmationPhrase?, blockedReason? }
    // — same shape as the old ProtectionCheck. guarded(target) likewise takes PolicyTarget.

Channel resolution of `confirm`:

- `user`: `allowed: true, requiresConfirmation: true, confirmationPhrase: 'yes-<config.name>'`. `NOORM_YES=1` (`shouldSkipConfirmations()`) resolves it to plain allow.
- `agent`: `allowed: false`, blockedReason directs to the CLI. `NOORM_YES` has no effect on the agent channel.

`agent: false` is not a role: policy is never consulted for an invisible config — visibility is enforced before policy (see Enforcement).

Helper: `guarded(config): boolean = config.access.user !== 'admin'` — used by TUI styling and settings rule matching. Display-only; never an enforcement input.

The `config list` access tag is keyed to the default instead: `formatAccessTag` renders `user:<role> agent:<role|off>` for any config whose access differs from the default, and `null` otherwise. `guarded` cannot drive it, because `agent: 'admin'` is an escalation the user channel can't see.


## SQL classification


    classifyStatements(sql: string, dialect: Dialect): 'read' | 'write' | 'ddl'

Lives in `src/core/policy/classify.ts` (moved and generalized from `src/rpc/protection.ts`; that file is deleted once callers are rewired).

- CST first (`sql-parser-cst`), keyword fallback when the parser throws (existing strategy, including CTE handling).
- read: SELECT, EXPLAIN, SHOW, DESCRIBE/DESC. write: INSERT, UPDATE, DELETE, MERGE. ddl: everything else that parses (CREATE, ALTER, DROP, TRUNCATE, GRANT, REVOKE, SET, …).
- **Data-modifying CTEs**: a `WITH` whose any sub-statement is INSERT/UPDATE/DELETE/MERGE takes that sub-statement's class, even when the outer statement is `SELECT`. A `viewer`'s "touches nothing" guarantee requires this — `WITH t AS (DELETE … RETURNING …) SELECT * FROM t` is a write. Detect the DML node in the CST (and in the keyword fallback, a data-modifying keyword anywhere at CTE-definition depth), do not key only off the final keyword.
- **Side-effecting functions**: a SELECT that invokes a function on the `DESTRUCTIVE_FUNCTIONS` denylist (`src/core/policy/classify.ts`) classifies as at least `write`, whether the call is bare (`pg_terminate_backend(…)`) or schema-qualified (`pg_catalog.pg_terminate_backend(…)`). The list is a hardcoded, extensible constant seeded with known side-effecting builtins (`pg_terminate_backend`, `pg_cancel_backend`, `pg_reload_conf`, `pg_promote`, `lo_import`, `lo_export`, `lo_unlink`, `setval`, `nextval`, `dblink_exec`, `query_to_xml` and family, …). This is deliberately a denylist, not an allowlist: `SELECT f()` is statically undecidable, so pure helpers (`count`, `now`, `coalesce`, …) stay `read` and only known-dangerous calls are caught. Documented limitations: (a) a `viewer` calling an *unlisted* side-effecting function is not blocked; (b) `classifyStatements` guards against **mutation** (write/ddl), not **disclosure** — a read-only exfiltration function like `pg_read_file`/`pg_ls_dir` stays `read`. The role is a guardrail against casual/accidental writes, not an airtight sandbox; operators needing hard confidentiality or write isolation must back it with database-level `GRANT`s.
- Multi-statement input: highest class wins (read < write < ddl).
- Empty input: `read`. Unparseable input, unknown statement type, `EXEC`/`CALL`: `ddl` — fail closed.
- Applies to the ad-hoc raw-SQL surfaces: the `sql` RPC command and the TUI SQL terminal. Change/run files are command-gated (trusted, tracked artifacts), never content-classified.


## Enforcement


1. **RPC**: `RpcCommand` gains required `permission: Permission | 'open'`. `'open'` = no config-scoped gate (`list_configs`, `connect`, `disconnect`, `noorm_help` internals); every other command declares its permission. Assignments: explore/overview/list/detail → `explore`; sql → `sql:read` (handler escalates: run `classifyStatements` and re-check with the actual class before executing); change_history → `explore`; change_run → `change:run`; change_ff → `change:ff`; change_revert → `change:revert`; run_build → `run:build`; run_file → `run:file`.
2. **Gate location**: `run_noorm_cmd` dispatch in `src/mcp/server.ts`. For non-`'open'` commands: resolve target config (explicit `config` arg, else session active config), then `checkPolicy('agent', config, cmd.permission)`; deny → `isError` result with `blockedReason`, handler never runs.
3. **Channel ownership**: `SessionManager` is constructed with a `Channel` (`'agent'` in `mcp serve`). It exposes the channel to the gate.
4. **Invisibility** (`agent: false`, agent channel only): `list_configs` omits the config; `SessionManager.connect` and `getContext` throw the **byte-identical** error an unknown config name produces (assert equality in tests). Session info returned by `connect` reports the channel's effective role instead of `protected`.
5. **SDK**: `CreateContextOptions` gains `channel?: Channel` (default `'user'`). `src/sdk/guards.ts` destructive-op checks call `checkPolicy` instead of reading `protected`. Guard permission mapping: `db.truncate`/`db.teardown`/`db.reset`/`dt.importFile` → `db:reset` (data-destructive, admin frictionless — preserves pre-migration behavior for open configs, which is the migration section's promise); `changes.revert`/`changes.rewind` → `change:revert`; `changes.run`/`changes.ff` → `change:run`/`change:ff`; `run.file`/`run.dir`/`run.build` → `run:file`/`run:dir`/`run:build`; data transfer into a target → `db:reset`. In the SDK (no prompt available), `requiresConfirmation` blocks with a message naming `NOORM_YES=1` and the CLI/TUI; `checkPolicy` already resolves `NOORM_YES=1` to allow on the user channel. On deny, the thrown error carries the policy's `blockedReason` (role + permission), and `ProtectedConfigError.operation` names the public method the caller invoked.
5a. **Core-seam enforcement** (the "enforced above the driver" promise): the user-channel gate lives at the core boundary each surface funnels through — `runFile`/`runFiles` (`core/runner`), data transfer (`core/transfer`), the SQL terminal executor (ad-hoc SQL → `classifyStatements` then gate), and `changes.run`/`ff`/`revert` (`core/change`). The `Context` carries its `Channel`, so SDK, TUI, and CLI callers all inherit one enforcement path rather than each re-implementing checks per screen/namespace. Run/change files gate on their command permission (not content-classified); only the ad-hoc SQL terminal is classified.
6. **CLI/TUI**: inherit enforcement from the core seam (5a). `SmartConfirm` takes `requiresConfirmation` + `confirmationPhrase` instead of `protected: boolean`; `ProtectedConfirm` keeps the `yes-<config>` phrase flow, driven by `confirmationPhrase` — sourced from one `confirmationPhraseFor(name)` helper in `src/core/policy/`, never re-templated per screen. The matrix is the enforcement **floor** — screens may keep stricter confirm UX than the cell requires (TUI teardown/truncate retain their unconditional phrase-confirm for all roles, and additionally deny when `checkConfigPolicy('user', config, 'db:reset')` says deny).
7. **Settings stages**: stage `protected: true` becomes an access **ceiling** at resolution (`src/core/config/resolver.ts`): resolved access is clamped to at most `{ user: 'operator', agent: 'viewer' }`; stricter survives, looser is clamped. Settings rule `match.protected` matches `guarded(config)`. Stage/rule YAML vocabulary is unchanged in this issue.


## Migration


New state migration in `src/core/version/state/migrations/` (registered in `src/core/version/state/index.ts`, bump `CURRENT_VERSIONS.state`):

- `protected: true`  → `access: { user: 'operator', agent: 'viewer' }`
- `protected: false` or absent → `access: { user: 'admin', agent: 'viewer' }` (the default; `protected: false` said "no restriction requested", which is not a grant of agent admin)
- A config that already stores an explicit `access` is left exactly as found, including `agent: 'admin'`.
- Stored `protected` field dropped from the persisted shape after migration.

`ConfigSchema` (zod) accepts a legacy `protected` key on input for one version (feeding the same mapping) and never emits it.


## Checkpoints


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
