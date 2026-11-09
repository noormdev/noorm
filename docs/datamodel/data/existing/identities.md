---
entity: identities
group: existing
description: "Team-discovery identities and encrypted vault-key access."
pk: [id]
columns:
  id: { type: "serial / int identity(1,1) / integer auto-increment", desc: "Generated primary key (PostgreSQL / MSSQL / MySQL and SQLite)." }
  identity_hash: { type: "varchar(64)", desc: "SHA-256 of email, name, machine, and OS." }
  email: { type: "varchar(255)", desc: "User email." }
  name: { type: "varchar(255)", desc: "Display name." }
  machine: { type: "varchar(255)", desc: "Machine hostname." }
  os: { type: "varchar(255)", desc: "OS platform and version." }
  public_key: { type: text, desc: "X25519 public key in hex." }
  encrypted_vault_key: { type: text, nullable: true, desc: "Vault key encrypted for this identity; null without vault access." }
  registered_at: { type: "timestamp / datetime2", default: CURRENT_TIMESTAMP, desc: "First registration timestamp." }
  last_seen_at: { type: "timestamp / datetime2", default: CURRENT_TIMESTAMP, desc: "Last activity timestamp." }
ak:
  - { rule: unique_identity_hash, columns: [identity_hash] }
examples:
  - { id: 1, identity_hash: "[illustrative hash 1]", email: "alice@example.invalid", name: "Alice Example", machine: "workstation-a", os: "linux", public_key: "[masked illustrative public key 1]", encrypted_vault_key: "[masked illustrative ciphertext 1]", registered_at: "2026-01-01 10:00:00", last_seen_at: "2026-02-01 12:00:00" }
  - { id: 2, identity_hash: "[illustrative hash 2]", email: "bob@example.invalid", name: "Bob Example", machine: "workstation-b", os: "darwin", public_key: "[masked illustrative public key 2]", encrypted_vault_key: null, registered_at: "2026-02-01 10:00:00", last_seen_at: "2026-02-01 10:00:00" }
  - { id: 3, identity_hash: "[illustrative hash 3]", email: "alice@example.invalid", name: "Alice Example", machine: "laptop-a", os: "darwin", public_key: "[masked illustrative public key 3]", encrypted_vault_key: "[masked illustrative ciphertext 3]", registered_at: "2026-01-15 09:00:00", last_seen_at: "2026-02-01 11:00:00" }
---

# identities

Stores identities for team discovery, populated on first connect when identity is configured. An identity may have an encrypted key for accessing shared [[vault|vault secrets]]. Examples are synthetic and illustrative; hashes and key material are masked placeholders, not real cryptographic values.

## Example scenarios

These are synthetic snapshots, not activity events. Alice's workstation identity has been active since registration and has vault access; Bob's has not been seen since registration and has no vault access. Alice's laptop is a separate identity for the same user on a different machine, with a distinct illustrative hash. No access is represented by `null`, not empty ciphertext.

## Rules and source

`identity_hash` is unique. Only `encrypted_vault_key` is nullable; null represents an identity without vault access. No database foreign key connects identity strings to other tables. Timestamps use MSSQL `datetime2` and `timestamp` elsewhere, as naive wall-clock values interpreted as UTC. Source: `src/core/version/schema/migrations/v1.ts` and `src/core/shared/tables.ts`.
