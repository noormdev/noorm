# Identity Management

This guide covers noorm's cryptographic identity system and how to set up CI-based identities for automated workflows.


## Overview

noorm uses X25519 cryptographic identities for secure config sharing and audit tracking. Each identity is stored locally in `~/.noorm/identity.key` (private key) and `~/.noorm/identity.json` (metadata). For CI runners, you can bootstrap an identity directly from environment variables without creating files.


## CI Identity Setup

### Environment Variables

Three environment variables allow CI runners to load an identity:

- **`NOORM_IDENTITY_PRIVATE_KEY`** — X25519 private key as hex-encoded PKCS8 DER (96 hex characters)
- **`NOORM_IDENTITY_NAME`** — Display name (e.g., "CI Bot")
- **`NOORM_IDENTITY_EMAIL`** — Email address (e.g., "ci@example.com")

When these variables are present at process startup, every `noorm` command in that process sees the identity without touching `~/.noorm/`. The public key is derived from the private key, and the identity hash is computed from `email + name + publicKey`, so the same key always produces the same identity across all CI runners.

### Generating the Private Key

Run `noorm identity init` on your local machine to create a keypair:

```bash
noorm identity init
```

This prompts for your name and email, generates a keypair, and stores:
- Private key: `~/.noorm/identity.key`
- Public key: `~/.noorm/identity.pub`
- Metadata: `~/.noorm/identity.json`

To export the private key for CI secrets:

```bash
cat ~/.noorm/identity.key
```

Copy the hex output into your CI runner's secrets manager (e.g., GitHub Actions Secrets, GitLab CI Variables, etc.).

### GitHub Actions Example

```yaml
name: Deploy Database Changes

on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      
      - name: Validate identity
        env:
          NOORM_IDENTITY_PRIVATE_KEY: ${{ secrets.NOORM_IDENTITY_KEY }}
          NOORM_IDENTITY_NAME: 'GitHub CI'
          NOORM_IDENTITY_EMAIL: 'ci@company.com'
        run: noorm identity ci
      
      - name: Run migrations
        env:
          NOORM_IDENTITY_PRIVATE_KEY: ${{ secrets.NOORM_IDENTITY_KEY }}
          NOORM_IDENTITY_NAME: 'GitHub CI'
          NOORM_IDENTITY_EMAIL: 'ci@company.com'
        run: noorm run --auto
```

The `noorm identity ci` call is optional but recommended as a sanity check before production work.

### Validating CI Identity

The `noorm identity ci` command validates your environment variables without running the actual migration. It exits with status 0 if the identity is valid, or status 1 if any variable is missing or malformed:

```bash
NOORM_IDENTITY_PRIVATE_KEY=abc123... \
NOORM_IDENTITY_NAME="CI Bot" \
NOORM_IDENTITY_EMAIL="ci@example.com" \
noorm identity ci

# Output:
# CI identity loaded.
#   Name:        CI Bot
#   Email:       ci@example.com
#   Public key:  <derived public key>
#   Fingerprint: <identity hash>
```

To get JSON output for parsing:

```bash
noorm identity ci --json
```

## How It Works

1. **Bootstrap**: When the CLI starts (in `entry()` from `src/cli/index.ts`), it calls `loadIdentityFromEnv()`. If the three env vars are present and valid, it installs in-memory overrides for the private key and identity metadata.

2. **Transparent Lookup**: Every call to `loadPrivateKey()` or `loadIdentityMetadata()` checks the override first. If set, it returns the env-derived values without reading disk.

3. **Deterministic Hash**: The identity hash is computed from `email + name + publicKey` only. The public key is derived deterministically from the private key, so the same key produces the same identity on any machine.

4. **No Side Effects**: The env-based bootstrap does not write files. All decryption, encryption, and other operations use the in-memory identity.

## Key Points

- The public key is **derived** from the private key, not separately specified. This ensures it's deterministic.
- The identity hash is **independent of hostname or OS**. Same key = same identity across all runners.
- Env variables are **trimmed automatically**; leading/trailing whitespace is removed.
- If both env vars and disk files exist, **env vars take precedence**.
- All noorm commands automatically inherit the env identity once the CLI starts.
