---
'@noormdev/cli': patch
'@noormdev/sdk': patch
---

Let MSSQL logins without server-level access connect. Connecting no longer detours through `master` to look the target up in `sys.databases`, so contained database users (the usual account on Azure SQL Database) and logins without `VIEW ANY DATABASE` can connect, and the config add/edit connection test passes for them. A database that is missing, or that the login cannot open, now fails with that reason instead of "Login failed".
