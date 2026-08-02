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

Two env vars are in play and they are not the same thing. `NOORM_IDENTITY` is the
plain audit string at priority 3. The `NOORM_IDENTITY_*` trio
(see [Env-Var Identity Override](#env-var-identity-override-ci)) reconstructs a full
crypto identity that `getIdentityForConfig` reads through `getIdentityOverride()`,
which lands it at priority **2** — so when both are set, `NOORM_IDENTITY_*` wins.

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

1. Registers your identity to the identities table (`__noorm_identities__` on MySQL and SQLite, `noorm.identities` on PostgreSQL and SQL Server)
2. Fetches other team members' identities from the database
3. Caches discovered users locally as "known users"

This happens silently and non-blocking—connection failures don't prevent config activation.

```typescript
import { syncIdentityWithConfig } from './core/identity'

// Takes the config only — it loads the identity itself from ~/.noorm/.
// Returns known users instead of storing them directly.
const result = await syncIdentityWithConfig(config)

if (result.ok && result.knownUsers?.length) {
    // Store discovered users in state
    await stateManager.addKnownUsers(result.knownUsers)
}
```

The sync function:
- Loads the crypto identity from `~/.noorm/` (returns `{ ok: true, knownUsersCount: 0 }` if there is none)
- Derives the dialect from `config.connection.dialect` — callers do not pass it
- Connects to the database (a connection failure is non-blocking: it emits an error event and returns `ok: true` with no users)
- Runs `ensureSchemaVersion` so a database still on the legacy prefixed tables is migrated before identity queries hit `noorm.identities`
- Checks if noorm tracking tables exist (skips sync if not bootstrapped)
- Upserts your identity (updates `last_seen_at` if already registered)
- Fetches all identities from the table, but only when the count is non-zero
- Returns `IdentitySyncResult`: `{ ok, error?, registered?, knownUsersCount?, knownUsers? }`

Note the result flag is `ok`, not `success` — and `ok: true` does not mean the sync
reached the database. It means nothing went wrong that should block config
activation, which includes the "could not connect" and "no identity" paths.

**Observer events:**

| Event | Payload | Description |
|-------|---------|-------------|
| `identity:registered` | `{ identityHash, name, email }` | Your identity inserted into the database (not emitted on a `last_seen_at` update) |
| `identity:synced` | `{ configName, registered, knownUsersCount }` | Sync completed |


## Env-Var Identity Override (CI)

A CI runner has no `~/.noorm/`, so identity comes from environment variables
instead. `loadIdentityFromEnv()` reads three vars and reconstructs a full
`CryptoIdentity` without touching the filesystem:

| Variable | Description |
|----------|-------------|
| `NOORM_IDENTITY_PRIVATE_KEY` | X25519 private key, hex PKCS8 DER (96 hex chars) |
| `NOORM_IDENTITY_NAME` | Display name |
| `NOORM_IDENTITY_EMAIL` | Email address |

The public key is *derived* from the private key rather than supplied. The
identityHash is then computed with `machine: publicKey` and `os: 'env'` — the
hostname is deliberately excluded, otherwise every CI runner would appear as a
new user in the audit trail. Any missing var, a key that fails hex/length
validation, or a key that will not parse as X25519 returns `null` rather than
throwing.

Installation happens once at process startup — `entry()` in `src/cli/index.ts`
for the CLI, and `createContext()` in `src/sdk/index.ts` for SDK consumers:

```typescript
import { loadIdentityFromEnv } from './core/identity/env'
import { setKeyOverride, setIdentityOverride } from './core/identity/storage'

const envIdentity = loadIdentityFromEnv()

if (envIdentity) {
    setKeyOverride(envIdentity.privateKey)
    setIdentityOverride(envIdentity.identity)
}
```

The overrides are process-wide module state. Once set, `loadPrivateKey()` and
`loadIdentityMetadata()` return the env values for the lifetime of the process
and never read `~/.noorm/`. `setKeyOverride` re-validates its argument — it is a
public export, so the env loader's own check is not sufficient; malformed key
material flows straight into `deriveStateKey` and would silently derive a
publicly computable encryption key.

`clearKeyOverride()` / `clearIdentityOverride()` undo it (used by tests).


## Additional Utilities

The identity module exports several utility functions:

```typescript
import {
    loadExistingIdentity,            // Load identity from global ~/.noorm/
    syncIdentityWithConfig,          // Sync identity with database on config activation
    registerIdentity,                // Upsert one identity row (used by withVaultContext)
    fetchKnownUsers,                 // Read all identity rows as KnownUser[]
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
    loadIdentityFromEnv,             // Reconstruct a CryptoIdentity from NOORM_IDENTITY_*
    setKeyOverride,                  // Install the process-wide private key override
    setIdentityOverride,             // Install the process-wide metadata override
} from './core/identity'
```

`detectIdentityDefaults` and `regenerateKeyPair` are worth a note: the first is
synchronous despite reading git config (it shells out with `execSync`), and the
second takes the existing `CryptoIdentity` and returns a new one with the same
identityHash — the hash derives from user details, not from the keys.

Anything that replaces the keypair makes every existing `state.enc` on the
machine undecryptable, and nothing re-encrypts state under a new key. That is why
`backupKeyPair()` throws rather than continuing if the private key exists but
cannot be copied aside. It is the one storage helper the module index does not
re-export — import it from `./core/identity/storage` directly, as
`src/cli/identity/init.ts` does.


## CLI Workflow

Headless identity management lives under `noorm identity`, a citty parent with
four leaves — `init`, `edit`, `export`, `list`. It has no `run` handler, so bare
`noorm identity` renders help rather than opening a screen.

The TUI provides equivalent screens, reached via `noorm ui`:

**Identity Screen** (`[i]` from the TUI home screen)

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
