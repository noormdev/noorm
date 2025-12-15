# Config Management


## Overview

Configs define how noorm connects to databases and where to find schema/changeset files. They support multiple environments, environment variable overrides, and protected configs for production safety.


## Data Model

```yaml
Config:
    name: string              # Identifier (dev, staging, prod)
    type: local | remote      # Connection type
    isTest: boolean           # Test database flag
    protected: boolean        # Requires confirmation for dangerous ops

    connection:
        dialect: postgres | mysql | sqlite | mssql
        host: string          # Required for non-SQLite
        port: number
        database: string
        user: string
        password: string
        ssl: boolean
        pool: { min, max }

    paths:
        schema: string        # Relative to project root
        changesets: string

    identity: string          # Optional override for executed_by
```

**ConfigSummary** (for listings):

```yaml
ConfigSummary:
    name: string
    type: local | remote
    isTest: boolean
    protected: boolean
    isActive: boolean
    dialect: string
    database: string
```


## Architecture

```mermaid
graph TB
    subgraph "Input Sources"
        CLI[CLI Flags]
        ENV[Environment Variables]
        STATE[Stored Configs]
        SETTINGS[Settings Stages]
        DEFAULTS[Defaults]
    end

    subgraph "Config Resolution"
        RESOLVER[Config Resolver]
        VALIDATOR[Zod Validator]
        CONSTRAINTS[Stage Constraints]
    end

    subgraph "Output"
        CONFIG[Resolved Config]
    end

    CLI --> RESOLVER
    ENV --> RESOLVER
    STATE --> RESOLVER
    SETTINGS --> RESOLVER
    DEFAULTS --> RESOLVER
    RESOLVER --> CONSTRAINTS
    CONSTRAINTS --> VALIDATOR
    VALIDATOR --> CONFIG
```


## Resolution Priority

Configs are resolved by merging multiple sources. Higher priority sources override lower ones:

```
1. CLI flags           (highest)
2. Environment vars
3. Stored config
4. Stage defaults      (from settings.yml)
5. Defaults            (lowest)
```

**Stage Constraints:**

When a config is linked to a stage (via `--stage` flag or matching name), certain stage-defined constraints are enforced:

| Constraint | Behavior |
|------------|----------|
| `locked: true` | Config cannot be deleted |
| `protected: true` in defaults | Cannot be overridden to false |
| `isTest: true` in defaults | Cannot be overridden to false |
| `secrets` defined | Required secrets must be set before config is usable |

**Resolution Flow:**

```
resolveConfig(options):

    1. Determine config name from:
       - options.name (explicit)
       - NOORM_CONFIG env var
       - Active config in state

    2. If no name found:
       - Check if env vars provide enough to run (dialect + database)
       - If yes, build config from env only
       - If no, return null

    3. Load stored config by name
       - Throw if name provided but not found

    4. Merge sources:
       defaults <- stored <- env <- flags

    5. Validate merged result

    6. Return resolved config
```


## Environment Variables

All config properties can be overridden via environment variables:

| Variable | Maps To |
|----------|---------|
| `NOORM_DIALECT` | connection.dialect |
| `NOORM_HOST` | connection.host |
| `NOORM_PORT` | connection.port |
| `NOORM_DATABASE` | connection.database |
| `NOORM_USER` | connection.user |
| `NOORM_PASSWORD` | connection.password |
| `NOORM_SSL` | connection.ssl |
| `NOORM_SCHEMA_PATH` | paths.schema |
| `NOORM_CHANGESET_PATH` | paths.changesets |
| `NOORM_PROTECTED` | protected |
| `NOORM_IDENTITY` | identity |

**Behavior variables** (not mapped to config):

| Variable | Purpose |
|----------|---------|
| `NOORM_CONFIG` | Which config to use |
| `NOORM_YES` | Skip confirmations |
| `NOORM_JSON` | JSON output mode |
| `NOORM_PASSPHRASE` | Encryption passphrase |


## Validation

Configs are validated using Zod schemas. Key rules:

- `name` - Required, alphanumeric with hyphens/underscores
- `connection.dialect` - Must be postgres, mysql, sqlite, or mssql
- `connection.host` - Required for non-SQLite dialects
- `connection.port` - Integer between 1-65535
- `connection.database` - Required
- `paths.schema` - Required
- `paths.changesets` - Required

**Default Ports:**

| Dialect | Port |
|---------|------|
| postgres | 5432 |
| mysql | 3306 |
| mssql | 1433 |
| sqlite | N/A |


## Config Completeness

A config is considered "complete" when all required secrets (defined by its stage) are set. Incomplete configs have limited functionality:

| State | Allowed Operations |
|-------|-------------------|
| Complete | All operations |
| Incomplete | `config edit`, `secret set`, `config validate` |

**Checking Completeness:**

