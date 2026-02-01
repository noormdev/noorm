---
"@noormdev/cli": major
"@noormdev/sdk": major
---

### Cross-Database Data Transfer

Add a complete data transfer system for copying data between databases of the same dialect (PostgreSQL, MySQL, MSSQL).

**Planning & Execution**

- Schema introspection via dialect-specific system catalogs to discover tables, columns, primary keys, identity columns, and row estimates
- Foreign key dependency graph with topological sort ensures parent tables transfer before children; graceful fallback on circular dependencies
- Same-server detection with localhost normalization (`127.0.0.1`, `::1`, `localhost.localdomain`) enables direct `INSERT INTO ... SELECT` optimization, bypassing application-level marshalling
- Cross-server path uses configurable batch streaming (default 1000 rows) with per-batch progress events
- Automatic exclusion of internal `__noorm_*` tables

**Conflict Resolution**

Four strategies for handling primary key conflicts:
- `fail` (default) — abort on first conflict
- `skip` — skip conflicting rows (`INSERT IGNORE`, `ON CONFLICT DO NOTHING`, `MERGE ... WHEN MATCHED THEN skip`)
- `update` — upsert existing rows (`ON DUPLICATE KEY UPDATE`, `ON CONFLICT DO UPDATE`, `MERGE ... THEN UPDATE`)
- `replace` — delete and re-insert (`REPLACE INTO`, delete+insert for PG/MSSQL)

**Dialect-Specific Handling**

- **PostgreSQL**: `session_replication_role = replica` for FK bypass, `OVERRIDING SYSTEM VALUE` for identity insert, `setval(pg_get_serial_sequence(...))` for sequence reset, `TRUNCATE ... CASCADE`
- **MySQL**: `SET FOREIGN_KEY_CHECKS = 0`, backtick quoting, cross-database `db.table` notation, `ALTER TABLE ... AUTO_INCREMENT` reset
- **MSSQL**: Per-table `NOCHECK CONSTRAINT ALL`, `SET IDENTITY_INSERT ON/OFF`, `DBCC CHECKIDENT` for reseed, `MERGE` statements for all conflict strategies, `[bracket]` quoting, four-part `[db].[schema].[table]` naming

**Options**: `--tables`, `--on-conflict`, `--batch-size`, `--truncate`, `--no-fk`, `--no-identity`, `--dry-run`

**UI**

- 7-phase TUI wizard: destination selection → table picker (multi-select with "all" toggle) → options → plan preview with dependency visualization → confirm → live progress bars → completion summary
- Headless mode with `--to <config>` and full JSON output support
- Observer events for real-time progress: `transfer:planning`, `transfer:plan:ready`, `transfer:table:progress`, `transfer:complete`

---

### Encrypted Secrets Vault

Add a team-shared encrypted secrets vault backed by the database with dual-layer encryption.

**Encryption Architecture**

- Dual-layer model: vault key encrypted per-user via ephemeral X25519 ECDH + HKDF-SHA256 + AES-256-GCM, secret values encrypted with the shared vault key via AES-256-GCM
- Each user receives their own encrypted copy of the vault key using their identity public key
- Access determined by presence of `encrypted_vault_key` on identity row — no separate permissions table

**Secret Resolution Hierarchy**

Three-tier priority system for secret lookups:
1. Config-specific local secrets (highest, from `.noorm/state/state.enc`)
2. Global local secrets (shared across configs)
3. Vault secrets (lowest, database-backed)

Secrets available in template context as `<%= secrets.KEY_NAME %>` via `buildSecretsContext()`.

**Operations**

- `vault init` — generate vault key, encrypt for initializer's identity
- `vault set <key> <value>` — encrypt and upsert secret with `setBy` audit trail
- `vault rm <key>` — remove secret by key
- `vault list` — list all secrets with metadata (who set them, timestamps)
- `vault cp` — copy secrets between configs with `--all`, `--force`, `--dry-run`; auto-initializes destination vault if needed
- `vault propagate` — grant vault access to all pending team members by encrypting the vault key for their public keys

**UI**

- TUI screen with secret list, defined-but-unset indicators (from settings), pending user count, and keyboard shortcuts for all operations (`[a]`dd, `[d]`elete, `[p]`ropagate, `[i]`nit)
- Headless commands with JSON output for all operations
- Observer events: `vault:initialized`, `vault:secret:created`, `vault:secret:updated`, `vault:secret:deleted`, `vault:propagated`, `vault:copy:completed`

**Database Schema**: New `__noorm_vault__` table (`secret_key`, `encrypted_value`, `set_by`, timestamps) and `encrypted_vault_key` column on `__noorm_identities__`

---

### Run

- Fix form retry on failure: reset internal `submitting` state after `onSubmit()` completes so the form is no longer permanently locked after a failed submission; parent `busy` prop still guards against double-submit during async operations
- Apply settings exclude rules to build: pass pre-filtered file list from `RunBuildScreen` to `runBuild()` instead of letting the runner re-discover all files from disk, which ignored `include`/`exclude` rules
