---
type: Domain
reflects_rev: 43ecd2b9bfc709b22ab81b607d625326135ef738
description: Database config resolution, encrypted project state, shared settings, initialization, lifecycle, and events
tags: [core, state, config]
---

# core-state

## What it does

This domain gives commands a validated database configuration while keeping encrypted credentials separate from version-controlled project settings. Reach for it when changing how stored configs, environment variables, inline overrides, or stages select a database. It also owns project discovery and initialization, persisted-data migration, application shutdown coordination, and the shared typed event bus.

`.noorm/state/state.enc` holds configs, secrets, and known users. `.noorm/settings.yml` holds shared stages, build rules, and project settings. `LifecycleManager` coordinates process resources without persisting its runtime state.

Config selection decides whether stored state participates before config values are merged.

```mermaid
flowchart TD
    %% source: src/core/config/resolver.ts
    A["resolveConfig"] --> B{"configName?"}
    B -->|yes| C{"state.getConfig<br/>(configName)?"}
    C -->|missing| D["throw Error<br/>(configNotFoundMessage)"]
    C -->|found| E["getStageDefaults<br/>stageFields, clone<br/>merge"]
    E --> F["parseConfig<br/>applyStageCeiling"]
    B -->|no| G{"options.flags.connection<br/>or (envConfig.connection<br/>and dialect + database)?"}
    G -->|yes| H["resolveFromEnvOnly"]
    G -->|no| I["return null"]
```

## How it works

### Resolution separates selection from value precedence

`resolveConfig` in [`src/core/config/resolver.ts`](../../src/core/config/resolver.ts) selects a stored name from `options.name`, then `NOORM_CONFIG`, then `state.getActiveConfigName()`. A selected name must exist in state; complete environment or inline connection values do not bypass a missing selected config.

| Resolution mode | Entry condition | Values from lowest to highest priority | Name behavior |
|---|---|---|---|
| Stored | A selected config name exists | `DEFAULTS`, mapped stage defaults, stored config, environment, `options.flags` | Selection uses the stored name; merged input can override the resulting config's `name` |
| Env-only | No selected name; environment has a connection and the stage/env/inline connection supplies dialect and database | `DEFAULTS`, mapped stage defaults, environment, flags | `options.flags.name` overrides `NOORM_NAME` in the merge; absent both, `__env__` |
| Inline connection | No selected name; `options.flags.connection` exists | `DEFAULTS`, mapped stage defaults, environment, flags | Merged explicit name, otherwise `__inline__` |
| No usable input | No selected name and neither eligibility condition holds | No config is parsed | Returns `null` |

An inline connection enters validation even when incomplete. It does not need to satisfy the env-only eligibility gate first. `parseConfig` still requires the final dialect and database.

Stage lookup uses an explicit `options.stage` when supplied, otherwise a stage matching the config name. The no-selected-name eligibility probe uses the inline name, environment name, or `__env__`; the actual merge looks up the stage again using the environment name, inline name, or synthetic name. This environment-first lookup does not set the returned name: the later flags merge overrides `NOORM_NAME`. `stageFields(defaults, true)` maps flat stage connection fields into `connection` before the merge. Stage `type`, `isTest`, and `access` stay at the top level. The stage's `protected` value is an access ceiling applied after parsing, not a replacement connection field. See [`docs/wiki/core-policy.md`](core-policy.md) for role semantics.

### Environment names express object paths

`getEnvConfig` in [`src/core/config/index.ts`](../../src/core/config/index.ts) uses native `makeNestedConfig` behavior: underscores create nesting, uppercase segments become lowercase, and camelCase segments preserve schema field names. `memoizeOpts: false` makes later reads observe environment changes. Password keys skip scalar conversion.

