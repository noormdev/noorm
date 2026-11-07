---
entity: version
group: existing
description: "Installed CLI and internal schema versions."
pk: [id]
columns:
  id: { type: "serial / int identity(1,1) / integer auto-increment", desc: "Generated primary key (PostgreSQL / MSSQL / MySQL and SQLite)." }
  cli_version: { type: "varchar(50)", desc: "CLI semantic version." }
  noorm_version: { type: integer, desc: "Database tracking schema version." }
  state_version: { type: integer, desc: "State file schema version." }
  settings_version: { type: integer, desc: "Settings file schema version." }
  installed_at: { type: "timestamp / datetime2", default: CURRENT_TIMESTAMP, desc: "First installation timestamp." }
  upgraded_at: { type: "timestamp / datetime2", default: CURRENT_TIMESTAMP, desc: "Last upgrade timestamp." }
examples:
  - { id: 1, cli_version: "1.0.0", noorm_version: 1, state_version: 1, settings_version: 1, installed_at: "2026-01-01 10:00:00", upgraded_at: "2026-01-01 10:00:00" }
  - { id: 1, cli_version: "1.2.3", noorm_version: 2, state_version: 3, settings_version: 1, installed_at: "2026-01-01 10:00:00", upgraded_at: "2026-02-01 10:00:00" }
  - { id: 1, cli_version: "1.2.3", noorm_version: 2, state_version: 3, settings_version: 1, installed_at: "2026-03-01 10:00:00", upgraded_at: "2026-03-01 10:00:00" }
---

# version

Records the CLI and internal schema versions used to manage upgrades. The examples are synthetic, illustrative alternatives, not a claim that multiple rows are normally installed.

## Example scenarios

These rows are alternative installation snapshots, not concurrent singleton rows or an event history. The first illustrates a fresh schema 1 installation; the second, an installation upgraded to schema 2; the third, a fresh current schema 2 installation with no subsequent upgrade. CLI versions are illustrative; current schema, state, and settings versions are 2, 3, and 1 respectively.

## Rules and source

All columns are non-null. IDs are generated using PostgreSQL `serial`, MSSQL `int identity(1,1)`, or an auto-incrementing `integer` elsewhere. Timestamp columns use MSSQL `datetime2` and `timestamp` elsewhere; these are naive wall-clock values interpreted as UTC by application code. Source: `src/core/version/schema/migrations/v1.ts` and `src/core/shared/tables.ts`; v2 moves the PostgreSQL and MSSQL table into the `noorm` schema.