```bash
noorm config validate [name]    # Check if config is complete
```

Output shows:
- Missing required secrets
- Invalid secret types
- Stage constraint violations


## Protected Config Behavior

Protected configs add safety checks for dangerous operations:

```mermaid
flowchart TD
    ACTION[Action Requested] --> CHECK{Config Protected?}
    CHECK -->|No| ALLOW[Execute]
    CHECK -->|Yes| BLOCKED{Action Blocked?}
    BLOCKED -->|Yes| DENY[Deny with message]
    BLOCKED -->|No| CONFIRM{Requires Confirmation?}
    CONFIRM -->|No| ALLOW
    CONFIRM -->|Yes| SKIP{NOORM_YES set?}
    SKIP -->|Yes| ALLOW
    SKIP -->|No| PROMPT[Prompt: yes-configname]
    PROMPT --> VALID{Valid?}
    VALID -->|Yes| ALLOW
    VALID -->|No| DENY
```

**Action Classification:**

| Action | Protected Behavior |
|--------|-------------------|
| change:run | Requires confirmation |
| change:revert | Requires confirmation |
| change:ff | Requires confirmation |
| change:next | Requires confirmation |
| run:build | Requires confirmation |
| run:file | Requires confirmation |
| run:dir | Requires confirmation |
| db:create | Requires confirmation |
| db:destroy | **Blocked entirely** |
| config:rm | Requires confirmation |


## CI/CD Mode

When running in CI (`CI=1` or `-H` flag), configs can be built entirely from environment variables:

```
CI Pipeline:
    1. Set NOORM_* environment variables
    2. Run: noorm config ci [name]
       - Creates config from env vars
       - Marks as test if CI=1
       - Sets as active
    3. Run: noorm run build
       - Uses the CI config
```

**Minimum required env vars for CI:**
- `NOORM_DIALECT`
- `NOORM_DATABASE`


## CLI Commands

### config add

Create a new config interactively or via flags.

```
noorm config add [name]
    --stage <stage>       # Use stage defaults from settings.yml
    --dialect <dialect>
    --host <host>
    --port <port>
    --database <db>
    --user <user>
    --password <pass>
    --protected
    --test
```

When `--stage` is provided:
- Stage defaults are applied first
- CLI flags override stage defaults
- Required secrets are prompted after creation
- Config is linked to the stage (inherits constraints)

### config edit

Edit an existing config interactively.

```
noorm config edit [name]
```

Stage-linked configs cannot modify constrained fields (e.g., `protected: true` cannot be changed to false).

### config rm

Remove a config. Protected configs require confirmation. Locked configs (from stage settings) cannot be deleted.

```
noorm config rm [name]
```

### config validate

Check if a config is complete and usable.

```
noorm config validate [name]
```

Returns:
- Missing required secrets
- Stage constraint violations
- Connection test result (optional)

### config list

Display all configs with summary info.

```
noorm config list
```

### config use

Set the active config.

```
noorm config use [name]
```

### config copy

Clone a config to a new name.

```
noorm config copy [source] --to <target>
```

New config starts unprotected regardless of source.

### config ci

Create config from environment variables (for CI pipelines).

```
noorm config ci [name]
    --set-active    # Default: true
```


## Secrets

Secrets are stored encrypted and used for **SQL template interpolation**, not CLI configuration.


### Config-Scoped Secrets

Per-config secrets are tied to a specific database configuration:

```sql
-- schema/users/create-readonly-user.sql.eta
CREATE USER <%~ $.secrets.READONLY_USER %>
WITH PASSWORD '<%~ $.secrets.READONLY_PASSWORD %>';
```

**Management:**

```
noorm secret set <key> <value> [--config <name>]
noorm secret rm <key> [--config <name>]
noorm secret list [--config <name>]
```


### Global Secrets

App-level secrets shared across all configs:

```sql
-- Access global secrets in templates
<%~ $.globalSecrets.SHARED_API_KEY %>
```

**Management:**

```
noorm secret set <key> <value> --global
noorm secret rm <key> --global
noorm secret list --global
```

See `plan/state.md` for secret storage details.


## Observer Events

```
config:added     { name, config }
config:updated   { name, changes }
config:removed   { name }
config:copied    { source, target }
config:activated { name, previous }
config:ci        { name, config }
```


## Component Interactions

```mermaid
sequenceDiagram
    participant CLI
    participant Resolver
    participant State
    participant Validator
    participant Core

    CLI->>Resolver: resolveConfig(options)
    Resolver->>State: getConfig(name)
    State-->>Resolver: stored config
    Resolver->>Resolver: merge sources
    Resolver->>Validator: validate(merged)
    Validator-->>Resolver: validated config
    Resolver-->>CLI: resolved config
    CLI->>Core: execute operation
    Core->>Core: check protection
    Core-->>CLI: result
```
