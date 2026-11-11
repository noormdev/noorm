# NoORM Configuration Reference

Project settings live in `.noorm/settings.yml`. Configs (database connections) are stored encrypted in `.noorm/state/`.

## Settings File (`.noorm/settings.yml`)

```yaml
# ── Build Configuration ──────────────────────────────────────
# Controls which SQL folders are included and their execution order.

build:
    # Folders to include. Paths are relative to `paths.sql`, NOT the project
    # root — with `paths.sql: ./db/sql`, `tables` means `./db/sql/tables`.
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
    sql: ./db/sql          # Schema SQL files (default: ./db/sql)
    changes: ./db/changes  # Change directories (default: ./db/changes)

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
            isTest: true     # Inherited unless a higher-priority source overrides it
        secrets:
            - key: DB_PASSWORD
              type: password
              required: true

    prod:
        description: "Production database"
        locked: true         # Configs from this stage cannot be deleted
        defaults:
            dialect: postgres
            protected: true  # Per-permission ceiling from original operator/user and viewer/agent matrices
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

Entries in `build.include`, `build.exclude`, and `rules[].include` / `rules[].exclude` are matched against each file's path **relative to `paths.sql`** — never the project root. With the `paths.sql: ./db/sql` that `noorm init` writes:

```yaml
paths:
    sql: ./db/sql

build:
    include:
        - 01_tables      # correct   -> ./db/sql/01_tables
        - sql/01_tables  # WRONG     -> ./db/sql/sql/01_tables, matches nothing
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
| `sql` | `string` | `./db/sql` | Schema SQL directory |
| `changes` | `string` | `./db/changes` | Change directory |

### `access.roles`

Define role policy in project settings; assign role names to each config's `access.user` and `access.agent` in the TUI or imported config.

```yaml
access:
    roles:
        operator:
            permissions:
                sql:write: confirm
        deployer:
            extends: operator
            permissions:
                run:build: allow
```

