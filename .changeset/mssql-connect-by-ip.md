---
"@noormdev/cli": patch
"@noormdev/sdk": patch
---

## MSSQL connects by IP address

### Fixed

* `fix(connection):` connecting to MSSQL by IP address works again. Tedious derived the TLS SNI ServerName from the host, and Node rejects an IP literal there (RFC 6066), so every IP connection failed with `Setting the TLS ServerName to an IP address is not permitted`. Hostname connections are unchanged. Encryption stays on — the connection is never silently downgraded to plaintext to work around it.
* `feat(connection):` new optional `connection.tlsServerName` — the hostname the server's TLS certificate is issued for. Required when connecting to an IP address with certificate validation enabled (`ssl` set), since a certificate cannot be validated against an IP. Without it, that combination now fails with an error naming the field instead of an opaque TLS error.
