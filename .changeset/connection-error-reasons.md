---
'@noormdev/cli': patch
'@noormdev/sdk': patch
---

Say why a database connection failed: refused port, unknown host, timeout, rejected TLS certificate, disabled, locked, or expired account, missing grant, connection limit, missing password, and SQLite file or directory faults. Where the server withholds the reason (SQL Server 18456, PostgreSQL 28P01, MySQL 1045), the message says so and lists the usual causes. Exhausted retries report the server's last error. `connection:error` log entries carry `serverCode` and `serverMessage`.
