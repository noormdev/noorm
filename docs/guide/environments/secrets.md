# Secrets


Sensitive values like database passwords and API keys have no place in config files. noorm provides encrypted secret storage that travels with your project, unlocks with your identity, and injects into templates at runtime.


## What Secrets Are

Secrets are encrypted key-value pairs stored in your local state file (`.noorm/state.enc`). They never touch disk in plain text.

Common uses:

- Database passwords
- API keys
- Service credentials
- Connection strings

Secrets integrate directly with SQL templates, so you can reference them without exposing values in your source code.


## Setting a Secret

Set secrets for the active config:

```bash
# Interactive prompt (masks input)
noorm secret:set

# Set a specific secret
noorm secret:set DB_PASSWORD
```

The CLI masks password input and validates connection strings as URIs. Once set, secrets appear in your secret list:

```bash
noorm secret              # List secrets for active config
```

The list shows which secrets are set, which are missing, and their types. Values stay hidden.


## Config-Scoped vs Global Secrets

Secrets come in two scopes:

| Scope | Use Case | Example |
|-------|----------|---------|
| Config-scoped | Per-environment credentials | Database password for `prod` |
| Global | Shared across all configs | Third-party API key |

**Config-scoped secrets** belong to a single config. When you delete the config, its secrets go with it.

**Global secrets** persist independently and are available everywhere.

In templates, access them differently:

```sql
-- Config-scoped secret
CREATE USER readonly WITH PASSWORD '{%~ $.secrets.DB_PASSWORD %}';

-- Global secret
-- Using API key: {%~ $.globalSecrets.SHARED_API_KEY %}
```

See [Templates](/guide/sql-files/templates) for full syntax reference.


## Using Secrets in Templates

Secrets inject into SQL templates via the `$` context object:

```sql
-- sql/users/create-readonly.sql.tmpl
CREATE USER {%~ $.secrets.READONLY_USER %}
WITH PASSWORD '{%~ $.secrets.READONLY_PASSWORD %}';

GRANT SELECT ON ALL TABLES TO {%~ $.secrets.READONLY_USER %};
```

If a template references a missing secret, it fails at runtime. Define your required secrets upfront to catch this early.


## Secret Requirements in Settings

You can require secrets at two levels: **universally** (all configs) or **per-stage** (specific environments).


### Universal Secrets

Define in the root `secrets` section of `settings.yml`:

```yaml
# .noorm/settings.yml
secrets:
    - key: ENCRYPTION_KEY
      type: password
      description: App-wide encryption key
```

Every config requires these secrets, regardless of stage.


### Stage Secrets

Define within a stage to require secrets only for matching configs:

```yaml
# .noorm/settings.yml
stages:
    prod:
        description: Production database
        secrets:
            - key: DB_PASSWORD
              type: password
              description: Main database password
              required: true

    staging:
        secrets:
            - key: DB_PASSWORD
              type: password
            - key: DEBUG_KEY
              type: string
```

A config named `prod` requires its stage secrets plus universal secrets. A config named `dev` requires only universal secrets (plus any dev-stage secrets).


### Secret Types

The `type` field controls input behavior:

| Type | Input Behavior |
|------|----------------|
| `string` | Plain text |
| `password` | Masked, no echo |
| `api_key` | Masked, no echo |
| `connection_string` | Plain text, URI validation |

Types are hints for the CLI. All secrets are stored identically (encrypted strings).


## Secrets in CI/CD

For non-interactive environments, pass secret values as arguments:

```bash
# Set secret in headless mode
noorm -H secret:set DB_PASSWORD "mypassword"

# List secrets with JSON output
noorm --json secret

# Delete without confirmation
noorm -H -y secret:rm MY_API_KEY
```

Alternatively, pipe values from your CI environment:

```bash
echo "$DB_PASSWORD" | noorm -H secret:set DB_PASSWORD
```

This keeps secrets out of command history while still automating setup.


## Security Notes

noorm takes several measures to protect your secrets:

1. **Encryption at rest** - Secrets are stored in `.noorm/state.enc` using AES-256-GCM encryption
2. **Key derivation** - The encryption key derives from your private identity key via HKDF
3. **Values never displayed** - The CLI shows secret keys only, never values
4. **Masked input** - Password-type secrets use non-echoing input
5. **No logging** - Secret values are never emitted to observer events
6. **Automatic redaction** - The logger masks secret fields if they appear in event data

::: warning Don't Commit state.enc
Add `.noorm/state.enc` to your `.gitignore`. The file is encrypted with machine-specific keys and won't work on other machines.
:::


## Deleting Secrets

Remove optional secrets when no longer needed:

```bash
noorm secret:rm MY_API_KEY
```

Required secrets (defined in settings) cannot be deleted, only updated. The CLI tells you whether a secret is universal or stage-specific when you try to delete a required one.


## What's Next?

- [Stages](/guide/environments/stages) - Environment templates with secret requirements
- [Templates](/guide/sql-files/templates) - Using secrets in dynamic SQL
- [Configs](/guide/environments/configs) - Config-scoped vs global secrets
