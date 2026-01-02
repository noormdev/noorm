# Secrets


## The Problem

SQL templates often need sensitive values: database passwords, API keys, service credentials. Hardcoding these is a security risk. Environment variables work but require manual setup on each machine.

noorm provides encrypted secret storage tied to your configs. Secrets travel with your project (encrypted), unlock with your identity, and inject into templates at runtime. Stage definitions can require certain secrets, ensuring configs are complete before use.


## Two Types of Secrets

Secrets come in two scopes:

| Scope | Storage | Use Case |
|-------|---------|----------|
| Config-scoped | Per-config | Database passwords, per-environment credentials |
| Global | Shared across configs | API keys, shared service credentials |

Config-scoped secrets are deleted when their config is deleted. Global secrets persist independently.


## Required vs Optional

Secrets can be required in two ways: **universally** (for all configs) or **per-stage** (for configs matching that stage).


### Universal Secrets

Defined at the root level of `settings.yml`, these are required by every config regardless of stage:

```yaml
# .noorm/settings.yml
secrets:
    - key: ENCRYPTION_KEY
      type: password
      description: App-wide encryption key
```

Use universal secrets for credentials needed across all environments—shared API keys, license keys, or application-level secrets.


### Stage Secrets

Defined within a stage, these are only required for configs matching that stage:

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
            - key: READONLY_PASSWORD
              type: password
              description: Read-only user password
```

A config named `prod` will require both universal secrets and prod-stage secrets. A config named `dev` requires only universal secrets (plus any dev-stage secrets).


### Optional Secrets

User-defined secrets not listed in settings. Add them freely for template interpolation—they're not validated or required, just stored and available.

The CLI merges universal and stage-specific requirements when displaying missing secrets and blocking operations.


## Secret Types

The `type` field controls CLI input behavior:

| Type | Input Behavior | Validation |
|------|----------------|------------|
| `string` | Plain text | None |
| `password` | Masked input, no echo | None |
| `api_key` | Masked input | None |
| `connection_string` | Plain text | Valid URI format |

Types are hints for the CLI—all secrets are stored identically (encrypted strings).


## CLI Workflow

### Viewing Secrets

```bash
noorm secret              # List secrets for active config
```

The list screen shows:
- Required secrets with status (✓ set / ✗ missing)
- Optional secrets you've added
- Type hints from stage definitions
- Masked value previews for set secrets

Masked previews show the secret length and first few characters (in verbose mode only), using the same format as log redaction. For example, `sk-1234567890` becomes `sk-1********... (12)`. This helps verify which value is stored without exposing it.


### Setting Secrets

```bash
noorm secret:set                    # Interactive prompt
noorm secret:set DB_PASSWORD        # Set specific secret
```

The set screen:
1. Shows missing required secrets as suggestions
2. Accepts any key name (UPPER_SNAKE_CASE recommended)
3. Uses masked input for password/api_key types
4. Validates connection_string as URI
5. Warns before overwriting existing values


### Deleting Secrets

```bash
noorm secret:rm MY_API_KEY          # Delete specific secret
```

Required secrets cannot be deleted—only updated. When you try to delete a required secret, the CLI shows a warning toast indicating whether it's a **universal** or **stage-specific** secret:

- `"DB_PASSWORD" is a universal secret and cannot be deleted`
- `"API_KEY" is a stage secret and cannot be deleted`

This distinction helps you understand where the secret is defined:
- **Universal secrets** — Defined in the global `secrets` section of `settings.yml`, required by all stages
- **Stage secrets** — Defined within a specific stage's `secrets` array

To manage secret definitions, use the settings screens (see below).


### Keyboard Shortcuts (TUI)

| Key | Action |
|-----|--------|
| `a` | Add new secret |
| `e` | Edit selected secret |
| `d` | Delete selected secret |
| `Enter` | Edit selected secret |
| `Esc` | Go back |


### Managing Secret Definitions

Secret definitions (what secrets are required) are managed through settings screens:

```bash
noorm settings secrets              # List universal secret definitions
noorm settings secrets add          # Add new universal secret definition
noorm settings secrets edit API_KEY # Edit a secret definition