| Environment assignment | Parsed value |
|---|---|
| `NOORM_CONNECTION_DIALECT=postgres` | `connection.dialect: 'postgres'` |
| `NOORM_CONNECTION_PORT=5432` | `connection.port: 5432` |
| `NOORM_CONNECTION_connectTimeoutMs=3000` | `connection.connectTimeoutMs: 3000` |
| `NOORM_CONNECTION_POOL_idleTimeoutMillis=5000` | `connection.pool.idleTimeoutMillis: 5000` |
| `NOORM_CONNECTION_SSL_rejectUnauthorized=false` | `connection.ssl.rejectUnauthorized: false` |
| `NOORM_isTest=true` | `isTest: true` |
| `NOORM_IS_TEST=true` | `is.test: true`, not `isTest` |
| `NOORM_CONNECTION_PASSWORD=12345` | `connection.password: '12345'` |

`NOORM_CONFIG` selects a stored config and is excluded from config values. `NOORM_NAME` supplies a config value instead. CLI control variables such as `NOORM_YES` and `NOORM_CHANNEL`, and the `NOORM_IDENTITY_` prefix, are filtered out. `NOORM_IDENTITY` itself can supply the config's identity string.

The accessor builds input; schema parsing validates it. `ConnectionSchema` accepts `postgres`, `mysql`, `sqlite`, or `mssql`, requires a nonempty database, and requires a host outside SQLite. It accepts boolean SSL or an SSL object with `rejectUnauthorized`, `ca`, `cert`, and `key`. Runtime fields include `tlsServerName`, `connectTimeoutMs`, `statementTimeoutMs`, `queryTimeoutMs`, `applicationName`, and `keepAlive`. Connection timeout must be a positive integer; statement and query timeouts permit zero. Pool fields validate their integer bounds. `ConfigValidationError` carries the field path and Zod issues.

For server dialects, database names reject quotes, backticks, brackets, semicolons, and control characters because database creation and removal interpolate a quoted identifier. SQLite database paths are exempt. Config names accept letters, digits, hyphens, and underscores.

### Stage materialization controls which passwords persist

`stageFields` and `materializeStage` in [`src/core/config/stage.ts`](../../src/core/config/stage.ts) distinguish runtime resolution from constructing a stored config. Stage defaults currently expose flat `dialect`, `host`, `port`, `database`, `user`, `password`, boolean `ssl`, `type`, `access`, `isTest`, and `protected` in [`src/core/settings/schema.ts`](../../src/core/settings/schema.ts) and [`src/core/settings/types.ts`](../../src/core/settings/types.ts).

`materializeStage` removes passwords from stage and connection overrides, then accepts only its separate password argument. It clamps access only when `defaults.protected` is truthy.

```mermaid
flowchart TD
    %% source: src/core/config/stage.ts, src/cli/config/create.ts, src/tui/app-context.tsx
    A["materializeStage<br/>stageFields(defaults)"] --> B["connection"]
    B --> C["delete<br/>connection.password"]
    C --> D{"password !== undefined?"}
    D -->|yes| E["connection.password<br/>= password"]
    D -->|no| F["parseConfig"]
    E --> F
    F --> G{"defaults.protected?"}
    G -->|truthy| H["clampToCeiling"]
    G -->|falsy| I["return config"]
    H --> I
```

The CLI stage-create caller passes environment connection values and explicit connection flags as overrides, but only `args.password` as the password argument. Stage or environment passwords therefore do not enter that stored config implicitly. The TUI's stage synchronization deliberately passes `stage.defaults.password` as the password argument before saving to state. Runtime `resolveConfig` instead calls `stageFields(defaults, true)`, so stage passwords participate below stored, environment, and inline values.

Materialization fixes the requested name and takes top-level behavior from stage defaults rather than copying an entire environment config. Its fallback host is `localhost`, and its fallback database is the stage name. Without an explicit stage type, the fallback type depends on whether the connection host is `localhost`.

### Settings retain a separate persisted document

`SettingsManager` keeps `#document` for YAML persistence and `#settings` for the environment-overlaid accessor view. Mutators update the document and refresh the resolved view; they do not save the environment overlay into `.noorm/settings.yml`. `allSettingsEnv()` constructs its accessor per call with `memoizeOpts: false`, excluding CLI metadata, identity variables, and connection variables.

