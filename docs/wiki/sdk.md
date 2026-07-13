---
type: Domain
---

# sdk

## What it does

Programmatic API for noorm-managed databases. `createContext` returns a `Context` object with a Kysely instance plus namespaced noorm operations (run, changes, db, dt, lock, vault, transfer, templates, secrets, utils). Published as `@noormdev/sdk` from [`packages/sdk/`](../../packages/sdk).

Also includes the DT (Data Transfer format) module for typed binary serialization of database rows — separate from the `transfer` domain. DT produces `.dt` files with a universal type system.

## Artifacts

- [`packages/sdk/package.json`](../../packages/sdk/package.json) — published package `@noormdev/sdk`, version `1.0.0-alpha.35`
- [`packages/sdk/CHANGELOG.md`](../../packages/sdk/CHANGELOG.md) — SDK release history

## CLI code

- [`src/sdk/index.ts`](../../src/sdk/index.ts) — `createContext` factory; resolves config, initializes state, returns `Context`
- [`src/sdk/context.ts`](../../src/sdk/context.ts) — `Context` class; holds Kysely instance, all namespaced ops, connect/disconnect
- [`src/sdk/namespaces/run.ts`](../../src/sdk/namespaces/run.ts) — `RunNamespace`; wraps `runFile`, `runDir`, `runBuild`, `preview`
- [`src/sdk/namespaces/changes.ts`](../../src/sdk/namespaces/changes.ts) — `ChangesNamespace`; wraps `ChangeManager` for ff/run/revert/list
- [`src/sdk/namespaces/db.ts`](../../src/sdk/namespaces/db.ts) — `DbNamespace`; explore, create, drop, teardown, truncate, reset
- [`src/sdk/namespaces/dt.ts`](../../src/sdk/namespaces/dt.ts) — `DtNamespace`; export/import `.dt` files
- [`src/sdk/namespaces/lock.ts`](../../src/sdk/namespaces/lock.ts) — `LockNamespace`; acquire/release/force-release/status
- [`src/sdk/namespaces/vault.ts`](../../src/sdk/namespaces/vault.ts) — `VaultNamespace`; init, get/set/remove secrets, propagate, copy key
- [`src/sdk/namespaces/transfer.ts`](../../src/sdk/namespaces/transfer.ts) — `TransferNamespace`; wraps `transferData`
- [`src/sdk/namespaces/templates.ts`](../../src/sdk/namespaces/templates.ts) — `TemplatesNamespace`; render, process file/files
- [`src/sdk/namespaces/secrets.ts`](../../src/sdk/namespaces/secrets.ts) — `SecretsNamespace`; stage-level secret resolution
- [`src/sdk/namespaces/utils.ts`](../../src/sdk/namespaces/utils.ts) — `UtilsNamespace`; Kysely sql tag, connection ping
- [`src/sdk/impersonate/scope.ts`](../../src/sdk/impersonate/scope.ts) — `ImpersonateScope`; run operations as a different identity
- [`src/sdk/impersonate/dialect-strategy.ts`](../../src/sdk/impersonate/dialect-strategy.ts) — per-dialect identity-column handling for impersonation
- [`src/sdk/sql.ts`](../../src/sdk/sql.ts) — `createSqlHelper`; typed SQL tag builder wrapping Kysely's `sql`
- [`src/sdk/tvp.ts`](../../src/sdk/tvp.ts) — `createTvp`, `TvpBuilder`; MSSQL table-valued parameter construction
- [`src/sdk/noorm-ops.ts`](../../src/sdk/noorm-ops.ts) — `NoormOps`; assembled namespace object attached to `ctx.noorm`
- [`src/sdk/guards.ts`](../../src/sdk/guards.ts) — `checkRequireTest`; prevents SDK use in production without explicit opt-in. `checkProtectedConfig` now runs `checkConfigPolicy` (`core/policy`) and throws `ProtectedConfigError` on denial or on a `confirm` cell (the SDK has no interactive prompt)
- [`src/sdk/types.ts`](../../src/sdk/types.ts) — `CreateContextOptions` (carries `channel?: Channel`, default `'user'`), `ContextConfig`, SDK-level types
- [`src/core/dt/index.ts`](../../src/core/dt/index.ts) — DT module: `exportTable`, `importTable`, serialize/deserialize, versioning, crypto
- [`src/core/dt/dialects/`](../../src/core/dt/dialects) — per-dialect type mapping for DT
- [`src/core/dt/type-map.ts`](../../src/core/dt/type-map.ts) — `SimpleType` vs `EncodedType` classification; `text` type uses gz64 compression
- [`src/core/dt/schema.ts`](../../src/core/dt/schema.ts) — DT file schema validation

## Docs

- [`docs/dev/sdk.md`](../dev/sdk.md) — SDK internals reference (1094L)
- [`docs/reference/sdk.md`](../reference/sdk.md) — public SDK API reference (1426L)
- [`docs/dev/transfer.md`](../dev/transfer.md) — DT transfer internals
- [`docs/getting-started/building-your-sdk.md`](../getting-started/building-your-sdk.md) — getting-started guide for SDK users
- [`skills/noorm/references/sdk.md`](../../skills/noorm/references/sdk.md) — skill reference for SDK usage patterns
- [`docs/spec/v1-13-inert-params.md`](../spec/v1-13-inert-params.md) — implementation contract: deletion of `ToUniversalOptions.version` and the DT export/import worker-fetch DI-override trio (`connectionString`/`connectionBridge`/`computePool`), D8 ruling

## Coupling

- `createContext` calls `initProjectContext` from [`src/core/project-init.ts`](../../src/core/project-init.ts) — same startup sequence as CLI.
- `createContext` defaults `options.channel` to `'user'` and re-exports `Channel`/`ConfigAccess`/`Role` from [`src/core/policy/`](../../src/core/policy) — every guard in [`src/sdk/guards.ts`](../../src/sdk/guards.ts) reads `state.options.channel` for its `checkConfigPolicy` call.
- All namespaces delegate to core modules — any core API change propagates to the namespace wrappers.
- DT module ([`src/core/dt/`](../../src/core/dt)) is co-owned: SDK exposes it via `ctx.noorm.dt`, but it is also used standalone by [`src/cli/db/transfer.ts`](../../src/cli/db/transfer.ts).
- Impersonation ([`src/sdk/impersonate/`](../../src/sdk/impersonate)) requires the identity domain keypair loaded.
- TVP ([`src/sdk/tvp.ts`](../../src/sdk/tvp.ts)) is MSSQL-only — dialect guard at construction time.
- Published package build defined in [`tsup.sdk.config.ts`](../../tsup.sdk.config.ts); types extracted via `@microsoft/api-extractor` + `dts-bundle-generator`.

## Conventions worth knowing

- `createContext` is the only public entry point — do not instantiate `Context` directly.
- `ctx.kysely` is a raw Kysely instance for type-safe queries.
- `ctx.noorm` is the noorm namespace (changes, run, db, dt, lock, vault, transfer, templates, secrets, utils).
- DT `text` type uses gz64 compression for large TEXT columns; `string` is for short VARCHAR/CHAR.
- `checkRequireTest` throws `RequireTestError` if `options.requireTest === true` but `config.isTest === false` — prevents accidental production use of test helpers.
- `ProtectedConfigError` on a `confirm`-cell permission names `NOORM_YES=1` (scripted opt-in) or the CLI/TUI (interactive confirm) as the way through — the SDK itself never prompts.
- Integration tests in [`tests/sdk/`](../../tests/sdk) and [`tests/integration/sdk/`](../../tests/integration/sdk) cover TVF and TVP patterns.
