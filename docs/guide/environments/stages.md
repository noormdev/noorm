# Stages


## The Problem

Your team has three environments: development, staging, and production. Each needs different settings. Production databases must be protected. Staging might need specific secrets. Development should default to local connections.

Without a shared definition, every developer configures these differently. Someone marks dev as protected. Someone else forgets to require the production password. Inconsistency leads to mistakes.

Stages solve this. They're templates defined in your project settings that every team member shares.


## What Stages Are

A **stage** is a named template for database configs. When you create a config and assign it to a stage, the config inherits the stage's defaults and requirements.

Think of stages as blueprints:

- `dev` stage: local postgres, no protection needed
- `staging` stage: remote postgres, optional protection
- `prod` stage: remote postgres, always protected, requires password

Your project defines these once in `settings.yml`. Every developer on the team gets the same blueprints.


## Defining Stages

Stages live in `.noorm/settings.yml` under the `stages` key:

```yaml
# .noorm/settings.yml
stages:
    dev:
        description: Local development database
        defaults:
            dialect: postgres
            host: localhost
            port: 5432

    staging:
        description: Staging environment
        defaults:
            dialect: postgres
            protected: false

    prod:
        description: Production database
        locked: true
        defaults:
            dialect: postgres
            protected: true
        secrets:
            - key: DB_PASSWORD
              type: password
              description: Database password
              required: true
```

When a developer creates a config from the `prod` stage, it automatically:
- Uses postgres dialect
- Is marked as protected
- Requires a `DB_PASSWORD` secret before use


## Stage Properties

Each stage can define these properties:

| Property | Type | Description |
|----------|------|-------------|
| `description` | string | Human-readable description shown in the CLI |
| `locked` | boolean | If true, configs cannot be deleted (default: false) |
| `defaults` | object | Values applied when creating a config from this stage |
| `secrets` | array | Secrets that must be configured |


### Defaults

Defaults provide initial values when creating a config. Most can be overridden by the developer:

```yaml
stages:
    dev:
        defaults:
            dialect: postgres
            host: localhost
            port: 5432
            database: myapp_dev
```

Some defaults are **enforced** and cannot be overridden:

| Default | Behavior |
|---------|----------|
| `protected: true` | Cannot be set to false by the developer |
| `isTest: true` | Cannot be set to false by the developer |
| `dialect` | Cannot be changed after config creation |

This means if your `prod` stage sets `protected: true`, developers cannot create an unprotected production config.


### Locked Stages

Setting `locked: true` prevents configs from being deleted:

```yaml
stages:
    prod:
        locked: true
        defaults:
            protected: true
```

A locked production config cannot be accidentally removed. The developer must first change the config's stage assignment.


## Assigning a Config to a Stage

When you create a new config, noorm asks which stage to use:

```
? Select stage for new config:
  dev        Local development database
  staging    Staging environment
  prod       Production database
```

The config inherits that stage's defaults. You can also assign programmatically:

```bash
noorm config add --stage prod
```

Or through the TUI by selecting a stage during config creation.


## Stage-Specific Secrets

Stages can require secrets before a config is usable. This ensures production configs always have proper credentials.

```yaml
stages:
    prod:
        secrets:
            - key: DB_PASSWORD
              type: password
              description: Database password
              required: true

            - key: SSL_CERT
              type: string
              description: SSL certificate path
              required: false
```

Secret types control how the CLI handles input:

| Type | Behavior |
|------|----------|
| `string` | Plain text input |
| `password` | Masked input, no echo |
| `api_key` | Masked input, validated format |
| `connection_string` | Validated as URI |

Required secrets must be set before the config can run operations. Optional secrets are prompted but can be skipped.


### Universal Secrets

Some secrets apply to all configs regardless of stage. Define these at the settings root level:

```yaml
# Required by ALL configs
secrets:
    - key: ENCRYPTION_KEY
      type: password
      description: Application encryption key

stages:
    prod:
        # Additional secrets for prod only
        secrets:
            - key: DB_PASSWORD
              type: password
```

A production config would need both `ENCRYPTION_KEY` (universal) and `DB_PASSWORD` (stage-specific).


## Common Stage Patterns

Here are patterns that work well for most teams:


### Three-Environment Setup

```yaml
stages:
    dev:
        description: Local development
        defaults:
            dialect: postgres
            host: localhost
            port: 5432

    staging:
        description: Staging server
        defaults:
            dialect: postgres
            protected: false
        secrets:
            - key: DB_PASSWORD
              type: password
              required: true

    prod:
        description: Production
        locked: true
        defaults:
            dialect: postgres
            protected: true
        secrets:
            - key: DB_PASSWORD
              type: password
              required: true
```


### Test Database Stage

```yaml
stages:
    test:
        description: Ephemeral test database
        defaults:
            dialect: sqlite
            isTest: true
            database: ":memory:"
```

The `isTest: true` flag marks this as a test database. noorm uses this for conditional build rules (like including seed data only in test environments).


### Multi-Dialect Team

```yaml
stages:
    dev-postgres:
        description: Local Postgres
        defaults:
            dialect: postgres
            host: localhost

    dev-mysql:
        description: Local MySQL
        defaults:
            dialect: mysql
            host: localhost

    dev-sqlite:
        description: Local SQLite
        defaults:
            dialect: sqlite
            database: ./data/dev.db
```


### CI/CD Stage

```yaml
stages:
    ci:
        description: CI pipeline database
        defaults:
            dialect: postgres
            isTest: true
        secrets:
            - key: DATABASE_URL
              type: connection_string
              required: true
```


## What's Next?

- [Secrets](/guide/environments/secrets) - Managing sensitive values per stage
- [Configs](/guide/environments/configs) - Creating configs from stages
- [Organization](/guide/sql-files/organization) - Using build rules with settings.yml