### Initialization establishes identity before state loading

`performProjectInit` creates identity before constructing `StateManager` when the caller supplies identity information and keys do not exist. `SettingsManager` does not require a private key.

Initialization loads settings before scaffolding the default database layout.

```mermaid
sequenceDiagram
    %% source: src/core/project-init.ts
    participant Init as performProjectInit
    participant FS as filesystem
    participant Settings as SettingsManager
    participant State as StateManager
    Init->>FS: create .noorm/state and ignore file
    opt identityInfo supplied
        Init->>Init: createCryptoIdentity or metadata
    end
    Init->>Settings: init(force)
    Init->>Settings: getPaths()
    Init->>FS: scaffoldDbLayout(paths)
    Init->>State: construct with privateKey, load()
    Init->>State: singleton.reloadPrivateKey()
    Init->>FS: ensure .noorm/state/ ignore entry
```

`scaffoldDbLayout` creates `db/sql/`, `db/changes/`, and steering files beside them only for the default layout. Existing steering files remain untouched. The root ignore update checks for the `.noorm/state/` entry, not merely the `# noorm` header.

`findProjectRoot` resolves paths and searches upward for `.noorm`, stopping at home or the filesystem root. The home-level identity directory is not a project. `getOriginalCwd` preserves the startup directory independently of later project-root changes.

### State loading migrates before repairing access

`StateManager.load()` creates an empty in-memory state when the file is absent. Existing encrypted state requires a private key.

Numeric schema migration precedes package-version migration and access repair.

```mermaid
flowchart TD
    %% source: src/core/state/manager.ts, src/core/state/migrations.ts
    A["readFileSync"] --> B["decrypt and JSON.parse"]
    B --> C["migrateSchemaVersion"]
    C --> D["migrateState"]
    D --> E["repairConfigAccess"]
    E --> F{"Migration or repair?"}
    F -->|yes| G["#persist"]
    F -->|no| H["state:loaded"]
    G --> H
```

`migrateState` retains unknown top-level fields and the numeric `schemaVersion`, but removes legacy embedded `identity`. Access repair runs regardless of migration version; repaired configs are persisted. [`src/core/version/`](../../src/core/version) owns numeric migration engines for database schema, encrypted state, and settings. [`src/core/state/migrations.ts`](../../src/core/state/migrations.ts) owns the package-version stamp and state-field backfills.

`CURRENT_VERSIONS` in [`src/core/version/types.ts`](../../src/core/version/types.ts) sets database schema version `2`, state schema version `3`, and settings schema version `1`, independently of the package version.

State persistence uses a content fingerprint and `mergeState` for concurrent writers, an exclusive advisory lock, a previous-generation backup, and an atomic sibling-file replacement. Lock acquisition uses `wx`, waits up to 5s, and treats locks older than 30s as abandoned. Atomic writing flushes file contents before renaming.

Encryption uses AES-256-GCM with a key derived from the identity private key and a 16-byte IV. `EncryptedPayload.kdf` is optional for older payloads; an absent value denotes `hkdf-sha256`. State holds `configs`, config-scoped `secrets`, `globalSecrets`, `knownUsers`, `activeConfig`, `version`, and `schemaVersion`.

`isValidSecretKey` in [`src/core/state/manager.ts`](../../src/core/state/manager.ts) accepts `/^[A-Za-z][A-Za-z0-9_]*$/`; `setSecret` rejects keys outside that pattern.

### Shutdown releases resources in phase order

`LifecycleManager` registers cleanup resources and runs shutdown phases in a fixed order.

1. `stopping`
2. `completing`
3. `releasing`
4. `flushing`

`LifecycleManager.#performShutdown` skips `exiting`; the caller owns exit handling, and resources registered for `exiting` do not run here. Signal and exception handlers live in [`src/core/lifecycle/handlers.ts`](../../src/core/lifecycle/handlers.ts). The default database cleanup calls `getConnectionManager().closeAll()`.

### Observer payloads describe runtime activity

