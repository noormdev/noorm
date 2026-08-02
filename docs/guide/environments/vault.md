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
│     Location: the vault table                               │
└─────────────────────────────────────────────────────────────┘
```

**Local always wins.** This lets you override team secrets for testing without affecting others.


### Example: Overriding a Team Secret

Your team stores the production Stripe key in the vault:

```
Vault:  STRIPE_KEY = "sk_live_abc123..."
```

For local development, you want to use Stripe's test mode. Set a local override through the TUI: `noorm ui` → Config → highlight the config → `k` → `a`, with key `STRIPE_KEY` and value `sk_test_xyz789...`. Headlessly, `noorm secret set STRIPE_KEY "sk_test_xyz789..."`. Local secrets are stored encrypted in your `.noorm/state/state.enc` and never leave your machine.

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
- Stored as JSON in the vault table

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

The TUI provides a visual interface at **Vault** (`v` from home):

- View all vault secrets, each labeled with who set it
- Add a secret with `a`, edit one by selecting it
- See pending users who need access
- One-key propagation (`p`)

Removing a vault secret is CLI-only: `noorm vault rm <KEY>`.


## Granting Team Access

New team members register their identity but don't automatically get vault access. Someone with access must propagate the key:

```bash
noorm vault propagate
```

This encrypts the vault key for each pending user's public key. After propagation, they can decrypt vault secrets on their next connection.

The Vault screen counts them in its header:

```
3 secret(s) | 4 user(s) with access   (2 pending)
```

Press `p` there to propagate. noorm lists the recipients it is about to grant access to and asks you to confirm before it writes anything.


## Copying Secrets Between Configs

Move a secret from one database to another. `vault cp` takes three positional arguments in this order: the key, the source config, and the destination config. All three are required, so copy one key per invocation.

```bash
# Copy one secret
noorm vault cp API_KEY staging production

# Overwrite a key that already exists on the destination
noorm vault cp API_KEY staging production --force

# Preview without writing
noorm vault cp API_KEY staging production --dry-run
```

A dry run performs the same preflight as a real copy (vault access on both ends, source key exists, destination collisions) and only skips the write.

If the destination vault isn't initialized, noorm initializes it automatically using your identity.


## Using Vault Secrets in Templates

Vault secrets merge into the template context alongside local secrets:

```sql
-- sql/setup/external-api.sql.tmpl
-- Vault secret (or local override if set)
INSERT INTO api_config (provider, key)
VALUES ('stripe', {%~ $.quote($.secrets.STRIPE_KEY) %});
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
noorm vault list --json

# Copy a secret between environments
noorm vault cp API_KEY staging production
```

Pipe the value in with `--stdin` to keep it out of the process table, shell history, and `set -x` traces:

```bash
echo "$SECRET_VALUE" | noorm vault set MY_SECRET --stdin
```


## Security Considerations

The vault design provides several security properties:

1. **End-to-end encryption** - Secrets encrypted in memory, transmitted encrypted, stored encrypted
2. **Zero-knowledge database** - Database administrators see only ciphertext
3. **Per-user key distribution** - Propagation re-encrypts the same vault key for each recipient, so every user holds unique ciphertext
4. **No shared secrets in transit** - ECDH derives keys without transmitting them
5. **Authenticated encryption** - AES-256-GCM detects tampering

Limitations to understand:

- Team members with vault access can read all vault secrets
- Removing access requires regenerating the vault key (not yet supported)
- Lost private keys mean lost vault access (identity must be re-registered)


## Database Schema

The vault uses two database structures. Their names depend on the dialect: PostgreSQL and SQL Server put noorm's tracking tables in a dedicated `noorm` schema (`noorm.vault`, `noorm.identities`), while MySQL and SQLite have no schemas and keep the prefixed forms (`__noorm_vault__`, `__noorm_identities__`) in the default schema.

**The vault table:**

| Column | Type | Description |
|--------|------|-------------|
| `id` | int | Primary key |
| `secret_key` | string | Secret name (unique) |
| `encrypted_value` | text | AES-256-GCM ciphertext (JSON) |
| `set_by` | string | Identity who set it |
| `created_at` | timestamp | Creation time |
| `updated_at` | timestamp | Last update time |

**The identities table extension:**

| Column | Type | Description |
|--------|------|-------------|
| `encrypted_vault_key` | text | Vault key encrypted for this user (nullable) |

A null `encrypted_vault_key` means the user is pending vault access.


## What's Next?

- [Secrets](/guide/environments/secrets) - Local secret storage
- [Identity](/cli/identity) - The keypair that lets teammates encrypt secrets to you
- [Templates](/guide/sql-files/templates) - Using secrets in dynamic SQL
