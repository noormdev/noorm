# Secrets


Sensitive values like database passwords and API keys have no place in config files. noorm provides encrypted secret storage that travels with your project, unlocks with your identity, and injects into templates at runtime.


## What Secrets Are

Secrets are encrypted key-value pairs stored in your local state file (`.noorm/state/state.enc`). They never touch disk in plain text.

Secrets are for sensitive values that get **inserted into your database** via SQL templates—not for database connection credentials. Common uses:

- API keys stored in configuration tables
- Encryption keys for sensitive data columns
- Service credentials (AWS, Stripe, SendGrid)
- OAuth client secrets

Secrets integrate directly with SQL templates, so you can reference them without exposing values in your source code or version control.


## Setting a Secret

You can manage local secrets through the TUI (masked input, nothing in shell history) or the CLI.

**TUI:** Launch `noorm ui`, press `s` for Settings → Secrets. The form masks password input, validates connection strings as URIs, and writes the encrypted result to `.noorm/state/state.enc`. The same screen lists secrets for the active config: which are set, which are missing, and their declared types. Values stay hidden.

**CLI:** The `noorm secret` namespace manages config-scoped local secrets headlessly:

```bash
# Set a secret
noorm secret set API_KEY "sk-live-abc123"
noorm secret set DB_PASSWORD "secret" --config prod

# List secret keys (values never shown)
noorm secret list
noorm secret list --config staging --json

# Remove a secret
noorm secret rm OLD_KEY --yes
```

::: tip Vault vs Local Secrets
**Local secrets** (`noorm secret`) are per-user, per-machine. They override vault values and stay on your disk.

**Vault secrets** (`noorm vault`) are team-shared and stored encrypted in the database. Anyone with vault access can read them.

In CI/CD pipelines, push secrets with the vault (`noorm vault set KEY "value"`) or batch-load via `noorm ci secrets --file`.
:::


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

The local secret store exists for per-developer overrides — it's deliberately TUI-only so that raw values never leak into shell history. For non-interactive environments, push values to the [vault](/guide/environments/vault) instead, which is scriptable end-to-end:

```bash
# Write a secret to the vault
noorm vault set DB_PASSWORD "$DB_PASSWORD"

# Pipe a secret to avoid process listings
echo "$DB_PASSWORD" | noorm vault set DB_PASSWORD

# List vault secrets as JSON
noorm vault list --json

# Remove a vault secret
noorm vault rm OLD_API_KEY
```

Vault secrets sit below local secrets in the [resolution hierarchy](/guide/environments/vault#secret-resolution-hierarchy), so a developer can still override a vault value locally through `noorm ui` without affecting anyone else.


## Security Notes

noorm takes several measures to protect your secrets:

1. **Encryption at rest** - Secrets are stored in `.noorm/state/state.enc` using AES-256-GCM encryption
2. **Key derivation** - The encryption key derives from your private identity key via HKDF
3. **Values never displayed** - The CLI shows secret keys only, never values
4. **Masked input** - Password-type secrets use non-echoing input
5. **No logging** - Secret values are never emitted to observer events
6. **Automatic redaction** - The logger masks secret fields if they appear in event data

::: warning Don't Commit state.enc
Add `.noorm/state/state.enc` to your `.gitignore`. The file is encrypted with machine-specific keys and won't work on other machines.
:::


## Deleting Secrets

Remove optional local secrets through the TUI: `noorm ui` → Settings → Secrets → highlight the entry and press `d`. For team-shared values stored in the vault, use `noorm vault rm <KEY>`.

Required secrets (those declared in `settings.yml`) cannot be deleted, only updated. The TUI tells you whether a secret is universal or stage-specific when you try to delete a required one.


## What's Next?

- [Stages](/guide/environments/stages) - Environment templates with secret requirements
- [Templates](/guide/sql-files/templates) - Using secrets in dynamic SQL
- [Configs](/guide/environments/configs) - Config-scoped vs global secrets
