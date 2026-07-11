---
type: Domain
---

# core-state

## What it does

Manages encrypted application state (configs, secrets, active config pointer), project settings (`settings.yml`), config resolution, and version migration across three layers (schema, state, settings). Also owns lifecycle (shutdown orchestration) and the project-discovery bootstrap.

Configs are stored encrypted in `.noorm/state/state.enc` using AES-256-GCM. Settings live in `.noorm/settings.yml` (plaintext YAML). Version migration runs at startup across all three layers.

Each config carries `access: ConfigAccess` (per-channel role pair, replacing the removed `protected: boolean`), resolved via `resolveLegacyAccess` from [`src/core/policy/`](../../src/core/policy). [`src/core/config/schema.ts`](../../src/core/config/schema.ts) maps a legacy `protected` boolean input to `access` at parse time; `StateManager.load()` backfills `access` on any config that reaches the current schema version without it.

## CLI code

- [`src/core/state/manager.ts`](../../src/core/state/manager.ts) — `StateManager`; encrypt/decrypt state, CRUD for configs and secrets. `load()` runs the schemaVersion-keyed migration (`migrateState`/`needsStateMigration` from `core/version/state/`, e.g. v2's `protected`→`access` mapping) ahead of the package-semver migration in `state/migrations.ts`, then backfills `access` on any config still missing it
- [`src/core/state/encryption/`](../../src/core/state/encryption) — AES-256-GCM encrypt/decrypt primitives
- [`src/core/state/migrations.ts`](../../src/core/state/migrations.ts) — `migrateState`, `needsMigration`; package-semver-keyed, distinct from the schemaVersion-keyed migrations in `core/version/state/`
- [`src/core/settings/manager.ts`](../../src/core/settings/manager.ts) — `SettingsManager`; loads/saves `settings.yml`, validates against schema, stage merging
- [`src/core/settings/schema.ts`](../../src/core/settings/schema.ts) — Zod schema for settings file
- [`src/core/settings/rules.ts`](../../src/core/settings/rules.ts) — `ruleMatches`, `evaluateRule`, `evaluateRules`; config-based conditional overrides. The rule's `protected` match key checks `guarded(config)` (`core/policy`), not a config field
- [`src/core/settings/defaults.ts`](../../src/core/settings/defaults.ts) — `DEFAULT_SETTINGS`
- [`src/core/settings/events.ts`](../../src/core/settings/events.ts) — settings-related observer event types
- [`src/core/config/index.ts`](../../src/core/config/index.ts) — `makeNestedConfig`; builds config object from env at module scope (known contamination source — see CLAUDE.md)
- [`src/core/config/resolver.ts`](../../src/core/config/resolver.ts) — `resolveConfig`, `SettingsProvider`; picks active config from state + settings. `applyStageCeiling` clamps a resolved config's `access` down to `{ user: 'operator', mcp: 'viewer' }` when the linked stage sets `protected: true` — replaces the old hard-violation check in `checkConfigCompleteness`
- [`src/core/config/schema.ts`](../../src/core/config/schema.ts) — config schema validation; `withResolvedAccess` maps a legacy `protected: boolean` input to `access: ConfigAccess` via `resolveLegacyAccess` (`core/policy`)
- [`src/core/lifecycle/manager.ts`](../../src/core/lifecycle/manager.ts) — `LifecycleManager`; shutdown phase orchestration, signal handlers
- [`src/core/lifecycle/handlers.ts`](../../src/core/lifecycle/handlers.ts) — signal/exception handler registration
- [`src/core/lifecycle/types.ts`](../../src/core/lifecycle/types.ts) — `ShutdownPhase`, `AppMode`, lifecycle state types
- [`src/core/version/index.ts`](../../src/core/version/index.ts) — `VersionManager`, `checkSchemaVersion`, `migrateSchema`, `ensureSchemaVersion`, `bootstrapSchema`
- [`src/core/version/schema/`](../../src/core/version/schema), [`src/core/version/state/`](../../src/core/version/state), [`src/core/version/settings/`](../../src/core/version/settings) — per-layer migrations (`version/state/migrations/v2.ts` maps the removed `protected` boolean to `access`)
- [`src/core/project.ts`](../../src/core/project.ts) — `findProjectRoot`, `initProjectContext`, `isNoormProject`, `getGlobalNoormPath`
- [`src/core/project-init.ts`](../../src/core/project-init.ts) — `initProjectContext` bootstrap: loads state, settings, lifecycle, runs version migrations
- [`src/core/environment.ts`](../../src/core/environment.ts) — env variable detection and normalization
- [`src/core/observer.ts`](../../src/core/observer.ts) — singleton `observer` (ObserverEngine from `@logosdx/observer`); event bus for all modules

## Docs

- [`docs/dev/config.md`](../dev/config.md) — config internals
- [`docs/dev/config-sharing.md`](../dev/config-sharing.md) — multi-user config sharing
- [`docs/dev/settings.md`](../dev/settings.md) — settings file reference
- [`docs/dev/state.md`](../dev/state.md) — state file internals
- [`docs/dev/version.md`](../dev/version.md) — version migration internals
- [`docs/dev/project-discovery.md`](../dev/project-discovery.md) — project root detection
- [`docs/dev/logger.md`](../dev/logger.md) — logger internals (uses observer)
- [`docs/guide/environments/configs.md`](../guide/environments/configs.md) — user guide: configs
- [`docs/guide/environments/stages.md`](../guide/environments/stages.md) — user guide: stages
- [`docs/guide/environments/secrets.md`](../guide/environments/secrets.md) — user guide: secrets

## Coupling

- `src/core/config/index.ts:34` calls `makeNestedConfig(process.env, …)` at module scope — snapshots env at first import. Same bug was fixed for `SettingsManager` in commit `ec9ccc2`. Not yet migrated to call-time.
- Observer ([`src/core/observer.ts`](../../src/core/observer.ts)) is imported by virtually every core module — it is the event bus; all `observer.emit()` calls couple to TUI hooks.
- VersionManager runs migrations at startup via `project-init.ts` — schema + state + settings must all be at CURRENT_VERSIONS before app proceeds.
- StateManager uses identity key from [`src/core/identity/storage.ts`](../../src/core/identity/storage.ts) for encryption — identity domain must initialize before state loads.
- LifecycleManager coordinates connection teardown — `ConnectionManager.reset()` is called in lifecycle shutdown handlers.
- RPC session layer ([`src/rpc/session.ts`](../../src/rpc/session.ts)) reads state via StateManager for active config lookup.
- [`src/core/config/schema.ts`](../../src/core/config/schema.ts), [`src/core/config/resolver.ts`](../../src/core/config/resolver.ts), [`src/core/state/manager.ts`](../../src/core/state/manager.ts), and [`src/core/settings/rules.ts`](../../src/core/settings/rules.ts) all import `ConfigAccess`/`resolveLegacyAccess`/`guarded` from [`src/core/policy/`](../../src/core/policy) — the `core-policy` domain owns the role matrix and channel checks; shape changes to `ConfigAccess` propagate to all four.

## Conventions worth knowing

- State file path: `.noorm/state/state.enc` (configurable via `StateManagerOptions`).
- Settings file path: `.noorm/settings.yml`; `SETTINGS_FILE_PATH` constant exported from [`src/core/settings/index.ts`](../../src/core/settings/index.ts).
- `CURRENT_VERSIONS` in [`src/core/version/index.ts`](../../src/core/version/index.ts) is the version triple that must match after migration.
- `observer` is a module-scope singleton; `resetConnectionManager`/`resetSettingsManager`/`resetStateManager` are test-only reset points.
- Stages in settings allow per-environment config overrides; `evaluateRules` applies them at runtime.
- `initProjectContext` is the canonical startup sequence called by CLI entry and SDK `createContext`.
- `Config.access` defaults to `{ user: 'admin', mcp: 'admin' }` (`OPEN_ACCESS`) when absent; a legacy `protected: true` maps to `{ user: 'operator', mcp: 'viewer' }` (`GUARDED_ACCESS`) — both constants live in [`src/core/policy/legacy-access.ts`](../../src/core/policy/legacy-access.ts).
- `src/core/config/protection.ts` (hard-block rules for protected configs) was deleted — access enforcement now runs entirely through `core/policy`.
