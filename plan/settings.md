# Settings


## Overview

Settings define project-wide build behavior and stage configuration. Unlike encrypted configs (credentials), settings are **version controlled** and shared across the team.

Location: `.noorm/settings.yml`


## Key Differences from Config

| Aspect | Config | Settings |
|--------|--------|----------|
| Location | `.noorm/state.enc` | `.noorm/settings.yml` |
| Contains | Credentials, secrets | Build rules, paths, stages |
| Version control | Gitignored | Committed |
| Per-machine | Yes (encrypted) | No (shared) |
| CLI management | `noorm config` | `noorm settings` |


## File Structure

```
.noorm/
├── state.enc         # Encrypted configs (gitignored)
└── settings.yml      # Shared settings (committed)
```


## Features


### Build Configuration

Control which folders are included in builds and their execution order.

```yaml
build:
    # Folders to include, executed in this order
    include:
        - schema/tables
        - schema/views
        - schema/functions
        - schema/seeds

    # Folders to exclude from all builds
    exclude:
        - schema/archive
        - schema/experiments
```

- `include` defines execution order (first listed = first executed)
- `exclude` prevents folders from ever being processed
- Relative paths from project root


### Path Configuration

Override default locations for schema and changeset files.

```yaml
paths:
    schema: ./db/schema
    changesets: ./db/changesets
```


### Stage-Based Rules

Run or skip files/folders based on the active config's stage properties. Conditions use **AND matching** (all specified conditions must be true).

```yaml
rules:
    # Run seeds only in test/dev environments
    - match:
          isTest: true
      include:
          - schema/seeds

    # Skip destructive scripts on protected configs
    - match:
          protected: true
      exclude:
          - schema/dangerous

    # Run this only on local configs named 'dev'
    - match:
          name: dev
          type: local
      include:
          - schema/dev-only

    # Skip performance-heavy scripts on remote test databases
    - match:
          isTest: true
          type: remote
      exclude:
          - schema/heavy-seeds
```

**Match conditions:**

| Condition | Type | Description |
|-----------|------|-------------|
| `name` | string | Config name (exact match) |
| `protected` | boolean | Protected config flag |
| `isTest` | boolean | Test database flag |
| `type` | 'local' \| 'remote' | Connection type |

All conditions in a rule are AND'd together. Multiple rules are evaluated in order; later rules can override earlier ones.


### Preconfigured Configs (Stages)

Define standard configs with defaults, constraints, and required secrets. These configs are managed by the team and shared via version control.

```yaml
stages:
    dev:
        description: Local development database
        locked: false                    # Can be deleted
        defaults:
            dialect: postgres
            host: localhost
            port: 5432
            database: myapp_dev
            user: postgres
            password: postgres
            isTest: false
            protected: false

    test:
        description: Test database for CI
        locked: true                     # Cannot be deleted
        defaults:
            dialect: postgres
            host: localhost
            port: 5432
            database: myapp_test
            isTest: true
            protected: false
        secrets:                         # Required secrets for this stage
            - key: TEST_SEED_PASSWORD
              type: password
              description: Password for test seed user

    staging:
        description: Staging environment
        locked: true
        defaults:
            dialect: postgres
            protected: false
        secrets:
            - key: DB_PASSWORD
              type: password
              description: Database password
            - key: READONLY_USER
              type: string
              description: Read-only database user name
            - key: READONLY_PASSWORD
              type: password
              description: Password for read-only user

    prod:
        description: Production database
        locked: true                     # Cannot be deleted
        defaults:
            dialect: postgres
            protected: true              # Always protected
        secrets:
            - key: DB_PASSWORD
              type: password
              description: Database password
            - key: READONLY_USER
              type: string
            - key: READONLY_PASSWORD
              type: password
            - key: ADMIN_API_KEY
              type: api_key
              description: Admin API key for management endpoints
```


### Stage Properties

| Property | Type | Description |
|----------|------|-------------|
| `description` | string | Human-readable description shown in CLI |
| `locked` | boolean | If true, config cannot be deleted (default: false) |
| `defaults` | object | Default values when creating config from this stage |
| `secrets` | array | Required secrets that must be set |


### Stage Defaults

Defaults provide initial values when creating a config from a stage. Users can override any value except those enforced by constraints.

**Enforceable constraints:**

| Default | Behavior |
|---------|----------|
| `protected: true` | Cannot be overridden to false |
| `isTest: true` | Cannot be overridden to false |
| `dialect` | Cannot be changed after creation |


### Required Secrets

Each stage can define secrets that must be set before the config is usable:

```yaml
secrets:
    - key: DB_PASSWORD           # Secret key name
      type: password             # Known type for UI hints
      description: Database...   # Shown in CLI prompts
      required: true             # Default: true
```

**Secret Types:**

| Type | Behavior |
|------|----------|
| `string` | Plain text input |
| `password` | Masked input, no echo |
| `api_key` | Masked input, validated format |
| `connection_string` | Validated as URI |

When a config is created from a stage with required secrets:

1. CLI prompts for each required secret
2. Secrets are validated by type
3. Config is not usable until all required secrets are set
4. `noorm config validate` checks completeness


### Strict Mode

Require certain stages to exist before operations can run.

```yaml
strict:
    enabled: true
    stages:
        - dev
        - test
        - staging
        - prod
```

When strict mode is enabled:

- User must have configs matching all required stages
- Prevents accidental operations against wrong databases
- `noorm config add` prompts to select from predefined stages


## CLI Commands


### View Settings

```bash
noorm settings              # Show current settings
noorm settings get <key>    # Get specific value
```


### Modify Settings

```bash
noorm settings set <key> <value>    # Set a value
noorm settings add <key> <value>    # Add to array
noorm settings rm <key> [value]     # Remove key or array item
```


### Initialize Settings

```bash
noorm settings init         # Create default settings.yml
noorm settings init --force # Overwrite existing
```


## Validation

Settings are validated on load using Zod schemas. Invalid settings prevent noorm from starting.

Validation includes:

- Required fields present
- Paths exist (or can be created)
- Stage definitions are complete
- Stage secret definitions have valid types
- Rule conditions use valid properties
- No circular dependencies in build order
- Locked stages reference existing configs (warning only)


## Default Settings

When no `settings.yml` exists, noorm uses sensible defaults:

```yaml
build:
    include:
        - schema
    exclude: []

paths:
    schema: ./schema
    changesets: ./changesets

rules: []

stages: {}

strict:
    enabled: false
    stages: []
```


## Integration with Config Resolution

Settings are loaded before config resolution and affect:

1. **Path defaults** - `paths` in settings provide defaults if config doesn't specify
2. **Build behavior** - `include`/`exclude` filter what files are processed
3. **Rule evaluation** - Rules checked against active config before each operation
4. **Stage validation** - Strict mode validates config exists for required stages
5. **Config creation** - Stage defaults are applied when creating from a stage
6. **Config deletion** - Locked stages prevent config deletion
7. **Secret validation** - Required secrets must be set before config is usable


## Observer Events

```typescript
observer.emit('settings:loaded', { path, settings })
observer.emit('settings:saved', { path })
observer.emit('settings:validation-error', { errors })
observer.emit('settings:rule-applied', { rule, config, result })
```
