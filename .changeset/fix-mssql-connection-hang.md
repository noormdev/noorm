---
"@noormdev/cli": patch
---

## Connection

### Fixed
* `fix(mssql):` Connection hangs when target database does not exist — now verifies via `sys.databases` on `master` first
* `fix(mssql):` `ECONNRESET` on MSSQL Server 2022+ due to `encrypt: false` — now defaults to `encrypt: true`
* `fix(mssql):` Tarn pool silently retries failed connections — enabled `propagateCreateError` for fast failure
* `fix(connection):` Retry logic retried non-transient errors like `login failed` and `access denied`
