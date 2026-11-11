---
id: connection-cert-files-policy-fingerprint-binding
title: Policy fingerprint differs between stored-bound and resolver-bound configs
created: "2026-11-11"
origin: |
    docs/spec/connection-cert-files.md, final audit and reviews
kind: finding
severity: risk
review_by: "2027-01-10"
status: open
file: src/core/config/resolver.ts:182
---

resolveConfig binds policy on the merged connection (defaults, environment, inline) while withConfigPolicy binds the stored connection, so the two target fingerprints differ whenever a default such as pool applies. Probed with no ssl fields involved; predates the certificate-file work. Nothing breaks today because each entry point grants and checks against one binding. An approval minted through one path and checked through the other would not match.
