---
"@noormdev/sdk": patch
---

## Changed
* `fix(vault):` `vault.init()` is now idempotent. A repeat call against an already-initialized vault returns `[null, null]` instead of `[null, Error('Vault already initialized')]`. The `vault:initialized` observer event still fires only on first init.

This is a behavior change for callers that were special-casing the `'Vault already initialized'` error string — they now see no error on repeat and must check whether the returned key is `null` (already initialized) or a `Buffer` (newly generated).