[`src/core/observer.ts`](../../src/core/observer.ts) exports the shared `ObserverEngine<NoormEvents>` instance. `NoormEvents` combines imported domain event interfaces with inline file, config, state, connection, application, and version events.

`connection:open` includes `configName` and `dialect`, plus optional `host`, `port`, and `database`, so subscribers can identify the resolved connection rather than infer it from the stored name. `connection:error` carries a user-facing `error`, optional server diagnostics, and optional `phase: 'idle'` to distinguish idle pool failures. Config CRUD payloads carry names; updates also carry changed field names, and activation carries the previous name.

The event contract permits repeating progress signals between file execution boundaries.

```mermaid
sequenceDiagram
    %% source: src/core/observer.ts
    participant Runner as runner
    participant Watcher as StatementWatcher
    participant Obs as observer
    participant UI as subscriber
    Runner->>Obs: file:before(filepath, checksum, configName)
    loop after watch delay, on watch interval
        Watcher->>Obs: file:progress(filepath, elapsedMs, sessionId, status)
        Obs->>UI: progress payload
    end
    Runner->>Obs: file:after(filepath, status, durationMs, error?)
```

`file:progress.sessionId` and `status` are nullable. The event contract defines null status as a missing dialect probe or an unavailable server response, not a successful health check. Execution and probing details belong to [`docs/wiki/core-runner.md`](core-runner.md).

## Where it lives

| Path | Role |
|---|---|
| [`src/core/config/index.ts`](../../src/core/config/index.ts) | Live environment accessor and public config exports |
| [`src/core/config/resolver.ts`](../../src/core/config/resolver.ts) | Config selection, source precedence, stage ceiling, completeness, deletion constraints |
| [`src/core/config/stage.ts`](../../src/core/config/stage.ts) | Flat stage mapping and password-controlled materialization |
| [`src/core/config/schema.ts`](../../src/core/config/schema.ts), [`src/core/config/types.ts`](../../src/core/config/types.ts) | Full and partial validation, config contracts |
| [`src/core/config/validate.ts`](../../src/core/config/validate.ts) | Shared connection and config validation checks |
| [`src/core/settings/manager.ts`](../../src/core/settings/manager.ts) | YAML document, resolved settings view, settings mutations |
| [`src/core/settings/schema.ts`](../../src/core/settings/schema.ts), [`src/core/settings/types.ts`](../../src/core/settings/types.ts), [`src/core/settings/defaults.ts`](../../src/core/settings/defaults.ts) | Settings/stage contracts and defaults |
| [`src/core/settings/rules.ts`](../../src/core/settings/rules.ts), [`src/core/settings/events.ts`](../../src/core/settings/events.ts) | Build-rule evaluation and settings event payloads |
| [`src/core/state/manager.ts`](../../src/core/state/manager.ts) | State load/persist and config, secret, known-user operations |
| [`src/core/state/persistence.ts`](../../src/core/state/persistence.ts), [`src/core/state/merge.ts`](../../src/core/state/merge.ts) | Atomic writes, lock, backup, fingerprint, concurrent reconciliation |
| [`src/core/state/access.ts`](../../src/core/state/access.ts), [`src/core/state/migrations.ts`](../../src/core/state/migrations.ts) | Access repair and package-version migration |
| [`src/core/state/encryption/crypto.ts`](../../src/core/state/encryption/crypto.ts), [`src/core/state/types.ts`](../../src/core/state/types.ts), [`src/core/state/version.ts`](../../src/core/state/version.ts) | Encrypted payload, state shape, package-version stamp |
| [`src/core/version/`](../../src/core/version) | Numeric database/state/settings migration engines |
| [`src/core/project.ts`](../../src/core/project.ts), [`src/core/project-init.ts`](../../src/core/project-init.ts) | Root discovery, original directory, initialization and scaffolding |
| [`src/core/environment.ts`](../../src/core/environment.ts) | CI/development/debug detection, confirmation truthiness, config selection variable |
| [`src/core/lifecycle/`](../../src/core/lifecycle) | Startup/shutdown manager, resource phases, process handlers |
| [`src/core/observer.ts`](../../src/core/observer.ts) | Shared observer and event payload contract |
| `.noorm/state/state.enc`, `.noorm/state/state.enc.bak`, `.noorm/state/state.enc.lock` | Encrypted state, previous-generation backup, write lock |
| `.noorm/settings.yml` | Version-controlled shared project settings |
| [`tests/core/config/env.test.ts`](../../tests/core/config/env.test.ts), [`tests/core/config/resolver.test.ts`](../../tests/core/config/resolver.test.ts), [`tests/core/config/stage-materialization.test.ts`](../../tests/core/config/stage-materialization.test.ts) | Environment, precedence, and stage materialization regression coverage |
| [`tests/core/state/`](../../tests/core/state), [`tests/core/settings/`](../../tests/core/settings), [`tests/core/lifecycle/`](../../tests/core/lifecycle), [`tests/core/version/`](../../tests/core/version) | Persistence, settings, lifecycle, and migration coverage |