Built-in overrides retain unspecified defaults. Custom roles inherit their parent's effective policy, including overrides; without `extends`, unspecified permissions deny. Unknown permissions, values, parents and inheritance cycles are rejected. Unknown assigned roles fail closed. Agent CLI calls cannot self-confirm, even with `--yes` or `NOORM_YES`; MCP may mediate a human approval. Denies cannot be approved.

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
| `defaults.ssl` | `boolean \| { caFile?, certFile?, keyFile?, rejectUnauthorized? }?` | SSL on or off, or file-form certificates. Inline `ca`, `cert` and `key` are refused. A relative path must exist under every machine's project root. A stage `rejectUnauthorized` applies only to a config with no `ssl` of its own |
| `defaults.type` | `'local' \| 'remote'?` | Connection type default |
| `defaults.access` | `ConfigAccess?` | Per-channel role defaults |
| `defaults.isTest` | `boolean?` | Test default; a false override is a stage-completeness violation |
| `defaults.protected` | `boolean?` | Caps each effective permission by the original operator matrix for users or viewer matrix for agents, without changing role names |
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
        user: string;             // Built-in or project role (default: 'admin')
        agent: string | false;    // Built-in or project role; false hides it from agents (default: 'viewer')
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
            ca?: string;            // PEM text; not with caFile in one layer
            cert?: string;          // PEM text; not with certFile
            key?: string;           // PEM text; not with keyFile
            caFile?: string;        // Path, read each time a pool opens, on every connect attempt
            certFile?: string;
            keyFile?: string;
        };
        pool?: {
            min?: number;
            max?: number;
            idleTimeoutMs?: number;     // PostgreSQL (0 disables), MySQL and MSSQL (must be > 0)
            maxLifetimeMs?: number;     // PostgreSQL only
            maxUses?: number;           // PostgreSQL only
            allowExitOnIdle?: boolean;  // PostgreSQL only
            acquireTimeoutMs?: number;  // MySQL and MSSQL only
            createTimeoutMs?: number;   // MySQL and MSSQL only
            reapIntervalMs?: number;    // MySQL and MSSQL only
        };
        connectTimeoutMs?: number;
        tlsServerName?: string;     // PostgreSQL, MySQL, MSSQL; MySQL and MSSQL take a hostname only
        statementTimeoutMs?: number;
        queryTimeoutMs?: number;
        applicationName?: string;
        keepAlive?: boolean;
        keepAliveInitialDelayMs?: number; // PostgreSQL and MySQL only
    };
    identity?: string;              // Optional identity override
}
```

**SSL files:** a path is stored as written and the file is read each time a pool opens, on every connect attempt, so a rotated file needs no config change. A relative path resolves from the working directory (the project root in the CLI and TUI) or the SDK's `projectRoot`; `~/` is the home directory. An empty path or both forms of one field in one layer fails validation naming the field. An unreadable, empty, non-regular, over-1-MiB or non-PEM file fails the connection with `SslFileError` (`field`, `path`, `code`, no content). A file-form setting is stored as its path, never content; `config export` copies `ssl` as stored, so inline PEM exports as PEM. `config import` does not check that the file exists.

**Environment:** `NOORM_CONNECTION_SSL_caFile`, `_certFile`, `_keyFile` (camelCase segment), beside `NOORM_CONNECTION_SSL_rejectUnauthorized`. `NOORM_CONNECTION_SSL_CA`, `_CERT`, `_KEY` set inline PEM. A scalar `NOORM_CONNECTION_SSL` beside a nested `NOORM_CONNECTION_SSL_*` variable fails with an error that names both: set one form, not both. An `ssl` segment in another letter case (`NOORM_CONNECTION_SSL_CAFILE`) is refused with the right spelling.

**Layers combine `ssl` field by field:** a higher `false` turns SSL off; a higher `true` keeps a lower object's `ca`, `cert` and `key` fields; an object over an object replaces each of them with the higher layer's form, inline or file. `rejectUnauthorized` is never inherited: it comes from the highest layer that sets `ssl`, so a layer that sets `ssl` without it validates, and a stage `rejectUnauthorized: false` reaches only a config with no `ssl`. `config sync` applies the same rule with the stage as the higher layer.

**Dialects:** PostgreSQL, MySQL and MSSQL honor the certificates and `rejectUnauthorized`. `tlsServerName` needs `ssl` on and validation on PostgreSQL and MySQL; MySQL and MSSQL refuse an IP address. On MSSQL, `ssl: { rejectUnauthorized: false }` encrypts without validating the certificate and lifts the IP-host name requirement. A rejected certificate's error names `ssl.caFile` and `ssl.rejectUnauthorized: false`; a hostname mismatch names `tlsServerName`.

**TUI:** connects with the stored config over its stage's defaults (defaults, then stage, then stored). No config variable (`NOORM_CONNECTION_*`, `NOORM_ACCESS_*`) and no flag is applied to a config, so access roles never come from the environment. Settings variables still apply: `NOORM_STAGES_<stage>_DEFAULTS_*` changes the stage defaults the TUI merges, as `NOORM_PATHS_*` changes its paths. A stage `isTest: true` does not grant the test-database exemption; only the stored config's own does. A stored config that does not combine with its stage into a valid config leaves no config active, shows the message on Home, and stays editable.

| TUI surface | Behavior |
|---|---|
| Add and edit forms | Use SSL, Verify Certificate (unchecked stores `ssl.rejectUnauthorized: false`), CA File, Client Cert File, Client Key File, TLS Server Name |
| Edit form | Shows the state in effect. A file the stage supplies shows the placeholder `(stage: <path>)`. A save that touches no SSL field leaves the stored `ssl` as it was |
| Add form | Shows no stage state; the stage still applies beneath the connection test and the submit check |
| Config list | `[tls]`, `[tls unverified]`, or no tag when SSL is off |
| Export (`+`, `x`) | Carries every stored connection field except `user`, `password`, and inline `ssl.key` and `ssl.cert`; `tlsServerName`, `pool`, timeouts and certificate file paths travel |
| Import (`+`, `i`) | Saves the fields the schema accepts with `user` and `password` from its form; the preview shows the incoming TLS settings; a certificate file path must exist on the importing machine |

A certificate file error is never shown as a missing database.

The [connection field reference](https://noorm.dev/dev/config#config-structure) owns stored field semantics. A pool or keepalive option the dialect does not support fails validation, as does an unknown pool key or a `pool.min` above `pool.max`. `pool.idleTimeoutMillis` is a deprecated alias of `pool.idleTimeoutMs`. Runtime password and TLS callbacks and `driver` options belong to SDK options, not this stored shape. See the [SDK connection reference](https://noorm.dev/reference/sdk#createcontext-options).

## Stage Constraints

Stage defaults fill fields below stored, environment, and inline values, in the CLI, SDK and TUI. A stage-completeness check reports a false `isTest` override when the stage requires `true`; `requireTest` checks the final resolved flag. At policy-check time, `defaults.protected: true` caps each effective permission against the original operator matrix for users or viewer matrix for agents. The stricter cell wins (`deny` < `confirm` < `allow`); overrides cannot raise the ceiling and assigned role names do not change. The one exception is an `isTest` config, which lifts the ceiling; see the test-database paragraph in [SKILL.md](../SKILL.md#configuration-resolution). See [stage behavior](https://noorm.dev/guide/environments/stages) for TUI seeding and [config commands](https://noorm.dev/headless#config-create) for explicit creation and sync.

Create stored configs with `noorm config create --stage staging --name review` or `noorm config create --all`; overwrites require literal `--force --yes` and authorization. Creation does not implicitly persist stage or environment passwords. Use `noorm config sync --stage staging --name review --json` to preview current defaults, then `--yes` to apply without a prompt. These aliases require an unprotected stage; a protected stage requires the config name to match the stage name because no stage association is stored. Sync preserves passwords and absent fields, refuses a different dialect, and requires `config:write`. Stage access assignments may name project roles and remain subject to validation and protected-stage permission ceilings.

See `docs/spec/config-access-roles.md` for the full per-channel access model and MCP's `access.agent: false` invisibility.

## Minimal Settings Example

For a simple project with just dev and test:

```yaml
paths:
    sql: ./db/sql
    changes: ./db/changes

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
