---
id: connection-cert-files-policy-fingerprint-binding
title: CLI commands bind policy on the stored config, not the resolved one
created: "2026-11-11"
origin: |
    docs/spec/connection-cert-files.md, final audit and reviews
kind: finding
severity: risk
review_by: "2027-01-10"
status: open
file: src/core/config/resolver.ts:295
---

The TUI binds every stored config with effectiveConfig, whose fingerprint equals resolveConfig's when no NOORM_* variable is set (pinned in tests/core/config/resolver.test.ts). What remains is the CLI: 19 call sites of withConfigPolicy under src/cli bind the stored connection with no defaults and no stage defaults, so their fingerprint differs from resolveConfig's for any config that leaves a default such as pool unset or takes a connection field from its stage. No site mints an approval on one binding and checks it on the other: only src/cli/vault/cp.ts both binds this way and calls withPolicyConfirmation, and it hands the same two objects to copyVaultSecrets; every other approval is minted on ctx.noorm.config. A mismatch can only deny, because an approval matches by exact fingerprint.

Three of those sites do more than check a permission, and there the stored-only binding changes behavior: src/cli/config/use.ts connects for the identity sync with the stored connection, so a stage ssl, user or password is not applied (the TUI activation applies them); src/cli/db/transfer.ts and src/cli/vault/cp.ts hand a stored-bound destination to the transfer and the vault copy. A stored config with no access key also fails in withConfigPolicy with a TypeError where effectiveConfig applies the stage roles. Moving these to effectiveConfig changes CLI behavior and needs its own spec.
