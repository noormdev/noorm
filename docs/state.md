# State Management


## The Problem

Database tools need to store sensitive information: connection credentials, API keys, encryption secrets. Storing these in plaintext config files is a security risk. Environment variables work but don't persist across sessions.

noorm encrypts all sensitive data in a single state file. This file travels with your project (gitignored) and unlocks with your private key.


## The State File

All persistent data lives in `.noorm/state.enc`:

```
your-project/
└── .noorm/
    └── state.enc    # Encrypted JSON, gitignored
```

The file contains:

| Field | Purpose |
|-------|---------|
| `version` | Schema version for migrations |
| `identity` | Your cryptographic identity (if set up) |
| `knownUsers` | Discovered team members' public keys |
| `activeConfig` | Currently selected config name |
| `configs` | Database configurations (credentials included) |
| `secrets` | Per-config secrets for SQL templates |
| `globalSecrets` | App-level secrets shared across configs |


## Loading State

State must be loaded before use. This decrypts the file and applies any schema migrations.

```typescript
import { StateManager } from './core/state'

const state = new StateManager(process.cwd())
await state.load()

// Now you can access configs, secrets, etc.
const config = state.getActiveConfig()
```

Calling methods before `load()` throws an error. This prevents accidentally working with uninitialized state.

```typescript
const state = new StateManager(process.cwd())
state.getConfig('dev')  // throws: "StateManager not loaded"
```


## Config Operations

Configs define how to connect to databases. Each config has a unique name.

```typescript
// Create or update a config
await state.setConfig('dev', {
    name: 'dev',
    type: 'local',
    isTest: false,
    protected: false,
    connection: {
        dialect: 'postgres',
        host: 'localhost',
        port: 5432,
        database: 'myapp_dev',
        user: 'postgres',
        password: 'postgres',
    },
    paths: {
        schema: './schema',
        changesets: './changesets',
    },
})

// Retrieve a config
const dev = state.getConfig('dev')

// List all configs with summary info
const configs = state.listConfigs()
// [{ name: 'dev', type: 'local', isTest: false, protected: false, isActive: true }]

// Delete a config (also removes its secrets)
await state.deleteConfig('dev')
```


## Active Config

One config is "active" at a time. Commands use this config by default.

```typescript
await state.setActiveConfig('dev')

const name = state.getActiveConfigName()  // 'dev'
const config = state.getActiveConfig()    // full config object
```

Setting a non-existent config as active throws an error:

```typescript
await state.setActiveConfig('nonexistent')
// throws: Config "nonexistent" does not exist
```

Deleting the active config clears the active selection:

```typescript
await state.setActiveConfig('dev')
await state.deleteConfig('dev')
state.getActiveConfigName()  // null
```


## Secrets

Secrets store sensitive values used in SQL templates. They come in two flavors.


### Config-Scoped Secrets

Tied to a specific config. Use these for database-specific credentials.

```typescript
// Set a secret
await state.setSecret('prod', 'DB_PASSWORD', 'super-secret')

// Get a secret
const password = state.getSecret('prod', 'DB_PASSWORD')

// List secret keys (not values)
const keys = state.listSecrets('prod')  // ['DB_PASSWORD']

// Get all secrets for a config
const all = state.getAllSecrets('prod')  // { DB_PASSWORD: 'super-secret' }

// Delete a secret
await state.deleteSecret('prod', 'DB_PASSWORD')
```

Secrets require the config to exist:

```typescript
await state.setSecret('nonexistent', 'KEY', 'value')
// throws: Config "nonexistent" does not exist
```

Deleting a config removes its secrets:

```typescript
await state.setSecret('dev', 'API_KEY', 'secret')
await state.deleteConfig('dev')
await state.setConfig('dev', { ... })  // recreate
state.getSecret('dev', 'API_KEY')  // null (was deleted)
```


### Global Secrets

Shared across all configs. Use these for app-level credentials like API keys.

```typescript
await state.setGlobalSecret('ANTHROPIC_API_KEY', 'sk-ant-...')

const key = state.getGlobalSecret('ANTHROPIC_API_KEY')

const allGlobal = state.getAllGlobalSecrets()

await state.deleteGlobalSecret('ANTHROPIC_API_KEY')
```


