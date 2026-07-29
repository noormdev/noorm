# NoORM Configuration Reference

Project settings live in `.noorm/settings.yml`. Configs (database connections) are stored encrypted in `.noorm/state/`.

## Settings File (`.noorm/settings.yml`)

```yaml
# ── Build Configuration ──────────────────────────────────────
# Controls which SQL folders are included and their execution order.

build:
    # Folders to include. Paths are relative to `paths.sql`, NOT the project
    # root — with `paths.sql: ./sql`, `tables` means `./sql/tables`.
    # Empty list means all files under `paths.sql`.
    include:
        - tables
        - views
        - functions
        - indexes

    # Folders excluded from all builds. Same `paths.sql`-relative rule.
    exclude:
        - archive

# ── Paths ────────────────────────────────────────────────────
# Override default directory locations (relative to project root).

paths:
    sql: ./sql             # Schema SQL files (default: ./sql)
    changes: ./changes     # Change directories (default: ./changes)

# ── Rules ────────────────────────────────────────────────────
# Conditional include/exclude based on the active config's properties.
# All conditions within a rule are AND'd — every field must match.

rules:
    - description: "Include seed data only for test databases"
      match:
          isTest: true
      include:
          - seeds

    - description: "Exclude dangerous scripts from protected configs"
      match:
          protected: true
      exclude:
          - dangerous

# ── Stages ───────────────────────────────────────────────────
# Preconfigured templates for creating configs. Each stage provides
# default values and can enforce constraints (locked, required secrets).

stages:
    dev:
        description: "Local development database"
        locked: false        # Allow deleting configs from this stage
        defaults:
            dialect: postgres
            host: localhost
            port: 5432
            database: myapp_dev
            user: postgres
            isTest: false
            protected: false

    ci:
        description: "CI/CD test database"
        defaults:
            dialect: postgres
            isTest: true     # Cannot be overridden to false
        secrets:
            - key: DB_PASSWORD
              type: password
              required: true

    prod:
        description: "Production database"
        locked: true         # Configs from this stage cannot be deleted
        defaults:
            dialect: postgres
            protected: true  # Access ceiling: clamps resolved access to at most operator/viewer
            isTest: false
        secrets:
            - key: DB_PASSWORD
              type: password
              required: true

# ── Strict Mode ──────────────────────────────────────────────
# When enabled, all listed stages must have at least one config
# before noorm allows operations to run.

strict:
    enabled: false
    stages:
        - dev
        - prod

# ── Logging ──────────────────────────────────────────────────

logging:
    enabled: true                        # Enable file logging
    level: info                          # silent, error, warn, info, verbose
    file: .noorm/state/noorm.log         # Log file path
    maxSize: 10mb                        # Rotate when exceeded
    maxFiles: 5                          # Rotated files to keep

# ── Universal Secrets ────────────────────────────────────────
# Required by ALL stages. Stage-specific secrets with the same key
# override these.

secrets:
    - key: BACKUP_API_KEY
      type: api_key
      description: "API key for backup service"
      required: false
```

## Field Reference

### `build`

| Field | Type | Default | Description |
|---|---|---|---|
| `include` | `string[]` | `[]` (all) | Folders to build, relative to `paths.sql` |
| `exclude` | `string[]` | `[]` | Folders to always skip, relative to `paths.sql` |

#### Include/exclude paths are relative to `paths.sql`

This is the single most common misconfiguration, and it fails silently.

Entries in `build.include`, `build.exclude`, and `rules[].include` / `rules[].exclude` are matched against each file's path **relative to `paths.sql`** — never the project root. With the default `paths.sql: ./sql`:

```yaml
paths:
    sql: ./sql

build:
    include:
        - 01_tables      # correct   -> ./sql/01_tables
        - sql/01_tables  # WRONG     -> ./sql/sql/01_tables, matches nothing
```

A non-matching entry is not an error. The build reports `"status": "success"` with `"filesRun": 0` and exits `0`, so a misconfigured `include` looks exactly like a successful build — the schema is simply never created, and the failure surfaces later as a missing table.

If `noorm run build` reports success but ran zero files, check this first.

Two related forms also match nothing, for the same reason:

- `./01_tables` — a leading `./` is not stripped
- `01_tables/` — a trailing slash is not stripped

Use bare, unprefixed segment names. Nested paths (`06_seeds/cron`) are supported and follow the same rule.

### `paths`

| Field | Type | Default | Description |
|---|---|---|---|
| `sql` | `string` | `./sql` | Schema SQL directory |
| `changes` | `string` | `./changes` | Change (migration) directory |

### `rules[]`

| Field | Type | Description |
|---|---|---|
| `description` | `string?` | Human-readable rule description |
| `match.name` | `string?` | Exact config name match |
| `match.protected` | `boolean?` | Matches `guarded(config)` (`access.user !== 'admin'`) — legacy field name, current semantics |
| `match.isTest` | `boolean?` | Match test configs |
| `match.type` | `'local' \| 'remote'?` | Match connection type |
| `include` | `string[]?` | Folders to add when matched, relative to `paths.sql` |
| `exclude` | `string[]?` | Folders to skip when matched, relative to `paths.sql` |

