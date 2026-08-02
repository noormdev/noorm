# Identity Management


This guide covers noorm's cryptographic identity system — the keys that authenticate you to shared state, sign your changes, and let teammates encrypt vault secrets to you.


## Overview

noorm uses X25519 cryptographic identities for secure config sharing and audit tracking. Each identity is stored locally in `~/.noorm/identity.key` (private key) and `~/.noorm/identity.json` (metadata). The public key is derived deterministically from the private key, and the identity hash (`email + name + publicKey`) is stable across machines, so the same private key always resolves to the same identity.

For CI runners, identities load from environment variables instead of files — see the [CI automation guide](../guide/automation/ci.md) for end-to-end setup, including `noorm ci identity new` (generate keypair) and `noorm ci identity enroll` (grant vault access on a target database).


## Creating an Identity

Run `noorm identity init` on your machine to create a keypair:

```bash
noorm identity init
```

This prompts for your name and email, generates a keypair, and writes:

- Private key: `~/.noorm/identity.key`
- Public key: `~/.noorm/identity.pub`
- Metadata: `~/.noorm/identity.json`

The private key never leaves your machine — your public key is what teammates use to share encrypted state with you.


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
