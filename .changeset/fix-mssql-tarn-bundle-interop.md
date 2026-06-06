---
"@noormdev/sdk": patch
---

fix(mssql): construct tarn/tedious through CJS-interop guard in bundles

When the SDK is bundled (tsup), `await import('tarn')` / `await import('tedious')`
expose their exports under `.default`, so spreading the namespace left
`tarn.Pool` undefined and kysely threw `Pool is not a constructor` on every
MSSQL connection. Normalize both with `module.default ?? module`, mirroring the
postgres dialect's existing guard.