### Using Secrets in SQL Templates

Secrets are available in Eta templates via the `$` context:

```sql
-- schema/users/create-readonly.sql.eta
CREATE USER <%~ $.secrets.READONLY_USER %>
WITH PASSWORD '<%~ $.secrets.READONLY_PASSWORD %>';

GRANT SELECT ON ALL TABLES TO <%~ $.secrets.READONLY_USER %>;
```

Global secrets use `$.globalSecrets`:

```sql
-- Reference app-level secrets
-- <%~ $.globalSecrets.SHARED_API_KEY %>
```


## Identity Storage

The state file stores your cryptographic identity for audit and sharing purposes.

```typescript
// Check if identity exists
if (!state.hasIdentity()) {
    const identity = await createCryptoIdentity()
    await state.setIdentity(identity)
}

// Get current identity
const identity = state.getIdentity()
// { identityHash, name, email, publicKey, machine, os, createdAt }
```


## Known Users

Team members discovered during database sync are cached locally.

```typescript
// Get all known users
const users = state.getKnownUsers()

// Find by identity hash
const user = state.getKnownUser('a3f2b1c9...')

// Find by email (returns array - one person may have multiple machines)
const aliceDevices = state.findKnownUsersByEmail('alice@example.com')

// Add discovered users
await state.addKnownUser({
    identityHash: 'b4e3c2d8...',
    name: 'Bob',
    email: 'bob@example.com',
    publicKey: 'MCowBQYDK2...',
    source: 'db-sync',
    discoveredAt: new Date().toISOString(),
})

// Batch add (more efficient for sync operations)
await state.addKnownUsers([user1, user2, user3])
```


## Encryption

State is encrypted with AES-256-GCM. The encryption key derives from your private key using HKDF.

- Key never exists in plaintext on disk
- Tied to your identity, not the machine
- Can be regenerated from private key

```typescript
const state = new StateManager(projectRoot, {
    privateKey: yourPrivateKey,
})
```

The private key is stored separately in `~/.noorm/identity.key` to solve the bootstrap problem: you need the key to decrypt state, but you can't store the key inside encrypted state.


## Migrations

When the state schema changes between noorm versions, migrations run automatically on load.

```typescript
await state.load()
// If version changed:
//   - Missing fields get sensible defaults
//   - state:migrated event emits
//   - File re-persists with new schema
```

Migrations are additive - they never delete data, only add missing fields:

```typescript
// If 'globalSecrets' field is missing, add it as {}
// If 'identity' field is missing, add it as null
// If 'knownUsers' field is missing, add it as {}
```


## Import/Export

Backup and restore state files while keeping encryption intact.

```typescript
// Export (returns encrypted JSON string)
const backup = state.exportEncrypted()
fs.writeFileSync('backup.enc', backup)

// Import (validates decryption before saving)
const backup = fs.readFileSync('backup.enc', 'utf8')
await state.importEncrypted(backup)
```

Import validates the file can be decrypted before overwriting. If decryption fails, the current state remains unchanged.


## Observer Events

State operations emit events for CLI feedback and debugging:

```typescript
observer.on('state:loaded', ({ configCount, activeConfig, version }) => {
    console.log(`Loaded ${configCount} configs, active: ${activeConfig}`)
})

observer.on('state:persisted', ({ configCount }) => {
    console.log(`Saved ${configCount} configs`)
})

observer.on('state:migrated', ({ from, to }) => {
    console.log(`Migrated state from ${from} to ${to}`)
})

observer.on('config:created', ({ name }) => { ... })
observer.on('config:deleted', ({ name }) => { ... })
observer.on('secret:set', ({ configName, key }) => { ... })
observer.on('global-secret:set', ({ key }) => { ... })
```


## Testing

For tests, use custom paths to avoid polluting the project directory:

```typescript
const state = new StateManager(tempDir, {
    stateDir: '.test-state',
    stateFile: 'test.enc',
})
```

Reset between tests to ensure clean state:

```typescript
import { resetStateManager } from './core/state'

beforeEach(() => {
    resetStateManager()
})
```
