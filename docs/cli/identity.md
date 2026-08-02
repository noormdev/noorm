# Identity Management


This guide covers noorm's cryptographic identity system — the keys that authenticate you to shared state, sign your changes, and let teammates encrypt vault secrets to you.


## Overview

noorm uses X25519 cryptographic identities for secure config sharing and audit tracking. Each identity is stored locally in `~/.noorm/identity.key` (private key) and `~/.noorm/identity.json` (metadata). The public key is derived deterministically from the private key, so it never has to be stored separately to be recovered.

A disk identity is hashed as `SHA-256(email + name + machine + os)`, where `machine` is the hostname. The same person on two laptops is therefore two identities in the audit trail, and each needs vault access propagated to it. Env-var identities hash differently on purpose, so a CI fleet reads as one user: see [Env-Var Identity (CI)](#env-var-identity-ci) below.

For CI runners, identities load from environment variables instead of files — see the [CI automation guide](../guide/automation/ci.md) for end-to-end setup, including `noorm ci identity new` (generate keypair) and `noorm ci identity enroll` (grant vault access on a target database).


## Creating an Identity

Run `noorm identity init` on your machine to create a keypair. `--name` and `--email` are both required; the command does not prompt.

```bash
noorm identity init --name "Alice Cooper" --email alice@example.com
```

This generates a keypair and writes:

- Private key: `~/.noorm/identity.key` (mode `0600`)
- Public key: `~/.noorm/identity.pub` (mode `0644`)
- Metadata: `~/.noorm/identity.json`

The private key never leaves your machine. Your public key is what teammates use to share encrypted state with you.

If an identity already exists, `init` refuses. Replacing it takes `--force --yes`, and it is destructive: state encryption is keyed off the private key, so every noorm project on the machine loses access to the configs, secrets, and database passwords in its `.noorm/state/state.enc`. Nothing re-encrypts existing state under the new key. noorm copies the old key files to `.bak-<timestamp>` siblings before overwriting, and aborts if it cannot. An ambient `NOORM_YES` does not satisfy this confirmation; only the literal `--yes` flag does.


## Editing Your Identity

Update the display name or email on the existing identity. At least one of `--name` or `--email` must be provided.

```bash
noorm identity edit --name "Alice Cooper"
noorm identity edit --email "alice@newjob.com"
```


## Exporting Your Public Key

Print your public key so teammates can add you to encrypted vaults:

```bash
noorm identity export
noorm identity export --json
```


## Listing Known Identities

Show every identity discovered from database syncs (the audit trail of who has touched shared state):

```bash
noorm identity list
noorm identity list --json
```


## Env-Var Identity (CI)

When `NOORM_IDENTITY_PRIVATE_KEY`, `NOORM_IDENTITY_NAME`, and `NOORM_IDENTITY_EMAIL` are set at process startup, every `noorm` command in that process uses the env-derived identity without touching `~/.noorm/`.

The variables are read once when the process starts, so they apply to every command that process runs.

**Guarantees:**

- The public key is **derived** from the private key, not separately specified — same key, same public half.
- The identity hash is **independent of hostname or OS** (CI uses `os='env'`, `machine=publicKey`) — same key, same identity across every runner.
- Env vars are **trimmed automatically** — leading/trailing whitespace is removed.
- **Env vars win over disk** — if both are present, env takes precedence.
- **No files written** — env-based bootstrap is read-only.

To generate a CI-shaped keypair without touching the database, use `noorm ci identity new` (see the [CI automation guide](../guide/automation/ci.md)).
