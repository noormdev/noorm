# Vault


## The Problem

Local secrets solve the individual developer's needs—sensitive values encrypted on their machine. But teams need shared secrets: API keys everyone uses, service credentials that shouldn't live in code. Email threads and chat messages aren't secure. Separate secret management tools add friction.

The vault stores encrypted secrets in the database itself. Team members automatically receive access when an authorized user propagates the key. Secrets stay encrypted at rest, decrypted only in memory when needed.


## Architecture

The vault uses dual-layer encryption:

```
┌─────────────────────────────────────────────────────────────┐
│  Layer 1: Vault Key Distribution                            │
│                                                             │
│  vault_key (32 bytes) ──────┬──────────────────────────────│
│                             │                               │
│    ┌─────────────────────┐  │  ┌─────────────────────────┐ │
│    │ Alice's public key  │──┼──│ encrypted_vault_key[A]  │ │
│    └─────────────────────┘  │  └─────────────────────────┘ │
│    ┌─────────────────────┐  │  ┌─────────────────────────┐ │
│    │ Bob's public key    │──┼──│ encrypted_vault_key[B]  │ │
│    └─────────────────────┘  │  └─────────────────────────┘ │
│                             │                               │
└─────────────────────────────┼───────────────────────────────┘
                              │
┌─────────────────────────────┼───────────────────────────────┐
│  Layer 2: Secret Encryption │                               │
│                             ▼                               │
│    ┌─────────────────────────────────────────────────────┐ │
│    │ vault_key (decrypted in memory)                     │ │
│    └─────────────────────┬───────────────────────────────┘ │
│                          │                                  │
│    ┌──────────────────┐  │  ┌────────────────────────────┐ │
│    │ API_KEY value    │──┴──│ encrypted_value (in DB)    │ │
│    └──────────────────┘     └────────────────────────────┘ │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

**Layer 1** distributes the vault key to authorized users. Each user gets their own encrypted copy using their X25519 public key. No shared secret transmission—ECDH derives the encryption key.

**Layer 2** encrypts individual secrets with the shared vault key. All team members with vault access can decrypt any secret.


## Encryption Details

### Vault Key Encryption (Layer 1)

The ephemeral keypair pattern encrypts the vault key for each recipient:

```typescript
function encryptVaultKey(vaultKey: Buffer, recipientPubKey: string): EncryptedVaultKey {
    // 1. Generate ephemeral X25519 keypair
    const { publicKey, privateKey } = generateKeyPairSync('x25519', {
        publicKeyEncoding: { type: 'spki', format: 'der' },
        privateKeyEncoding: { type: 'pkcs8', format: 'der' },
    });

    // 2. ECDH: ephemeral private + recipient public → shared secret
    const sharedSecret = diffieHellman({ privateKey, publicKey: recipientPubKey });

    // 3. HKDF-SHA256: shared secret → encryption key
    const encKey = hkdfSync('sha256', sharedSecret, Buffer.alloc(0), 'noorm-vault-key', 32);

    // 4. AES-256-GCM encryption
    const iv = randomBytes(16);
    const cipher = createCipheriv('aes-256-gcm', encKey, iv);
    const ciphertext = Buffer.concat([cipher.update(vaultKey), cipher.final()]);
    const authTag = cipher.getAuthTag();

    return { ephemeralPubKey, iv, authTag, ciphertext };
}
```

The stored payload contains:
- `ephemeralPubKey` — Sender's ephemeral public key (for ECDH on decrypt)
- `iv` — 16-byte initialization vector
- `authTag` — 16-byte GCM authentication tag
- `ciphertext` — Encrypted vault key

Decryption reverses the process: ECDH with the ephemeral public key and user's private key, same HKDF derivation, then AES-GCM decrypt.


### Secret Encryption (Layer 2)

Individual secrets use straightforward AES-256-GCM:

```typescript
function encryptSecret(value: string, vaultKey: Buffer) {
    const iv = randomBytes(16);
    const cipher = createCipheriv('aes-256-gcm', vaultKey, iv);
    const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();

    return { iv, authTag, ciphertext };
}
```

Stored as JSON in the `encrypted_value` column. Each secret has its own random IV.


## Database Schema

Two database changes support the vault:

Table names below are the MySQL/SQLite prefixed form. PostgreSQL and SQL Server store these in a dedicated `noorm` schema instead (`noorm.vault`, `noorm.identities`), with no prefix.

### Vault Table (`__noorm_vault__`)

```sql
CREATE TABLE __noorm_vault__ (
    id              INT PRIMARY KEY,
    secret_key      VARCHAR(255) NOT NULL UNIQUE,
    encrypted_value TEXT NOT NULL,
    set_by          VARCHAR(255) NOT NULL,
    created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

The `encrypted_value` column stores JSON: `{ iv, authTag, ciphertext }`.

### Identities Table Extension (`__noorm_identities__`)

```sql
ALTER TABLE __noorm_identities__
ADD COLUMN encrypted_vault_key TEXT;
```

When this column is NULL, the user hasn't received vault access yet. After propagation, it contains their encrypted copy of the vault key.


## Secret Resolution

Templates reference secrets via `secrets.KEY_NAME`. The resolution order:

1. **Config-specific local secret** — User's override for this config
2. **Global local secret** — User's shared secret across configs
3. **Vault secret** — Team-shared from database

```typescript
async function resolveSecret(
    stateManager: StateManager,
    configName: string,
    secretKey: string,
    db?: Kysely<NoormDatabase>,
    vaultKey?: Buffer,
): Promise<string | null> {

    // 1. Config-specific local
    const configSecret = stateManager.getSecret(configName, secretKey);
    if (configSecret) return configSecret;

    // 2. Global local
    const globalSecret = stateManager.getGlobalSecret(secretKey);
    if (globalSecret) return globalSecret;

    // 3. Vault
    if (db && vaultKey) {
        return getVaultSecret(db, vaultKey, secretKey);
    }

    return null;
}
```

For template rendering, `buildSecretsContext()` merges all three layers with proper priority:

```typescript
async function buildSecretsContext(
    stateManager: StateManager,
    configName: string,
    db?: Kysely<NoormDatabase>,
    vaultKey?: Buffer,
): Promise<Record<string, string>> {

    const secrets: Record<string, string> = {};

    // 1. Start with vault (lowest priority)
    if (db && vaultKey) {
        const vaultSecrets = await getAllVaultSecrets(db, vaultKey);
        for (const [key, secret] of Object.entries(vaultSecrets)) {
            secrets[key] = secret.value;
        }
    }

    // 2. Override with global local
    for (const key of stateManager.listGlobalSecrets()) {
        const value = stateManager.getGlobalSecret(key);
        if (value) secrets[key] = value;
    }

    // 3. Override with config-specific (highest priority)
    for (const key of stateManager.listSecrets(configName)) {
        const value = stateManager.getSecret(configName, key);
        if (value) secrets[key] = value;
    }

    return secrets;
}
```


## Core Operations

### Initialization

The first user to initialize creates the vault key. `initializeVault` is **idempotent**: calling it a second time against an already-initialized vault returns `[null, null]` without touching state or emitting an event. Callers can `init()` defensively at startup without special-casing an error.

The three possible return shapes:

| Shape | Meaning |
|-------|---------|
| `[Buffer, null]` | First-time init succeeded; this buffer is the vault key. Use it to seed initial secrets, propagate to teammates, etc. |
| `[null, null]` | Vault already initialized. No work done. Use `vault.get` / `vault.set` with the user's private key for ongoing operations. |
| `[null, Error]` | Actual failure (DB error, encryption error). The error is the underlying cause. |

```typescript
async function initializeVault(
    db: Kysely<NoormDatabase>,
    identityHash: string,
    publicKey: string,
): Promise<[Buffer | null, Error | null]> {

    // Check if already initialized
    const existing = await db
        .selectFrom('__noorm_identities__')
        .select('encrypted_vault_key')
        .where('encrypted_vault_key', 'is not', null)
        .limit(1)
        .executeTakeFirst();

    if (existing?.encrypted_vault_key) {
        // Idempotent — no state change, no event emission.
        return [null, null];
    }

    // Generate new vault key
    const vaultKey = randomBytes(32);

    // Encrypt for initializer
    const encrypted = encryptVaultKey(vaultKey, publicKey);

    // Store
    await db
        .updateTable('__noorm_identities__')
        .set({ encrypted_vault_key: JSON.stringify(encrypted) })
        .where('identity_hash', '=', identityHash)
        .execute();

    observer.emit('vault:initialized', { identityHash });

    return [vaultKey, null];
}
```

The `vault:initialized` observer event fires only on first init — repeat calls return early before the emit.

Typical call-site pattern at the SDK boundary:

```typescript
const vaultKey = await ctx.noorm.vault.init();

if (vaultKey) {
    // First-time init — seed initial team secrets.
    await ctx.noorm.vault.set('API_KEY', process.env.SEED_KEY!, privateKey);
}
else {
    // Already initialized — use the vault normally.
    const apiKey = await ctx.noorm.vault.get('API_KEY', privateKey);
}
```


### Propagation

Users with vault access can propagate to pending users:

```typescript
async function propagateVaultKey(
    db: Kysely<NoormDatabase>,
    vaultKey: Buffer,
): Promise<VaultPropagationResult> {

    // Find users without access
    const users = await db
        .selectFrom('__noorm_identities__')
        .select(['identity_hash', 'public_key', 'email'])
        .where('encrypted_vault_key', 'is', null)
        .execute();

    const propagatedTo: string[] = [];

    for (const user of users) {
        // Encrypt vault key for this user's public key
        const encrypted = encryptVaultKey(vaultKey, user.public_key);

        await db
            .updateTable('__noorm_identities__')
            .set({ encrypted_vault_key: JSON.stringify(encrypted) })
            .where('identity_hash', '=', user.identity_hash)
            .execute();

        propagatedTo.push(user.identity_hash);
        observer.emit('vault:propagated', {
            toIdentityHash: user.identity_hash,
            toEmail: user.email,
        });
    }

    return { propagatedTo, alreadyHadAccess: totalWithAccess - propagatedTo.length };
}
```


### Cross-Config Copy

Copy secrets between database configs:

```typescript
async function copyVaultSecrets(
    sourceConfig: Config,
    destConfig: Config,
    keys: string[] | 'all',
    identityHash: string,
    privateKey: string,
    publicKey: string,
    options: { force?: boolean },
): Promise<[VaultCopyResult | null, Error | null]> {

    return withDualConnection({ sourceConfig, destConfig }, async (ctx) => {

        // Get source vault key
        const sourceVaultKey = await getVaultKey(ctx.source.db, identityHash, privateKey);
        if (!sourceVaultKey) throw new Error('No vault access on source');

        // Initialize or access destination vault
        const destStatus = await getVaultStatus(ctx.destination.db, identityHash);
        let destVaultKey: Buffer;

        if (!destStatus.isInitialized) {
            const [newKey] = await initializeVault(ctx.destination.db, identityHash, publicKey);
            destVaultKey = newKey!;
        } else {
            destVaultKey = await getVaultKey(ctx.destination.db, identityHash, privateKey);
        }

        // Copy secrets
        const allSourceSecrets = await getAllVaultSecrets(ctx.source.db, sourceVaultKey);
        const result: VaultCopyResult = { copied: [], skipped: [], errors: [] };

        for (const [key, secret] of Object.entries(allSourceSecrets)) {
            if (keys !== 'all' && !keys.includes(key)) continue;

            const exists = await vaultSecretExists(ctx.destination.db, key);
            if (exists && !options.force) {
                result.skipped.push(key);
                continue;
            }

            await setVaultSecret(ctx.destination.db, destVaultKey, key, secret.value, `copied from ${sourceConfig.name}`);
            result.copied.push(key);
        }

        return result;
    });
}
```


## CLI Commands

### `vault init`

Initialize the vault for the active config's database:

```bash
noorm vault init
```

Creates a new vault key and stores it encrypted for your identity. Fails if vault already initialized.


### `vault set`

Store a secret in the vault:

```bash
noorm vault set API_KEY "sk-live-..."
noorm vault set DB_PASSWORD "secret123"
```

Upserts—creates new or updates existing. Records `set_by` for audit trail.


### `vault list`

List all vault secrets:

```bash
noorm vault list
```

Shows keys, who set them, and timestamps. Values stay hidden.


### `vault rm`

Delete a vault secret:

```bash
noorm vault rm OLD_API_KEY
```


### `vault propagate`

Grant vault access to pending team members:

```bash
noorm vault propagate
```

Encrypts the vault key for each user's public key.


### `vault cp`

Copy secrets between configs:

```bash
noorm vault cp API_KEY staging production    # Copy one secret
noorm vault cp staging production            # Copy all secrets
noorm vault cp --force staging production    # Overwrite existing
noorm vault cp --dry-run staging production  # Preview only
```


## Observer Events

Vault operations emit events for monitoring:

```typescript
// Vault lifecycle
observer.on('vault:initialized', ({ identityHash }) => { ... });
observer.on('vault:propagated', ({ toIdentityHash, toEmail }) => { ... });

// Secret operations
observer.on('vault:secret:created', ({ key, setBy }) => { ... });
observer.on('vault:secret:updated', ({ key, setBy }) => { ... });
observer.on('vault:secret:deleted', ({ key }) => { ... });

// Copy operations
observer.on('vault:copy:starting', ({ source, destination, keys }) => { ... });
observer.on('vault:copy:completed', ({ source, destination, copied, skipped, errors }) => { ... });
```


## Types

```typescript
interface EncryptedVaultKey {
    ephemeralPubKey: string;  // X25519 public key (hex)
    iv: string;               // Initialization vector (hex)
    authTag: string;          // GCM authentication tag (hex)
    ciphertext: string;       // Encrypted vault key (hex)
}

interface EncryptedSecret {
    iv: string;
    authTag: string;
    ciphertext: string;
}

interface VaultSecret {
    key: string;
    value: string;
    setBy: string;
    createdAt: Date;
    updatedAt: Date;
}

interface VaultStatus {
    isInitialized: boolean;
    hasAccess: boolean;
    secretCount: number;
    usersWithAccess: number;
    usersWithoutAccess: number;
}

interface VaultCopyResult {
    copied: string[];
    skipped: string[];
    errors: Array<{ key: string; error: string }>;
}

interface VaultPropagationResult {
    propagatedTo: string[];
    alreadyHadAccess: number;
}
```


## Security Properties

1. **End-to-end encryption** — Secrets encrypted before transmission, decrypted only in memory
2. **Zero-knowledge database** — Database sees only ciphertext; no plaintext ever stored
3. **Forward secrecy per user** — Each user's vault key copy uses unique ephemeral keys
4. **Authenticated encryption** — AES-GCM detects tampering
5. **No shared secrets in transit** — ECDH derives keys without transmitting them


## Limitations

- **All-or-nothing access** — Users with vault access can read all secrets
- **No key rotation** — Removing a user requires generating a new vault key (not yet implemented)
- **Lost keys** — If a user loses their private key, they must re-register identity
- **Single vault per database** — No per-team or per-project subdivision
