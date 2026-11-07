---
entity: vault
group: existing
description: "Encrypted shared secret values indexed by secret name."
pk: [id]
columns:
  id: { type: "serial / int identity(1,1) / integer auto-increment", desc: "Generated primary key (PostgreSQL / MSSQL / MySQL and SQLite)." }
  secret_key: { type: "varchar(255)", desc: "Secret name." }
  encrypted_value: { type: text, desc: "AES-256-GCM encrypted value, serialized as JSON with iv, authTag, and ciphertext." }
  set_by: { type: "varchar(255)", desc: "Identity string of the person who set the secret." }
  created_at: { type: "timestamp / datetime2", default: CURRENT_TIMESTAMP, desc: "Creation timestamp." }
  updated_at: { type: "timestamp / datetime2", default: CURRENT_TIMESTAMP, desc: "Last update timestamp." }
ak:
  - { rule: unique_vault_secret_key, columns: [secret_key] }
examples:
  - { id: 1, secret_key: API_KEY, encrypted_value: "[masked illustrative encrypted payload 1]", set_by: "alice@example.invalid", created_at: "2026-02-01 10:00:00", updated_at: "2026-02-01 10:00:00" }
  - { id: 2, secret_key: DB_PASSWORD, encrypted_value: "[masked illustrative encrypted payload 2]", set_by: "bob@example.invalid", created_at: "2026-01-01 10:00:00", updated_at: "2026-02-01 11:00:00" }
---

# vault

Stores encrypted team-shared secrets. The vault key is distributed to team members using their public keys in [[identities]]. Examples are synthetic and illustrative; ciphertext is masked and contains no real credential.

## Example scenarios

These synthetic rows are current snapshots, not a history of secret values. `API_KEY` is newly created by Alice; `DB_PASSWORD` was created earlier and later updated or rotated by Bob, a different setter. The masked payloads are illustrative, not credentials. Removing a secret leaves no vault row for it, rather than a row with an empty value.

## Rules and source

All columns are non-null and `secret_key` is unique; the migration also creates a separate index on it. `set_by` is an identity string, not a foreign key. Timestamps use MSSQL `datetime2` and `timestamp` elsewhere, as naive wall-clock values interpreted as UTC. Source: `src/core/version/schema/migrations/v1.ts` and `src/core/shared/tables.ts`.
