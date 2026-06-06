---
"@noormdev/cli": patch
---

fix(mssql): noorm db create / run no longer crash with "Pool is not a constructor"

In the bundled CLI, `await import('tarn')` / `await import('tedious')` expose
their exports under `.default`, so kysely's MSSQL dialect received an undefined
`Pool` and every MSSQL command (`noorm db create`, `run`, `change`, etc.) failed
with `Cannot connect to server: Pool is not a constructor`. Normalize the CJS
interop, mirroring the postgres dialect.
