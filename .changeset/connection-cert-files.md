---
'@noormdev/cli': minor
'@noormdev/sdk': minor
---

A config can name its CA, client certificate and client key by file path with `ssl.caFile`, `ssl.certFile` and `ssl.keyFile`, beside the inline `ca`, `cert` and `key`. noorm reads the files each time a pool opens, on every connect attempt, so a rotated certificate needs no config change, and stores the path, never the content. Stage defaults accept the file form. An unreadable, empty, oversized or non-PEM file fails with `SslFileError`, exported from `@noormdev/sdk`.

Private CAs and client certificates work on PostgreSQL, MySQL and MSSQL. `tlsServerName` also works on MySQL, for hostnames only. Layers combine `ssl` field by field, so a stage `caFile` survives a stored `ssl: true`. The TUI add and edit forms set Use SSL, Verify Certificate (unchecked stores `ssl.rejectUnauthorized: false`), the three file paths and the TLS server name. The edit form shows the state in effect, with `(stage: <path>)` for a file the stage supplies, keeps connection fields it does not show, and leaves the stored `ssl` as it was when no SSL field changed. The config list tags a config `tls` or `tls unverified`. A certificate file error is not reported as a missing database.

The TUI export carries every connection field that is not a credential, `tlsServerName`, `pool` and the timeouts included, and withholds `user`, `password` and the inline `ssl.key` and `ssl.cert`. The import saves those fields and previews the incoming TLS settings; certificate file paths must exist on the importing machine.

Behavior changes:

- TUI: connects with the stored config over its stage's defaults, as the CLI and SDK do. It applies no config variable (`NOORM_CONNECTION_*`, `NOORM_ACCESS_*`) and no flag to a config; settings variables still apply, so `NOORM_STAGES_<stage>_DEFAULTS_*` changes the stage defaults it merges, as `NOORM_PATHS_*` changes its paths. A TUI config whose stage sets a connection default the stored config lacks (`ssl`, `user`, `password`, `port`) connected without it and now uses it. A stage `isTest` or `type` likewise reaches build rules for a stored config that lacks the key; a stage `isTest` grants no permission. A stored value wins, and a stored `ssl: false` turns a stage's `ssl` off.
- TUI: a stored config that does not combine with its stage into a valid config is not activated. Home shows the message and the config stays editable.
- TUI export: an inline `ssl.key` and `ssl.cert` were written to the export file and are withheld.
- A scalar `NOORM_CONNECTION_SSL` beside a nested `NOORM_CONNECTION_SSL_*` variable fails with a message that names both and says to set one form, not both.
- MSSQL: `ssl: { rejectUnauthorized: false }` encrypts without validating the server certificate, as on PostgreSQL, and lifts the `tlsServerName` requirement for an IP host.
- MySQL: `ssl: { rejectUnauthorized: false }` skips validation, where it validated before. A `tlsServerName` was ignored and now fails the connection when `ssl` is off, when `rejectUnauthorized` is `false`, when the name is an IP address, or when the certificate lacks the name.
- MySQL and MSSQL: an inline `ca`, `cert` or `key` already in a config was ignored and is used. A `ca` replaces the default trust store.
- A layer that sets `ssl` does not inherit a lower layer's `rejectUnauthorized`: an `ssl` object over a lower `{ rejectUnauthorized: false }` skipped validation on PostgreSQL and now validates. A higher `ssl: true` keeps the lower object's certificate fields, where it replaced the object. Set `rejectUnauthorized: false` in the higher layer to skip validation.
- An SDK inline `ssl: undefined` keeps a lower layer's `ssl`.
- An environment or inline `ssl` key spelled in another letter case, such as `CAFILE`, is refused with the right spelling.

See [certificates](https://noorm.dev/dev/config#tls-certificates).
