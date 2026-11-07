---
entity: lock
group: existing
description: "Configuration-scoped locks against concurrent operations."
pk: [id]
columns:
  id: { type: "serial / int identity(1,1) / integer auto-increment", desc: "Generated primary key (PostgreSQL / MSSQL / MySQL and SQLite)." }
  config_name: { type: "varchar(255)", desc: "Configuration name defining lock scope." }
  locked_by: { type: "varchar(255)", desc: "Identity string of lock holder." }
  locked_at: { type: "timestamp / datetime2", default: CURRENT_TIMESTAMP, desc: "Acquisition timestamp." }
  expires_at: { type: "timestamp / datetime2", desc: "Automatic expiry timestamp." }
  reason: { type: "varchar(255)", default: "", desc: "Lock reason, or empty string." }
ak:
  - { rule: unique_lock_config, columns: [config_name] }
examples:
  - { id: 1, config_name: dev, locked_by: "alice@example.invalid", locked_at: "2026-01-01 10:00:00", expires_at: "2026-01-01 10:10:00", reason: "build" }
  - { id: 2, config_name: staging, locked_by: "bob@example.invalid", locked_at: "2026-01-01 09:45:00", expires_at: "2026-01-01 09:55:00", reason: "" }
---

# lock

Prevents concurrent operations within a configuration scope. Examples are synthetic and illustrative, with reserved fictional addresses.

## Example scenarios

At the fixed as-of time `2026-01-01 10:05:00` UTC, the `dev` lock is held and unexpired with a reason, while the `staging` lock has expired and is awaiting cleanup without a reason. These are synthetic snapshots, not lock event history. An unlocked configuration has no lock row; it is not represented by a fabricated empty row.

## Rules and source

All columns are non-null and `config_name` is unique, so at most one row exists per configuration name. `locked_by` and `config_name` are strings, not foreign keys. Timestamps use MSSQL `datetime2` and `timestamp` elsewhere; they are naive wall-clock values interpreted as UTC. Source: `src/core/version/schema/migrations/v1.ts` and `src/core/shared/tables.ts`.

## Proposal

Application-triggered pipelines need a lock per config and pipeline, so one pipeline does not block another in the same database. That scope is wider than `unique_lock_config` allows and requires the same internal schema migration as pipeline tracking. This is proposed behavior, not current schema.