noorm settings stages prod secrets        # List stage-specific secrets
noorm settings stages prod secrets add    # Add stage secret definition
```

These commands manage which secrets are **required**, not their values. To set actual secret values, use `noorm secret:set`.


## Headless Mode

For CI/CD pipelines:

```bash
# Set secret non-interactively
noorm -H secret:set DB_PASSWORD "mypassword"

# List secrets (JSON output)
noorm --json secret

# Delete with confirmation skip
noorm -H -y secret:rm MY_API_KEY
```

In headless mode, secret values come from arguments or stdin (for piping).


## Using Secrets in Templates

Secrets inject into SQL templates via the `$` context:

```sql
-- sql/users/create-readonly.sql.eta
CREATE USER <%= $.secrets.READONLY_USER %>
WITH PASSWORD '<%= $.secrets.READONLY_PASSWORD %>';

GRANT SELECT ON ALL TABLES TO <%= $.secrets.READONLY_USER %>;
```

Global secrets use `$.globalSecrets`:

```sql
-- Reference app-level secrets
-- API key: <%= $.globalSecrets.SHARED_API_KEY %>
```

Missing secrets cause template errors at runtime—another reason to set required secrets upfront.


## Stage Matching

The CLI matches config names to stage names to determine required secrets. A config named `prod` uses secrets defined in the `prod` stage.

```yaml
# settings.yml
stages:
    prod:                           # Stage name
        secrets:
            - key: DB_PASSWORD
              type: password

    staging:
        secrets:
            - key: DB_PASSWORD
              type: password
            - key: DEBUG_KEY
              type: string
```

```bash
noorm config:use prod               # Activates 'prod' config
noorm secret                        # Shows DB_PASSWORD as required

noorm config:use staging            # Activates 'staging' config
noorm secret                        # Shows DB_PASSWORD, DEBUG_KEY as required
```


## Security Model

1. **Encryption at rest** — Secrets are stored in `.noorm/state.enc`, encrypted with AES-256-GCM
2. **Key derivation** — Encryption key derives from your private key via HKDF
3. **Values never displayed** — CLI shows keys only, never values
4. **Masked input** — Password types use non-echoing input
5. **No logging** — Secret values are never emitted to observer events
6. **Redaction** — Logger automatically masks secret fields if they appear in event data


## Observer Events

Secret operations emit events for logging and debugging:

```typescript
// Config-scoped secrets
observer.on('secret:set', ({ configName, key }) => {
    console.log(`Secret ${key} set for ${configName}`)
})

observer.on('secret:deleted', ({ configName, key }) => {
    console.log(`Secret ${key} deleted from ${configName}`)
})

// Global secrets
observer.on('global-secret:set', ({ key }) => {
    console.log(`Global secret ${key} set`)
})

observer.on('global-secret:deleted', ({ key }) => {
    console.log(`Global secret ${key} deleted`)
})
```

The logger listens for these events to add secret keys to its redaction list before they can be logged.


## StateManager API

For programmatic access:

```typescript
import { StateManager } from './core/state'

const state = new StateManager(process.cwd())
await state.load()

// Config-scoped secrets
await state.setSecret('prod', 'DB_PASSWORD', 'super-secret')
const password = state.getSecret('prod', 'DB_PASSWORD')
const keys = state.listSecrets('prod')           // ['DB_PASSWORD']
const all = state.getAllSecrets('prod')          // { DB_PASSWORD: '...' }
await state.deleteSecret('prod', 'DB_PASSWORD')

// Global secrets (shared values across all configs)
await state.setGlobalSecret('API_KEY', 'sk-...')
const key = state.getGlobalSecret('API_KEY')
const globalKeys = state.listGlobalSecrets()     // ['API_KEY']
await state.deleteGlobalSecret('API_KEY')
```

> **Note:** Global secret values (stored in state) are API-only. The CLI manages config-scoped secret values via `noorm secret`, and universal secret definitions via `noorm settings secrets`.

See [State Management](./state.md) for complete StateManager documentation.


## Completeness Check

Before running operations, verify a config has all required secrets:

```typescript
import { checkConfigCompleteness } from './core/config'

const check = checkConfigCompleteness(config, state, settings)

if (!check.complete) {
    console.log('Missing secrets:', check.missingSecrets)
    // ['DB_PASSWORD', 'READONLY_PASSWORD']
}
```

The CLI runs this check and prompts users to set missing secrets before proceeding with operations.