All conditions within a rule are AND'd — every specified field must match.

### `stages.<name>`

| Field | Type | Description |
|---|---|---|
| `description` | `string?` | Shown in CLI |
| `locked` | `boolean` | Prevents deleting configs from this stage |
| `defaults.dialect` | `Dialect?` | Database dialect |
| `defaults.host` | `string?` | Database host |
| `defaults.port` | `number?` | Database port (1-65535) |
| `defaults.database` | `string?` | Database name |
| `defaults.user` | `string?` | Username |
| `defaults.password` | `string?` | Password |
| `defaults.ssl` | `boolean?` | Enable SSL |
| `defaults.isTest` | `boolean?` | Test flag (if `true`, cannot be overridden to `false`) |
| `defaults.protected` | `boolean?` | If `true`, acts as an access ceiling: resolved config `access` is clamped to at most `{ user: 'operator', mcp: 'viewer' }` |
| `secrets[]` | array | Secrets required for this stage |

### `secrets[]` (stage or universal)

| Field | Type | Default | Description |
|---|---|---|---|
| `key` | `string` | required | Secret identifier (e.g., `DB_PASSWORD`) |
| `type` | `string` | required | `'string'`, `'password'`, `'api_key'`, or `'connection_string'` |
| `description` | `string?` | — | Shown in CLI prompts |
| `required` | `boolean` | `true` | Whether the secret must be set |

### `logging`

| Field | Type | Default | Description |
|---|---|---|---|
| `enabled` | `boolean` | `true` | Enable file logging |
| `level` | `string` | `'info'` | `silent`, `error`, `warn`, `info`, `verbose` |
| `file` | `string` | `.noorm/state/noorm.log` | Log file path |
| `maxSize` | `string` | `'10mb'` | Max size before rotation |
| `maxFiles` | `number` | `5` | Rotated files to keep |

### `teardown`

Controls behavior of `db.truncate()` and `db.teardown()` operations.

| Field | Type | Default | Description |
|---|---|---|---|
| `preserveTables` | `string[]` | `[]` | Tables always preserved during truncate/teardown (in addition to noorm's internal tables) |
| `postScript` | `string` | — | SQL script to run after schema teardown |

```yaml
teardown:
    preserveTables:
        - audit_log
        - system_config
    postScript: ./scripts/post-teardown.sql
```

The SDK's `db.truncate()` and `db.teardown()` fall back to `settings.teardown.preserveTables` when not given explicit options. This is useful for protecting reference data tables or audit logs from being wiped during test resets.

## Config Object (Stored)

Configs are stored encrypted in `.noorm/state/state.enc`. Each config has:

```typescript
interface Config {
    name: string;                   // Unique identifier
    type: 'local' | 'remote';      // Connection type (default: 'local')
    isTest: boolean;                // Test database flag (default: false)
    access: {                       // Per-channel access roles (replaces the legacy `protected` boolean)
        user: 'viewer' | 'operator' | 'admin';           // CLI/TUI/SDK role (default: 'admin')
        mcp: 'viewer' | 'operator' | 'admin' | false;    // MCP role; `false` hides the config from MCP (default: 'admin')
    };
    connection: {
        dialect: 'postgres' | 'mysql' | 'sqlite' | 'mssql';
        host?: string;              // Required for non-SQLite
        port?: number;
        database: string;           // Required
        filename?: string;          // SQLite alternative to database
        user?: string;
        password?: string;
        ssl?: boolean | {
            rejectUnauthorized?: boolean;
            ca?: string;
            cert?: string;
            key?: string;
        };
        pool?: {
            min?: number;
            max?: number;
        };
    };
    identity?: string;              // Optional identity override
}
```

## Stage Constraints

`defaults.isTest: true` cannot be overridden to `false` for configs created from that stage. `defaults.protected: true` works differently: it is an access **ceiling** applied at config resolution — a config linked to that stage gets its resolved `access` clamped to at most `{ user: 'operator', mcp: 'viewer' }`, no matter what `access` the config itself declares. This enforces safety invariants — a production stage stays guarded, a test stage stays flagged as test.

See `docs/spec/config-access-roles.md` for the full per-channel access model (`viewer`/`operator`/`admin` roles, the permission matrix, and MCP's `access.mcp: false` invisibility).

## Minimal Settings Example

For a simple project with just dev and test:

```yaml
paths:
    sql: ./sql
    changes: ./changes

stages:
    dev:
        defaults:
            dialect: postgres
            host: localhost
            port: 5432

    test:
        defaults:
            dialect: postgres
            host: localhost
            port: 5432
            isTest: true

rules:
    - match:
          isTest: true
      include:
          - seeds
```
