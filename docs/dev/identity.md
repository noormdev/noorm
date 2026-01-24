# Identity


## The Problem

When multiple developers run changes against the same database, you need to know *who* did *what*. But identity isn't just about audit trails. In a team environment, you also need to share sensitive configs securely between machines.

noorm solves both problems with a dual identity system: a simple audit identity for tracking, and a cryptographic identity for secure sharing.


## Audit Identity

Every database operation records who performed it. This identity comes from multiple sources, checked in order:

| Priority | Source | When Used |
|----------|--------|-----------|
| 1 | Config override | `identity` field in config (for bots/services) |
| 2 | Crypto identity | If set up in state (normal user) |
| 3 | Environment | `NOORM_IDENTITY` env var (CI pipelines) |
| 4 | Git config | `git config user.name` / `user.email` |
| 5 | System | OS username |

The resolver tries each source until it finds a valid name. This means zero configuration for most users—git config "just works."

```typescript
import { resolveIdentity } from './core/identity'

// Note: resolveIdentity is synchronous
const identity = resolveIdentity()
// { name: 'Alice', email: 'alice@example.com', source: 'git' }
```

Override it when you need a different identity for specific configs:

```typescript
const config = {
    name: 'ci-runner',
    identity: 'github-actions',
    // ...
}
```


## Cryptographic Identity

Audit identity tells you *who*. Cryptographic identity proves it and enables secure sharing.

When you first run noorm, it generates an X25519 keypair stored globally at `~/.noorm/`:

```
~/.noorm/
├── identity.key     # Private key (mode 600, never shared)
├── identity.pub     # Public key (mode 644, shareable)
└── identity.json    # Metadata (name, email, machine, os)
```

**Important:** Identity is always global, never per-project. A developer's identity is the same across all noorm projects on their machine. The encrypted state file (`.noorm/state/state.enc`) stores configs and secrets, but identity lives at the user level.

Your identity is uniquely identified by a hash combining your email, name, machine, and OS. Two machines belonging to the same person have different identity hashes - this is intentional. It lets you track which *device* performed an operation, not just which person.

```typescript
import { createCryptoIdentity } from './core/identity'

// Returns { identity, keypair }
const { identity, keypair } = await createCryptoIdentity({
    name: 'Alice',
    email: 'alice@example.com',
})

// identity.identityHash: "a3f2b1c9..."
// identity.publicKey: "MCowBQYDK2..."
// identity.machine: "alice-macbook"
// keypair.privateKey: "..." (hex-encoded)
// keypair.publicKey: "..." (hex-encoded)
```


## Secure Config Sharing

The real power of cryptographic identity emerges when sharing database credentials.

Imagine Alice needs to give Bob access to the production database. She can't just email the password. Instead, she encrypts the config *for Bob's public key* - only Bob's private key can decrypt it.

```typescript
import { encryptForRecipient, decryptWithPrivateKey } from './core/identity'

// Alice encrypts for Bob (requires sender and recipient emails for the payload metadata)
const payload = encryptForRecipient(
    JSON.stringify(config),
    bobPublicKey,
    aliceEmail,  // sender email (e.g., 'alice@example.com')
    bobEmail,    // recipient email (e.g., 'bob@example.com')
)

// Bob decrypts with his private key
// Payload is a SharedConfigPayload with encrypted data and metadata
const decrypted = decryptWithPrivateKey(payload, bobPrivateKey)
const config = JSON.parse(decrypted)
```

This works because X25519 enables asymmetric encryption: anyone can encrypt using a public key, but only the private key holder can decrypt.


## Known Users

When you sync with a database, noorm discovers other users who have run changes. Their public keys are cached locally as "known users."

```typescript
const knownUsers = state.getKnownUsers()
// {
//     'a3f2b1c9...': { name: 'Alice', email: 'alice@example.com', publicKey: '...' },
//     'b4e3c2d8...': { name: 'Bob', email: 'bob@example.com', publicKey: '...' },
// }
```

Find users by email when you need to share with them:

```typescript
const aliceDevices = state.findKnownUsersByEmail('alice@example.com')
// Returns all of Alice's machines (laptop, desktop, etc.)
```


## Identity Hash

The identity hash uniquely identifies a person-machine combination. It's computed as:

```
SHA-256(email + '\0' + name + '\0' + machine + '\0' + os)
```

The null byte separators prevent collision attacks where someone crafts inputs that concatenate to the same string.

```typescript
import { computeIdentityHash, isValidIdentityHash } from './core/identity'

const hash = computeIdentityHash({
    email: 'alice@example.com',
    name: 'Alice',
    machine: 'macbook-pro',
    os: 'darwin',
})

// Validate format (64 hex characters)
isValidIdentityHash(hash)  // true
```


## State Encryption

Your local state file (`.noorm/state/state.enc`) contains sensitive data: database credentials, secrets, your identity. It's encrypted using AES-256-GCM.

Encryption uses your private key with HKDF to derive the AES-256-GCM key. This approach means:

- The encryption key never touches disk in plaintext
- It's derived from your private key on-demand
- Same private key always produces the same encryption key

```typescript
const state = new StateManager(projectRoot, {
    privateKey: loadedPrivateKey,
})
```


## First-Time Setup

On first run, noorm:

1. Detects your name/email from git config (or prompts)
2. Generates an X25519 keypair
3. Saves keys and metadata to `~/.noorm/`
4. Creates your cryptographic identity

