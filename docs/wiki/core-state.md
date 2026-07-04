---
type: Domain
---

# core-state

## What it does

Manages encrypted application state (configs, secrets, active config pointer), project settings (`settings.yml`), config resolution, and version migration across three layers (schema, state, settings). Also owns lifecycle (shutdown orchestration) and the project-discovery bootstrap.

Configs are stored encrypted in `.noorm/state/state.enc` using AES-256-GCM. Settings live in `.noorm/settings.yml` (plaintext YAML). Version migration runs at startup across all three layers.

## CLI code

- `src/core/state/manager.ts` — `StateManager`; encrypt/decrypt state, CRUD for configs and secrets
- `src/core/state/encryption/` — AES-256-GCM encrypt/decrypt primitives
- `src/core/state/migrations.ts` — `migrateState`, `needsMigration`
- `src/core/settings/manager.ts` — `SettingsManager`; loads/saves `settings.yml`, validates against schema, stage merging
- `src/core/settings/schema.ts` — Zod schema for settings file
- `src/core/settings/rules.ts` — `ruleMatches`, `evaluateRule`, `evaluateRules`; config-based conditional overrides
- `src/core/settings/defaults.ts` — `DEFAULT_SETTINGS`
- `src/core/settings/events.ts` — settings-related observer event types
- `src/core/config/index.ts` — `makeNestedConfig`; builds config object from env at module scope (known contamination source — see CLAUDE.md)
- `src/core/config/resolver.ts` — `resolveConfig`, `SettingsProvider`; picks active config from state + settings
- `src/core/config/protection.ts` — `ConfigProtection`; hard-block rules for protected configs
- `src/core/config/schema.ts` — config schema validation
- `src/core/lifecycle/manager.ts` — `LifecycleManager`; shutdown phase orchestration, signal handlers
- `src/core/lifecycle/handlers.ts` — signal/exception handler registration
- `src/core/lifecycle/types.ts` — `ShutdownPhase`, `AppMode`, lifecycle state types
- `src/core/version/index.ts` — `VersionManager`, `checkSchemaVersion`, `migrateSchema`, `ensureSchemaVersion`, `bootstrapSchema`
- `src/core/version/schema/`, `src/core/version/state/`, `src/core/version/settings/` — per-layer migrations
- `src/core/project.ts` — `findProjectRoot`, `initProjectContext`, `isNoormProject`, `getGlobalNoormPath`
- `src/core/project-init.ts` — `initProjectContext` bootstrap: loads state, settings, lifecycle, runs version migrations
- `src/core/environment.ts` — env variable detection and normalization
- `src/core/observer.ts` — singleton `observer` (ObserverEngine from `@logosdx/observer`); event bus for all modules

## Docs

- `docs/dev/config.md` — config internals
- `docs/dev/config-sharing.md` — multi-user config sharing
- `docs/dev/settings.md` — settings file reference
- `docs/dev/state.md` — state file internals
- `docs/dev/version.md` — version migration internals
- `docs/dev/project-discovery.md` — project root detection
- `docs/dev/logger.md` — logger internals (uses observer)
- `docs/guide/environments/configs.md` — user guide: configs
- `docs/guide/environments/stages.md` — user guide: stages
- `docs/guide/environments/secrets.md` — user guide: secrets

## Coupling

- `src/core/config/index.ts:34` calls `makeNestedConfig(process.env, …)` at module scope — snapshots env at first import. Same bug was fixed for `SettingsManager` in commit `ec9ccc2`. Not yet migrated to call-time.
- Observer (`src/core/observer.ts`) is imported by virtually every core module — it is the event bus; all `observer.emit()` calls couple to TUI hooks.
- VersionManager runs migrations at startup via `project-init.ts` — schema + state + settings must all be at CURRENT_VERSIONS before app proceeds.
- StateManager uses identity key from `src/core/identity/storage.ts` for encryption — identity domain must initialize before state loads.
- LifecycleManager coordinates connection teardown — `ConnectionManager.reset()` is called in lifecycle shutdown handlers.
- RPC session layer (`src/rpc/session.ts`) reads state via StateManager for active config lookup.

## Conventions worth knowing

- State file path: `.noorm/state/state.enc` (configurable via `StateManagerOptions`).
- Settings file path: `.noorm/settings.yml`; `SETTINGS_FILE_PATH` constant exported from `src/core/settings/index.ts`.
- `CURRENT_VERSIONS` in `src/core/version/index.ts` is the version triple that must match after migration.
- `observer` is a module-scope singleton; `resetConnectionManager`/`resetSettingsManager`/`resetStateManager` are test-only reset points.
- Stages in settings allow per-environment config overrides; `evaluateRules` applies them at runtime.
- `initProjectContext` is the canonical startup sequence called by CLI entry and SDK `createContext`.