## Constraints

- A selected name requires stored state. Passing an unknown `options.name` or `NOORM_CONFIG` throws even when environment or inline connection values are complete; omit selection to use the env-only or inline branch.
- Underscores create nesting rather than camelCase words. `NOORM_IS_TEST` does not configure `isTest`; use `NOORM_isTest` or the resolved behavior differs from the intended schema field.
- Environment parsing is not schema validation. A value returned by `getEnvConfig` can still fail `parseConfig`; callers cannot treat the accessor as proof that a connection is valid.
- Stage materialization and runtime resolution have different password rules. Passing a complete environment config to materialization does not preserve its password; only the separate password argument does.
- Keep ambient settings values out of `#document`. Saving the resolved accessor view instead would persist shell-provided settings into version-controlled YAML.
- `DEFAULTS` deliberately omits `access`. Injecting it before parsing would hide legacy `protected` input from the policy fallback and change resolved roles. Stage ceilings and access repair semantics belong to [`docs/wiki/core-policy.md`](core-policy.md).
- An absent state file remains absent after `StateManager.load()`. A caller requiring a durable file must perform a later mutation; initialization's reported path alone does not establish persistence.
- Numeric state migration must precede `migrateState`. Reversing ownership of migration fields can lose schema-managed information during persistence.
- State locks must be released on failure as well as success. A held lock blocks competing mutations until release or stale-lock handling.
- A null `file:progress.status` provides no health signal. Subscribers that display it as success misrepresent an unavailable probe.
- `isEnvTruthy` does not trim input. It treats empty strings, `0`, and case-insensitive `false` as false. Substituting JavaScript string truthiness would accidentally bypass confirmations for `NOORM_YES=false` or enable debug logging for `NOORM_DEBUG=0`.

## Coupling

- [`docs/wiki/core-policy.md`](core-policy.md) owns access roles, channel visibility, guarded rules, and enforcement. This domain resolves policy data, repairs persisted access, and applies stage ceilings through policy helpers.
- [`docs/wiki/core-identity.md`](core-identity.md) owns the private key used to encrypt state, known-user identity types, and logger contracts. State encryption imports identity key derivation; initialization creates identity before keyed state use.
- [`docs/wiki/core-db.md`](core-db.md) owns connection types, port validation, connection testing, and database cleanup. Runtime config fields and observer connection payloads must stay compatible with those consumers.
- [`docs/wiki/core-runner.md`](core-runner.md) owns file execution and statement probing. Its emitters and CLI/TUI subscribers share `NoormEvents` payloads.
- [`docs/wiki/cli.md`](cli.md) owns command selection and flags; its stage-create path chooses explicit persisted passwords. [`docs/wiki/tui.md`](tui.md) owns stage synchronization; [`src/tui/app-context.tsx`](../../src/tui/app-context.tsx) passes stage passwords when synchronizing stage configs into encrypted state.
- [`docs/wiki/sdk.md`](sdk.md) owns SDK callers that supply inline connection overrides and the data-transfer event contracts aggregated by `NoormEvents`.
