---
type: Domain
---

# core-identity

## What it does

Two-tier identity system: (1) audit identity — name/email for execution provenance tracking; (2) cryptographic identity — Ed25519-like keypair for config sharing and state encryption. Also owns the vault (per-database encrypted secret store), the logger (structured log output with redaction), and the SQL terminal history.

## CLI code

- `src/core/identity/crypto.ts` — keypair generation, `encryptForRecipient`, `decryptWithPrivateKey`, `deriveStateKey`, `encryptState`, `decryptState`
- `src/core/identity/factory.ts` — `loadExistingIdentity`; load keypair from disk
- `src/core/identity/resolver.ts` — `resolveIdentity`, `formatIdentity`, `identityToString`; audit identity resolution with caching
- `src/core/identity/storage.ts` — `saveKeyPair`, `loadPrivateKey`, `loadPublicKey`; disk persistence at `~/.noorm/`
- `src/core/identity/sync.ts` — `registerIdentity`; syncs identity record to `__noorm_identities__` table
- `src/core/identity/env.ts` — `loadIdentityFromEnv`; CI override via `NOORM_IDENTITY_*` env vars
- `src/core/identity/hash.ts` — identity hash derivation
- `src/core/identity/types.ts` — `Identity`, `CryptoIdentity`, `KnownUser`, `IdentityOptions`
- `src/core/vault/storage.ts` — vault CRUD (`initVault`, `getSecret`, `setSecret`, `removeSecret`, `listSecrets`)
- `src/core/vault/key.ts` — `generateVaultKey`, `encryptVaultKey`, `decryptVaultKey`, `encryptSecret`, `decryptSecret`
- `src/core/vault/copy.ts` — `copyVaultKey`; share vault access with another identity
- `src/core/vault/propagate.ts` — `propagateVault`; push vault data across configs
- `src/core/vault/resolve.ts` — `resolveVaultSecret`; read a secret at runtime for template context injection
- `src/core/vault/events.ts` — vault observer event types
- `src/core/logger/logger.ts` — `Logger`; structured logging with levels, rotation, redaction
- `src/core/logger/redact.ts` — pattern-based redaction of sensitive values
- `src/core/logger/formatter.ts` — log line formatting
- `src/core/logger/rotation.ts` — log file rotation
- `src/core/logger/queue.ts` — async write queue to prevent I/O blocking
- `src/core/logger/classifier.ts` — log level classification
- `src/core/sql-terminal/executor.ts` — `executeRawSql`; raw SQL execution without runner tracking
- `src/core/sql-terminal/history.ts` — `SqlHistoryManager`; persistent SQL REPL history

## Docs

- `docs/dev/identity.md` — cryptographic identity internals
- `docs/dev/vault.md` — vault internals
- `docs/dev/secrets.md` — secret management
- `docs/dev/logger.md` — logger internals
- `docs/dev/sql-terminal.md` — SQL terminal internals
- `docs/guide/environments/vault.md` — user guide: vault
- `docs/guide/environments/secrets.md` — user guide: secrets
- `docs/cli/identity.md` — identity CLI reference
- `docs/dev/headless.md` — headless/CI identity override docs

## Coupling

- Identity keypair is used by `src/core/state/manager.ts` for state encryption/decryption — identity must initialize before StateManager loads.
- Vault uses the identity hash for per-user encryption key derivation — identity + vault are tightly coupled.
- Logger uses `src/core/observer.ts` events to capture log lines from all modules.
- SQL terminal history writes to `~/.noorm/sql-history/` — path convention separate from project `.noorm/`.
- CI environment loads identity from env vars (`NOORM_IDENTITY_NAME`, `NOORM_IDENTITY_EMAIL`, `NOORM_IDENTITY_KEY`) via `loadIdentityFromEnv` — CLI init reads from keychain by default.
- `__noorm_identities__` table (defined in `src/core/shared/tables.ts`) stores registered identities — `sync.ts` writes to it.

## Conventions worth knowing

- Cryptographic identity stored at `~/.noorm/identity.key` (private) and `~/.noorm/identity.pub` (public).
- Vault secrets encrypted per-database with a vault key; vault key encrypted per-user with their public key.
- Logger redaction patterns are configurable; `redact.ts` uses regex matching against log line text.
- `loadIdentityFromEnv` checks `NOORM_IDENTITY_*` vars — used by `noorm ci identity` command for CI injection.
- Audit identity resolution caches result for duration of command execution.
