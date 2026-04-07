# Vault


Team-shared secrets need to live somewhere everyone can access them. Local secrets stay on your machine, but what about API keys that the whole team needs? The vault stores encrypted secrets in the database itself, distributing them to team members automatically.


## Secret Resolution Hierarchy

When a template references `secrets.API_KEY`, noorm checks three sources in order. The first match wins:

```
┌─────────────────────────────────────────────────────────────┐
│  1. Config-specific local secret         (highest priority) │
│     Your override for this specific config                  │
│     Location: .noorm/state/state.enc                        │
├─────────────────────────────────────────────────────────────┤
│  2. Global local secret                                     │
│     Your shared secret across all configs                   │
│     Location: .noorm/state/state.enc                        │
├─────────────────────────────────────────────────────────────┤
│  3. Vault secret                          (lowest priority) │
│     Team-shared value from the database                     │
│     Location: __noorm_vault__ table                         │
└─────────────────────────────────────────────────────────────┘
```

**Local always wins.** This lets you override team secrets for testing without affecting others.


### Example: Overriding a Team Secret

Your team stores the production Stripe key in the vault:

```
Vault:  STRIPE_KEY = "sk_live_abc123..."
```

For local development, you want to use Stripe's test mode. Set a local override through the TUI — `noorm ui` → Settings → Secrets → `a`, with key `STRIPE_KEY` and value `sk_test_xyz789...`. Local secrets are stored encrypted in your `.noorm/state/state.enc` and never leave your machine.

Now when templates reference `secrets.STRIPE_KEY`:

| Context | Resolved Value | Source |
|---------|----------------|--------|
| Your machine | `sk_test_xyz789...` | Local (your override) |
| Teammate's machine | `sk_live_abc123...` | Vault (no local override) |
| CI/CD pipeline | `sk_live_abc123...` | Vault (no local override) |

Your local override doesn't affect anyone else.


### When to Use Each Layer

| Layer | Use When |
|-------|----------|
| **Config-specific local** | Testing with different credentials per environment |
| **Global local** | Personal API keys you use across all configs |
| **Vault** | Team-shared secrets everyone needs |


## How Encryption Works

The vault uses dual-layer encryption to share secrets securely:

**Layer 1: Vault Key Distribution**

A single 256-bit vault key encrypts all secrets. Each team member receives their own encrypted copy of this key:

1. Generate ephemeral X25519 keypair
2. Perform ECDH with recipient's public key
3. Derive encryption key via HKDF-SHA256
4. Encrypt vault key with AES-256-GCM
5. Store in user's `encrypted_vault_key` column

When you connect, noorm decrypts your copy of the vault key using your private identity key.

**Layer 2: Secret Encryption**

Individual secrets are encrypted with the shared vault key:

- AES-256-GCM authenticated encryption
- Random IV per secret
- Stored as JSON in `__noorm_vault__` table

This design means: compromising the database alone doesn't expose secrets. An attacker needs both database access AND a team member's private key.


## Initializing the Vault

The first team member to initialize creates the vault key:

```bash
noorm vault init
```

This generates a new vault key and stores it encrypted for your identity. Only one person needs to do this per database.

If someone else already initialized:

```
Vault already initialized but you do not have access.
Ask a team member to propagate.
```


## Managing Secrets

Once you have vault access, manage secrets with these commands:

```bash
# Set a secret
noorm vault set API_KEY "sk-live-..."
noorm vault set DB_PASSWORD "secret123"

# List all secrets (values hidden)
noorm vault list

# Remove a secret
noorm vault rm OLD_API_KEY
```

The TUI provides a visual interface at **Secrets** (`k` from home):

- View all vault secrets with who set them
- Add, edit, and delete secrets
- See pending users who need access
- One-key propagation (`p`)


## Granting Team Access

New team members register their identity but don't automatically get vault access. Someone with access must propagate the key:

```bash
noorm vault propagate
```

This encrypts the vault key for each pending user's public key. After propagation, they can decrypt vault secrets on their next connection.

The TUI shows a badge when users are pending:

```
Vault  [2 pending]
```

Press `p` to propagate immediately.


## Copying Secrets Between Configs

Move secrets from one database to another:

```bash
# Copy specific secret
noorm vault cp API_KEY staging production

# Copy all secrets
noorm vault cp staging production

# Force overwrite existing
noorm vault cp --force staging production

# Preview without executing
noorm vault cp --dry-run staging production
```

If the destination vault isn't initialized, noorm initializes it automatically using your identity.


## Using Vault Secrets in Templates

Vault secrets merge into the template context alongside local secrets:

```sql
-- sql/setup/external-api.sql.tmpl
-- Vault secret (or local override if set)
INSERT INTO api_config (provider, key)
VALUES ('stripe', '<%= secrets.STRIPE_KEY %>');
```

The resolution order means you can:

1. Store production `STRIPE_KEY` in the vault
2. Override with a test key locally for development
3. Templates work identically in both cases


## CI/CD Integration

Vault commands run non-interactively, so you can manage secrets straight from a pipeline:

```bash
# Initialize vault
noorm vault init

# Set secret (value as argument)
noorm vault set API_KEY "$API_KEY"

# List with JSON output
noorm --json vault list

# Copy secrets between environments
noorm vault cp --all staging production
```

Pipe values to avoid command history:

```bash
echo "$SECRET_VALUE" | noorm vault set MY_SECRET
```


## Security Considerations

The vault design provides several security properties:

1. **End-to-end encryption** - Secrets encrypted in memory, transmitted encrypted, stored encrypted
2. **Zero-knowledge database** - Database administrators see only ciphertext
3. **Key rotation via propagation** - Each user has unique ciphertext for the same vault key
4. **No shared secrets in transit** - ECDH derives keys without transmitting them
5. **Authenticated encryption** - AES-256-GCM detects tampering

Limitations to understand:

- Team members with vault access can read all vault secrets
- Removing access requires regenerating the vault key (not yet supported)
- Lost private keys mean lost vault access (identity must be re-registered)


## Database Schema

The vault uses two database structures:

**`__noorm_vault__` table:**

| Column | Type | Description |
|--------|------|-------------|
| `id` | int | Primary key |
| `secret_key` | string | Secret name (unique) |
| `encrypted_value` | text | AES-256-GCM ciphertext (JSON) |
| `set_by` | string | Identity who set it |
| `created_at` | timestamp | Creation time |
| `updated_at` | timestamp | Last update time |

**`__noorm_identities__` extension:**

| Column | Type | Description |
|--------|------|-------------|
| `encrypted_vault_key` | text | Vault key encrypted for this user (nullable) |

A null `encrypted_vault_key` means the user is pending vault access.


## What's Next?

- [Secrets](/guide/environments/secrets) - Local secret storage
- [Identity](/dev/identity) - Cryptographic identity setup
- [Templates](/guide/sql-files/templates) - Using secrets in dynamic SQL