No per-project storage is needed. The `createCryptoIdentity` function handles everything:

```typescript
import { createCryptoIdentity } from './core/identity'

// Generate identity with auto-detected defaults
// Keys and metadata are automatically saved to ~/.noorm/
const { identity, keypair } = await createCryptoIdentity({
    name: 'Alice',
    email: 'alice@example.com',
})
// identity.identityHash, identity.publicKey, etc. are now available
// Keys are persisted at ~/.noorm/identity.key and ~/.noorm/identity.pub
```

To load an existing identity (e.g., in CLI app context):

```typescript
import { loadExistingIdentity } from './core/identity'

const identity = await loadExistingIdentity()
// Returns CryptoIdentity if keys exist, null otherwise
```


## Observer Events

Identity operations emit events for CLI feedback:

```typescript
observer.on('identity:created', ({ identityHash, name, email, machine }) => {
    console.log(`Created identity for ${name} <${email}>`)
})

observer.on('identity:resolved', ({ name, source }) => {
    console.log(`Using identity "${name}" from ${source}`)
})
```


## Recovering Identity Metadata

When key files exist but metadata is missing or needs updating, use `createIdentityForExistingKeys` to reconstruct the identity:

```typescript
import { createIdentityForExistingKeys, hasKeyFiles } from './core/identity'

// Check if keys exist
if (await hasKeyFiles()) {

    // Create identity metadata using existing keys
    const identity = await createIdentityForExistingKeys({
        name: 'Alice Smith',
        email: 'alice@example.com',
    })

    // identity is ready to use - metadata is saved to ~/.noorm/identity.json

}
```

This loads your existing public key from `~/.noorm/identity.pub` and creates the identity metadata (hash, machine info, etc.) without regenerating keys. Use this when:

- Migrating to a new machine where keys were copied
- Updating name or email without regenerating keys
- Recovering from corrupted metadata file


## Identity Sync on Config Activation

When you activate a database config (`noorm config use <name>`), noorm automatically syncs identities:

1. Registers your identity to the database's `__noorm_identities__` table
2. Fetches other team members' identities from the database
3. Caches discovered users locally as "known users"

This happens silently and non-blocking—connection failures don't prevent config activation.

```typescript
import { syncIdentityWithConfig } from './core/identity'

// Sync returns known users instead of storing them directly
const result = await syncIdentityWithConfig(config, cryptoIdentity)

if (result.success) {
    // Store discovered users in state
    await stateManager.addKnownUsers(result.knownUsers)
}
```

The sync function:
- Connects to the database
- Checks if noorm tracking tables exist (skips sync if not bootstrapped)
- Upserts your identity (updates `last_seen_at` if already registered)
- Fetches all identities from the table
- Returns the list of known users

**Observer events:**

| Event | Payload | Description |
|-------|---------|-------------|
| `identity:registered` | `{ identityHash, configName }` | Your identity added to database |
| `identity:synced` | `{ configName, usersDiscovered }` | Sync completed |


## Additional Utilities

The identity module exports several utility functions:

```typescript
import {
    loadExistingIdentity,            // Load identity from global ~/.noorm/
    syncIdentityWithConfig,          // Sync identity with database on config activation
    clearIdentityCache,              // Clear cached audit identity
    getIdentityForConfig,            // Extract identity override from config
    getIdentityWithCrypto,           // Resolve with crypto identity awareness
    formatIdentity,                  // Format identity for display: "Name <email>"
    identityToString,                // Format for database storage
    detectIdentityDefaults,          // Detect defaults from system/git
    createIdentityForExistingKeys,   // Create identity from existing key files
    regenerateKeyPair,               // Regenerate when private key compromised
    deriveStateKey,                  // Derive encryption key from private key
    encryptState,                    // Encrypt state data
    decryptState,                    // Decrypt state data
    loadKeyPair,                     // Load keypair from disk
    hasKeyFiles,                     // Check if identity key files exist
    validateKeyPermissions,          // Validate private key file permissions
    isValidKeyHex,                   // Validate hex-encoded key format
    getPrivateKeyPath,               // Get path to private key file
    getPublicKeyPath,                // Get path to public key file
    getNoormHomePath,                // Get path to noorm home directory
    truncateHash,                    // Truncate identity hash for display
} from './core/identity'
```


## CLI Workflow

The TUI provides screens for managing identity:

**Identity Screen** (`noorm identity` or `[i]` from home)

Displays current identity details: name, email, machine, OS, truncated hash/public key, and creation date. Also shows count of known users discovered from database sync.

| Key | Action |
|-----|--------|
| `e` | Edit identity details |
| `x` | Export public key |
| `r` | Regenerate identity (new keypair) |
| `u` | View known users |
| `Esc` | Back |


**Edit Identity** (`[e]` from identity screen)

Update name, email, or machine without regenerating keys. Your keypair stays the same—only the metadata changes. Note: changing details will change your identity hash.

Use this when:
- You changed your email
- You want a different display name
- You renamed your machine


**Export Public Key** (`[x]` from identity screen)

Copies your public key to clipboard for sharing with team members. They can use this to encrypt configs that only you can decrypt.


**Regenerate Identity** (`[r]` from identity screen)

Creates a new X25519 keypair. Use this if your private key was compromised. Warning: you'll lose access to any configs encrypted for your old public key.


**Known Users** (`[u]` from identity screen)

Lists team members discovered from database sync. Shows their name, email, machine, and truncated identity hash. Use this to find recipients when sharing encrypted configs.
