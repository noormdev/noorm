# Stages


## The Problem

Your team has three environments: development, staging, and production. Each has different requirements:

- **Production** should be protected from accidental teardowns
- **Staging** might require specific API keys for integration testing
- **Development** should default to localhost

Without a shared definition, every developer configures these differently. Someone creates an unprotected production config. Someone else forgets the staging API key. The inconsistency causes problems down the line.

Stages solve this. They're templates defined in your project's `settings.yml` that every team member shares.


## What Stages Are

A **stage** is a named template for database configs. When you create a config and assign it to a stage, the config inherits the stage's defaults and requirements.

Think of stages as blueprints:

- `dev` stage: localhost defaults, no protection needed
- `staging` stage: requires integration API keys
- `prod` stage: always protected, cannot be deleted

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
        secrets:
            - key: STRIPE_TEST_KEY
              type: api_key
              description: Stripe test API key for payment testing
              required: true

    prod:
        description: Production database
        locked: true
        defaults:
            dialect: postgres
            protected: true
```

When a developer creates a config from the `staging` stage, it automatically:
- Uses postgres dialect
- Is not protected (staging data is expendable)
- Requires a `STRIPE_TEST_KEY` secret before builds can run


## Stage Properties

Each stage can define these properties:

| Property | Type | Description |
|----------|------|-------------|
| `description` | string | Human-readable description shown in the TUI |
| `locked` | boolean | If true, configs cannot be deleted (default: false) |
| `defaults` | object | Values applied when creating a config from this stage |
| `secrets` | array | Secrets that must be configured |


### Defaults

Defaults provide initial values when creating a config. Most can be overridden by the developer in the TUI:

```yaml
stages:
    dev:
        defaults:
            dialect: postgres
            host: localhost
            port: 5432
            database: myapp_dev
```

Some defaults are **enforced** and cannot be overridden in the TUI:

| Default | Behavior |
|---------|----------|
| `protected: true` | Acts as an access ceiling: whatever `access` the config or the developer sets, the *resolved* access is clamped to at most `{ user: 'operator', mcp: 'viewer' }` |
| `isTest: true` | Cannot be set to false in the TUI |
| `dialect` | Cannot be changed after config creation |

This means if your `prod` stage sets `protected: true`, developers cannot create a fully-open production config through the normal workflow — even picking `admin` in the TUI's access editor gets clamped back down at resolution time.

::: tip Manual Override
The ceiling is enforced every time the config is resolved, so it survives even a manually edited state file — there's no stored value to hand-edit around. The protection is against accidents, not an attempt at real security.
:::


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

When you create a new config in the TUI, noorm asks which stage to use:

```
? Select stage for new config:
  dev        Local development database
  staging    Staging environment
  prod       Production database
```

The config inherits that stage's defaults. The stage selection happens during config creation through the TUI.


## Stage-Specific Secrets

Stages can require secrets that get inserted into your database via SQL templates. These are for sensitive values like API keys and encryption keys—not database connection credentials.

```yaml
stages:
    staging:
        secrets:
            - key: STRIPE_TEST_KEY
              type: api_key
              description: Stripe test API key for payment testing
              required: true

            - key: SENDGRID_KEY
              type: api_key
              description: SendGrid API key for email testing
              required: false
```

Secret types control how the TUI handles input:

| Type | Behavior |
|------|----------|
| `string` | Plain text input |
| `password` | Masked input, no echo |
| `api_key` | Masked input, no echo |
| `connection_string` | Plain text, URI validation |

**Required secrets** must be set before builds can run. If a template references a missing required secret, the build fails with a clear error.

**Optional secrets** are prompted but can be skipped. Templates that reference them should handle the undefined case.


### Universal Secrets

Some secrets apply to all configs regardless of stage. Define these at the settings root level:

```yaml
# Required by ALL configs
secrets:
    - key: ENCRYPTION_KEY
      type: password
      description: Application encryption key for sensitive data

stages:
    prod:
        # Additional secrets for prod only
        secrets:
            - key: AWS_SECRET_KEY
              type: api_key
              description: AWS credentials for S3 uploads
```

A production config would need both `ENCRYPTION_KEY` (universal) and `AWS_SECRET_KEY` (stage-specific).


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
            - key: STRIPE_TEST_KEY
              type: api_key
              required: true

    prod:
        description: Production
        locked: true
        defaults:
            dialect: postgres
            protected: true
        secrets:
            - key: STRIPE_LIVE_KEY
              type: api_key
              required: true
```


### Test Database Stage

```yaml
stages:
    test:
        description: Ephemeral test database
        defaults:
            dialect: postgres
            host: localhost
            port: 5432
            isTest: true
```

The `isTest: true` flag marks this as a test database. noorm uses this for:

- Conditional build rules (include seed data only in test environments)
- SDK's `requireTest` option (refuses to connect if `isTest` is not true)
- Preventing accidental test operations against production


## What's Next?

- [Secrets](/guide/environments/secrets) - Managing sensitive values per stage
- [Configs](/guide/environments/configs) - Creating configs from stages
- [Organization](/guide/sql-files/organization) - Using build rules with settings.yml
