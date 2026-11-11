# Connection certificate files


## Goal


A config names its CA, client certificate and client key by file path, and noorm reads the files each time it opens a connection pool. A private CA and a client certificate work on PostgreSQL, MySQL and MSSQL, `tlsServerName` works on all three dialects, and the TUI add and edit forms set and keep SSL settings without dropping fields they do not show.

The TUI honors every TLS setting the CLI and SDK honor. It connects with the stored config merged over the defaults of its stage, a stage's `ssl` included. The edit form and the config list show the TLS state in effect, the add and edit forms set certificate verification, and the TUI export and import carry every connection field that is not a credential.


## Non-goals


- The tunnel (spawned `ssh` or command, `connection.tunnel`). It ships in a later pull request.
- An embedded SSH client.
- PFX or PKCS#12 bundles, passphrase-protected keys, certificate revocation lists.
- Reading certificates from a secret manager or the vault.
- Turning on MySQL hostname verification for configs that do not set `tlsServerName`.
- `tlsServerName` in stage defaults.
- The worker-thread connection path (`src/workers/connection.ts`), which receives a dialect and a connection string only. No feature connects to a server database through it.
- Environment overrides (`NOORM_CONNECTION_*`) and inline flags in the TUI. The TUI's effective config is built from defaults, the stage and the stored config only.
- A TUI equivalent of `noorm config sync`. The TUI never overwrites stored values from a stage.
- Prefilling host, port, database or user on the add form from a stage.
- Stage values in a TUI export. The export holds the stored config.
- A change to the CLI `config export`, which writes the whole config and requires `secret:read`.
- Stage state on the add form. It shows no stage `ssl` and no stage placeholder, because no screen opens it for a stage.
- Regenerating `docs/public/image/tui/config-add.png`. The orchestrator runs `docs/tapes/shots.sh` after the checkpoints and then deletes `.claude/project/followups/connection-cert-files-tui-screenshot.md`. No checkpoint touches the image or that file.
- A committed certificate or private key. `scripts/gen-test-tls.sh` generates the fixture certificates on each machine into a gitignored directory.
- TLS-enforcing services in the default `docker compose up`. They sit behind the `tls` profile and start only when named, and the three plain services and their tests are unchanged.
- Validating the certificate SQL Server generates for itself. SQL Server 2022 holds it in memory, writes it to no file and lists it in no catalog view, so `tests/integration/connection/mssql-tls.test.ts` stays unvalidated. The validated MSSQL cases run against the `mssql-tls` service, whose certificate comes from a file.
- A client-certificate case for MSSQL. SQL Server has no client-certificate login.
- A live plaintext refusal for MSSQL. noorm always encrypts a SQL Server connection, so `ssl: false` connects encrypted to a server that forces encryption.
- A CI job that runs the compiled binary. Certificate files and `NODE_EXTRA_CA_CERTS` in the binary are checked by hand.
- Hand-editing `docs/wiki/`. `/refresh-wiki` regenerates those pages after the change.


## Success criteria


- [ ] `ssl.caFile`, `ssl.certFile` and `ssl.keyFile` are accepted by `ConnectionSchema` and `PartialConnectionSchema` in `src/core/config/schema.ts`, by `ConnectionConfig.ssl` in `src/core/connection/types.ts` (and so by the SDK `InlineConnection`), and by the environment variables `NOORM_CONNECTION_SSL_caFile`, `NOORM_CONNECTION_SSL_certFile` and `NOORM_CONNECTION_SSL_keyFile`.
- [ ] Stage defaults accept `ssl` as a boolean or `{ caFile, certFile, keyFile, rejectUnauthorized }`. Inline `ca`, `cert` or `key` in stage defaults fails settings validation.
- [ ] Setting the inline form and the file form of the same field (`ca` and `caFile`, `cert` and `certFile`, `key` and `keyFile`) is a validation error that names the field.
- [ ] Layers combine `ssl` field by field. A higher layer `ssl: false` turns SSL off regardless of lower layers. A higher layer `ssl: true` over a lower-layer object keeps the lower object's certificate fields. An object over an object combines per field: for each of `ca`, `cert` and `key`, the higher layer's form (inline or file) replaces the lower layer's form of that field, whichever form the lower layer used. `rejectUnauthorized` is never inherited: it comes only from the highest layer that sets `ssl`, so a higher `ssl: true`, or a higher object that does not state it, validates the certificate whatever a lower layer said. An object over nothing is that object. The resolver merge and `config sync` use the one combining function.
- [ ] The same-field exclusion error applies within a single layer: one stored config, one stage default, the environment, or one SDK inline connection. Each layer is checked before it is combined: stored configs and stage defaults by their schemas, and the environment and SDK inline `ssl` by `SSLSchema` before the merge on both resolver paths, the stored-config merge and `resolveFromEnvOnly`. An environment `ssl` holding `ca` and `caFile` under an SDK inline `ssl: { caFile }` fails naming `ssl.ca` on both paths, although the inline form would replace the environment's form when combined. `NOORM_CONNECTION_SSL_CA` with `NOORM_CONNECTION_SSL_caFile`, or an inline connection with `ca` and `caFile`, fails resolution naming `ssl.ca`. An environment or inline `ssl` key that matches a known key in another letter case (`CAFILE`, `cafile`, `REJECTUNAUTHORIZED`) fails resolution naming the camelCase spelling, so `NOORM_CONNECTION_SSL_CAFILE` is not dropped silently. After valid layers combine, no inline and file pair of one field conflicts, so a stage `caFile` under a stored inline `ca` resolves to the inline `ca` only, and `NOORM_CONNECTION_SSL_caFile` over a stored inline `ca` resolves to `caFile` only.
- [ ] `config sync` combines `ssl` with the same function. Sync's stage values win over stored values (the stage is the higher layer), so a stage `ssl: { caFile }` over a stored `ssl: { certFile, keyFile }` keeps the stored `certFile` and `keyFile`. The `config sync` preview prints `[inline PEM]` in place of an inline `ca`, `cert` or `key`, in text and JSON output.
- [ ] `createConnection` turns file fields into PEM text in one step that runs before the dialect factory, on every pool open. Dialect factories and the option builders receive PEM text only, and no file under `src/core/connection/dialects/` imports `node:fs`.
- [ ] `resolveSslFiles` resolves a relative path from the working directory and expands a leading `~/` to the user's home directory. The CLI and TUI change to the project root at startup (`initProjectContext`), so there the working directory is the project root. The SDK is the one entry point whose project root can differ from the working directory, so it anchors relative ssl file paths to its `projectRoot` option in two places, each after policy binding: the `Context` constructor (the context's own config, stored or `config: false`) and `bindSdkDestination` (transfer and vault destinations). The policy target fingerprint is therefore computed on the path as written at every entry point, and `resolveConfig` returns paths as written. A `~/` path and an absolute path are left as written by anchoring. The anchored path lives in memory only; the stored value is the path as written. An empty-string or whitespace-only file path fails schema validation naming the field.
- [ ] An unreadable file fails with `SslFileError`, which carries the field (`ssl.caFile`) and the path and never file content. A path that is not a regular file fails with the code `EINVAL`, an empty or whitespace-only file with `EMPTY`, a file larger than 1 MiB with `EFBIG` before it is read, and a file that holds no PEM block (no `-----BEGIN ` line, for example a DER-encoded certificate) with `ENOTPEM`, each before any connection is attempted. `openConnection` does not retry an `SslFileError`, and the failure reaches the `connection:error` event. The event message is the `SslFileError` message even when a `runtime.password` callback is set, because that message holds a field and a path and no secret. An SDK caller can test `instanceof SslFileError` on a rejected `connect()`, because `src/sdk/index.ts` exports the class. A SQLite connection reads no ssl files.
- [ ] `explainConnectionError` returns an `SslFileError` unchanged, so callers keep `instanceof SslFileError`, and the `connection:error` event carries no `serverCode` for it. The TLS certificate hint names `ssl.caFile` as the way to trust a private authority and, on all three dialects, `ssl.rejectUnauthorized: false` as the way to keep encryption without validation. On PostgreSQL and MySQL with `tlsServerName` set, the hint adds that `tlsServerName` must be removed too, because it requires validation. A hostname mismatch (`ERR_TLS_CERT_ALTNAME_INVALID`) gets its own hint, which names `tlsServerName` and the certificate's hostname and does not suggest a certificate authority. The hints also appear for MySQL, where mysql2 reports a rejected certificate under the code `HANDSHAKE_SSL_ERROR` with the TLS reason in the message; a self-signed server certificate maps to `DEPTH_ZERO_SELF_SIGNED_CERT` and a self-signed certificate in the chain to `SELF_SIGNED_CERT_IN_CHAIN`.
- [ ] `state.enc`, `config export` output (CLI and TUI), observer events and error messages never contain file content. A `keyFile` that points at a non-PEM file puts its content in no thrown error and no `connection:error` event. A config saved with the file form and reloaded from state holds paths and no PEM. `config export` of such a config prints paths and no PEM. The CLI export writes the config as stored, inline PEM included. The TUI export withholds inline `ssl.key` and `ssl.cert`.
- [ ] `config import` and the TUI import accept a path without checking that the file exists. `config validate` (`validateConfigChecks`) and the TUI connection test report the `SslFileError` message for an unreadable path.
- [ ] PostgreSQL: the output of `resolveSslFiles` passed to `buildPostgresPoolOptions` carries `ca`, `cert` and `key` in the `pg` ssl object with and without `tlsServerName`, and file fields never reach `pg`. `postgres.ts` needs no edit, because its `resolveSsl` spreads `config.ssl` unchanged.
- [ ] MySQL: `ca`, `cert`, `key` and `rejectUnauthorized` reach mysql2's `ssl`. With `tlsServerName`, mysql2 receives the name as `host`, a `stream` function dials the real host and port with the keepalive and no-delay settings mysql2 applies to its own socket, and `verifyIdentity` is true. The `stream` function takes its keepalive settings from mysql2's resolved connection config, so keepalive is on when no keepalive option is set, and a `driver` override of `enableKeepAlive` or `keepAliveInitialDelay` applies to the dialed socket. An IP address as `tlsServerName` throws, naming the field, because mysql2 sends no TLS name for an IP and the certificate would be checked against the dial host. `tlsServerName` without `ssl` throws `MySQL TLS identity options require ssl to be enabled explicitly`, and `tlsServerName` with `ssl.rejectUnauthorized: false` throws `MySQL TLS identity options require certificate verification`. Both mirror `src/core/connection/dialects/postgres.ts:25` and `:30` with "MySQL" in place of "PostgreSQL". `verifyIdentity` is unset when `tlsServerName` is absent.
- [ ] MSSQL: `ca`, `cert` and `key` reach tedious as `options.cryptoCredentialsDetails`. Certificate validation is on when `ssl` is truthy and `ssl.rejectUnauthorized` is not `false`. `trustServerCertificate` and the IP-host `MssqlTlsServerNameError` check both follow that one rule, so an IP host with `ssl: { rejectUnauthorized: false }` and no `tlsServerName` does not throw.
- [ ] The inline `driver` passthrough stays rejecting `ssl`, `stream` (MySQL and PostgreSQL) and `cryptoCredentialsDetails` (MSSQL) in `src/core/connection/options.ts`. `tests/core/connection/options.test.ts` is the regression pin.
- [ ] One function in `src/core/config/resolver.ts` returns the effective config of a stored config: defaults, then the defaults of the stage with the config's name, then the stored config, combined by `mergeLayer`, so `ssl` combines through `combineSsl`. It reads no environment variable and takes no flags. The TUI therefore applies no config variable (`NOORM_CONNECTION_*`, `NOORM_ACCESS_*`) and no flag to a config. Settings variables still apply: `NOORM_STAGES_<stage>_DEFAULTS_*` changes the stage defaults the TUI merges, as `NOORM_PATHS_*` changes its paths. With no `NOORM_*` variable set, its connection equals the connection `resolveConfig` returns for the same name, for a stored config as persisted (no key whose value is `undefined`), and with `NOORM_CONNECTION_HOST` set its result is unchanged. Its access roles come only from the stored config over its stage, never from the environment: with `NOORM_ACCESS_USER` or `NOORM_ACCESS_AGENT` set, they equal the roles of the stored config over its stage. `resolveConfig` and this function share the merge of the default, stage and stored layers, and `resolver.ts` holds one copy of it. The function mutates neither the stored config nor the stage defaults. Policy is bound on the effective connection: the bound target identity equals `policyTargetIdentity` of the project root and the effective connection.
- [ ] The effective config merges `type`, `isTest` and `access` from the stage beneath the stored config, as `resolveConfig` does. Its policy context `isTest` is true only when the stored config's own `isTest` is true, so a stage `isTest: true` never grants the trusted-test relaxation to a stored config that does not set it. The guarantee lives in the result of the effective-config function: it returns the config with its policy context bound from the stored `isTest`, in both role-validation modes, and each site uses that bound result without deriving `isTest` again. No TUI site binds policy from an effective config's own `isTest` field, which is what `withConfigPolicy` reads (`config.isTest === true`). Every site that binds an effective config (the app context, activation in `ConfigUseScreen` and `ConfigListScreen`, the transfer destination in `DbTransferScreen`) gets a policy context whose `isTest` is true only when the stored config's own is. A stored transfer destination without `isTest` under a stage `isTest: true`, with a role denied `db:reset`, stays refused. The re-bind in `SqlTerminalScreen` (`handleExecute` and `confirmQuery`) validates roles and takes `isTest` from the policy context bound on `activeConfig`, not from the config's `isTest` field. With no `NOORM_*` variable set, `getPolicyFingerprint` of the effective config equals `getPolicyFingerprint` of `resolveConfig`'s result for the same name, for a stored config as persisted.
- [ ] A stored or form connection field whose value is `undefined` counts as absent in the effective config. The rule lives in the effective-config function and applies to the stored layer and the form layer. A stage `user` or `password` therefore reaches a config the TUI saved with a blank user or password, before and after a restart.
- [ ] The app-context `activeConfig` is the effective config of the active stored config, with policy bound on it. A stored config with no `ssl` under a stage `ssl: { caFile }` gives `activeConfig.connection.ssl` equal to `{ caFile }`, and a stage `password` reaches a stored config that has none. `activeConfig` is the same object across provider re-renders while the stored config and the settings are unchanged, so `ConnectionProvider` opens one connection and `retainConnection` does not throw `The database target changed`. A change to the stored config or to the settings produces a new object.
- [ ] When the stored config cannot be built into an effective config (for example `pool.min` above the default `pool.max`, or a database name the schema refuses), the app stays ready, `activeConfig` is null, `activeConfigName` keeps the name and `activeConfigAccessError` carries the message. The TUI never connects with the unmerged stored config.
- [ ] Every TUI site that loads a config by name to connect or test uses the effective config of that name: activation in `ConfigUseScreen` and `ConfigListScreen` (the identity sync), `ConfigValidateScreen`, and the transfer destination in `DbTransferScreen`. A policy fingerprint is minted and checked on the same effective object at every site. For each site a test gives a stored config with no `ssl` a stage `ssl: { caFile }` and shows that the site connects with that `caFile`. `ConfigValidateScreen` and `DbTransferScreen` show it on the config handed to `testConnection` and to the transfer functions. Activation connects through `createConnection`, so its tests point the stage `caFile` at a missing file and assert the stage's path in the `SslFileError` message that `syncIdentityWithConfig` emits on the observer `error` event (source `identity:sync:connection`).
- [ ] The app context and `DbTransferScreen` bind without validating roles, so a config with an unknown role stays visible for repair. `ConfigUseScreen` and `ConfigListScreen` validate roles on activation and show the error. `ConfigValidateScreen` validates no roles. The config list builds each row's effective config with roles validated, so it cannot build one for a stored config with an unknown access role. That row renders, without a TLS tag.
- [ ] Every TUI site that binds policy on a stored config binds the effective config, so the TUI holds one policy binding. `ConfigExportScreen` (the `secret:read` check and the fingerprint of its confirmation) and `ConfigRemoveScreen` (the `config:rm` check) call `effectiveConfig` with roles validated, and show a thrown error's message through the screen's error step and its blocked panel. No file under `src/tui/` calls `withConfigPolicy`. For each of the two screens a test gives a stored config with no `access` a stage whose `access` is `{ user: 'viewer', agent: false }` and reads the viewer's blocked reason on the screen. The export still writes the stored config's own fields.
- [ ] The add and edit connection tests use the connection built from the form over the defaults of the stage that matches the name in the form. With a stage `ssl: { caFile }` and no SSL field touched, the config handed to `testConnection` carries the `caFile` and the saved config holds no `ssl` key. With a blank user and password on the add form under a stage `password`, `testConnection` receives the stage password.
- [ ] Nothing the TUI saves contains a stage value the user did not set, with one exception: stage auto-creation in `src/tui/app-context.tsx`, which materializes a stage into a new stored config, stage defaults included, when no config of that name exists. `ConfigEditScreen` loads the stored config, and the add, edit, copy and import screens save connections built from stored or typed values only.
- [ ] The TUI add and edit forms carry Use SSL (checkbox), Verify Certificate (checkbox), CA file, client certificate file, client key file and TLS server name. The edit form shows none of the six for SQLite. On the edit form Use SSL is initially checked when the effective `ssl` is on, whether the stored config or the stage supplies it, and Verify Certificate is initially unchecked only when the effective `ssl.rejectUnauthorized` is `false`. On the edit form a certificate file field whose effective value comes from the stage and not from the stored config is empty and shows the placeholder `(stage: <path>)`. A field whose stored form is inline PEM shows the placeholder `(inline certificate stored)`.
- [ ] The add form shows no stage state. Use SSL starts unchecked, Verify Certificate starts checked, and no field shows a `(stage: <path>)` placeholder, whatever name the form holds. The stage that matches the name in the form still applies beneath the form values for the connection test and for `validateSslForm` at submit. `matchedStage` supplies the default access only.
- [ ] A stored `ssl: false` over a stage `ssl: { caFile }` gives an effective `ssl` that is off, so the edit form shows Use SSL unchecked and no stage placeholder. Checking Use SSL stores `ssl: true`, and the stage's `caFile` then applies. This is the intended result.
- [ ] A save leaves the stored `ssl` exactly as it was when none of Use SSL, Verify Certificate and the three file fields changed, and leaves the stored `tlsServerName` as it was when its field did not change. An absent key stays absent, whatever the stage supplies. A change to Verify Certificate alone, with Use SSL unchecked and unchanged, counts as untouched: it stores nothing, and an absent `ssl` stays absent. The add form stores no `ssl` key when those fields are untouched. The port follows the same rule: the edit form opens the Port field on the stored port, empty when the stored config has none, and a save with the field empty keeps the stored port, absent included, so a stage `port` still applies. The add form stores the dialect default for an empty Port field.
- [ ] When an SSL field changed, the save stores what the form shows. Unchecking Use SSL stores `ssl: false`, which also overrides the stage. Checking it on a config whose stored `ssl` is `false` or absent stores `true`, or an object when a path or Verify Certificate adds a field, and the stage's certificate fields still apply through `combineSsl`. With Use SSL checked and no path, inline PEM or `rejectUnauthorized` remaining, the save stores `ssl: true`. Unchecking Verify Certificate with Use SSL checked stores `ssl.rejectUnauthorized: false`. Checking it removes a stored `rejectUnauthorized: false`. When the stage supplied the `false`, checking it stores `ssl: true`, so the stored layer sets `ssl` and the effective config validates the certificate. When the stage supplies `rejectUnauthorized: false`, the stored `ssl` is absent, and the user enters a CA path and leaves Verify Certificate unchecked, the save stores `{ caFile, rejectUnauthorized: false }`, because `rejectUnauthorized` is never inherited and the stored layer must state what the form shows. Verify Certificate stores nothing while Use SSL is unchecked.
- [ ] File fields map the same way on both forms. An entered path sets the file field and removes inline PEM of that field. An emptied field whose stored form is a path removes that path. An empty field whose stored form is inline PEM keeps the PEM. An empty field under a stage placeholder stores nothing. Typed paths and the TLS server name are trimmed at both ends. The edit screen preserves every connection field the form does not show (`pool`, inline PEM, timeouts, `applicationName`, keepalive fields), except a SQLite `filename`, which the edit form drops so the Database field decides which file opens.
- [ ] `validateSslForm` judges the effective result of the save: the connection the save would store, over the defaults of the stage that matches the name in the form. For PostgreSQL and MySQL a TLS server name fails at submit when the effective `ssl` would be off, and when the effective `rejectUnauthorized` would be `false`. It passes when a stage supplies `ssl` beneath an untouched Use SSL. For MSSQL the name is allowed in every case, because MSSQL always encrypts and uses the name without `ssl`. A certificate file path fails at submit on every server dialect when the effective `ssl` would be off: any path on the add form, and a path the user entered or changed on the edit form. Unchecking Use SSL on a config with stored paths, without touching them, still saves. A failure shows as the form's error message and saves nothing.
- [ ] The config list row of a server-dialect config shows `tls` when the effective `ssl` is on, `tls unverified` when the effective `ssl.rejectUnauthorized` is `false`, and no TLS tag when the effective `ssl` is off. The tag sits in the row description beside the access and test tags. A stored config with no `ssl` under a stage that supplies `ssl` shows `tls`. A SQLite row shows no TLS tag.
- [ ] The TUI export builds its connection by removing credentials from the whole stored connection: `user`, `password`, and the inline `ssl.key` and `ssl.cert`. Every other stored connection field travels: `dialect`, `host`, `port`, `database`, `filename`, `tlsServerName`, `pool`, `connectTimeoutMs`, `statementTimeoutMs`, `queryTimeoutMs`, `applicationName`, `keepAlive`, `keepAliveInitialDelayMs`, and in `ssl` the inline `ca`, `rejectUnauthorized`, `caFile`, `certFile` and `keyFile`. An `ssl` object left with no field after the removal exports as `true`. One valid config cannot set every field, because `SSLSchema` refuses the inline and the file form of one field together. A test therefore exports two configs that between them set every field above, one with the inline `ssl` form (`ca`, `cert`, `key`) and one with the file form (`caFile`, `certFile`, `keyFile`). It asserts each field on the decrypted payloads, and that `user`, `password`, `ssl.key` and `ssl.cert` are absent.
- [ ] The TUI import saves the config that one `parseConfig` call returns for the name on its form and the file's `type`, `isTest`, access and connection, with `user` and `password` from its form and never from the file. A file whose `type` or `isTest` the schema refuses shows the error and saves nothing. Every connection field the schema knows travels, and an unknown key in the file is not persisted. An export file that holds `dialect`, `host`, `port`, `database` and `ssl` only imports to a config with those fields. The import preview shows the incoming SSL state (on or off), certificate verification (on or off), each certificate file path and the TLS server name. When the file holds a certificate file path, the preview says the path must exist on this machine. The preview renders for a file whose `ssl` is `null` and for a file with no `secrets` key.
- [ ] The TUI import preview shows the privileges the import saves: a `Roles: user <role>, agent <role|off>` line with the roles after `resolveLegacyAccess`, so a file that carries `protected: true` and no `access` shows `user operator, agent viewer`, and, only when the file's `isTest` is `true`, the line `Test database: every role gets at least admin's permissions`. The preview and its form fit the 20 rows the shell leaves on an 80x24 terminal for a file that sets every TLS field, the roles and `isTest`: the panel has no vertical padding, sender and secrets count share a row, dialect, database and host share a row, and SSL, certificate verification and the TLS server name share a row. A test measures the frame at 80 columns.
- [ ] The CLI `config export` output is unchanged: `tests/cli/config/export.test.ts` passes without an edit.
- [ ] An `SslFileError` is never classified as a missing database. The two TUI classifiers, `isDatabaseMissingError` in `src/tui/screens/home.tsx` and `isDatabaseNotFoundError` in `src/tui/components/status/ConnectionStatus.tsx`, receive a message string and not an error, so `src/core/connection/ssl-files.ts` exports one predicate, `isSslFileErrorMessage`, defined beside `messageFor`. `DbListScreen` picks its badge with `isDatabaseNotFoundError`, so it needs no edit. It is true for the message of every `SslFileError` code, with and without the TUI's `Connection failed: ` prefix, and false for the PostgreSQL, MySQL and MSSQL missing-database messages. Each classifier calls it first and returns "not a missing database" when it is true. With `ssl.caFile` set to a missing file under a directory named `does not exist`, and again under one named `unknown database`, Home shows the error state with the message and not the database-missing state, `isDatabaseNotFoundError` in `src/tui/components/status/ConnectionStatus.tsx` returns false, and `DbListScreen` shows the `ERROR` badge with the message and not `NOT CREATED`. A server message such as `database "app" does not exist` still classifies as a missing database at all three sites.
- [ ] `NOORM_CONNECTION_SSL` set to a scalar (`true` or `false`) together with a nested ssl variable such as `NOORM_CONNECTION_SSL_caFile` fails in `getEnvConfig` with a `ConfigValidationError` whose field is `connection.ssl`. The message names both variables and says that a scalar `NOORM_CONNECTION_SSL` cannot be combined with a nested `NOORM_CONNECTION_SSL_*` variable: set one form, not both. A scalar and a nested variable under any other key keep the parser's own error.
- [ ] `docs/tui.md`, `docs/guide/environments/configs.md`, `docs/guide/environments/stages.md`, `docs/dev/config-sharing.md`, `docs/dev/datamodel.md`, `skills/noorm/references/config.md` and `.changeset/connection-cert-files.md` state that the TUI applies stage defaults beneath the stored config, that it applies no config variable and no flag to a config while settings variables still apply, describe Verify Certificate and the TLS tag in the config list, and list what the TUI export carries and withholds. The changeset names the behavior change: the TUI connects with stage defaults beneath the stored config, so a TUI config whose stage sets connection defaults the stored config lacks connects differently. The `### TUI` section of `docs/design/enterprise-connectivity.md` describes the same decision, and the rest of the design is unchanged.
- [ ] `.claude/project/followups/` holds none of `connection-cert-files-tui-export-tls-server-name.md`, `connection-cert-files-db-list-badge.md` and `connection-cert-files-env-scalar-plus-nested.md`. Checkpoint 11c deletes the three and re-renders `INDEX.md` with `atomic followups render`, so it lists none of them. It also holds none of `connection-cert-files-ci-live-tls.md`, `connection-cert-files-compiled-binary.md` and `connection-cert-files-mysql-cert-reason-regex.md`. `connection-cert-files-tui-screenshot.md` stays until the orchestrator regenerates the screenshot after the checkpoints.
- [ ] The TUI screen tests prove form mapping, field preservation, the config each site hands to its connection, and what each screen shows. The unreadable-path report on the connection test is proven at the factory level by a `testConnection` test, because the screens call that function.
- [ ] Unit-level proof for each server dialect asserts the built driver options (see Risks).
- [ ] CI writes the MySQL service container's public CA (`/var/lib/mysql/ca.pem`) to a file with `docker exec` before the integration tests, fails the step when the file holds no `-----BEGIN CERTIFICATE-----` line, and exports the path as `TEST_MYSQL_CA_FILE`. No private key leaves the container. `tests/integration/connection/mysql-tls.test.ts` is skipped when the variable is unset. Through `createConnection` it shows that `ssl: { caFile }` connects with a session cipher, that a `tlsServerName` equal to the server certificate's common name connects, that a wrong `tlsServerName` is rejected with the hostname hint, and that `ssl: true` with no CA is rejected with the hint naming `ssl.caFile`. It learns the common name from the mismatch error and names no server version. Its rejection cases pin the mysql2 message wordings that `MYSQL_CERTIFICATE_REASONS` matches.
- [ ] `tests/integration/connection/mssql-tls.test.ts` runs with the integration group and needs no file from the container. Through `createConnection` it shows that `ssl: { rejectUnauthorized: false }` connects with `encrypt_option` `TRUE` for the session, and that `ssl: true` with no CA is rejected with the hint naming `ssl.caFile`.
- [ ] `scripts/gen-test-tls.sh` (POSIX shell and `openssl`, OpenSSL or LibreSSL) writes into `tests/fixtures/tls/generated/`, which `.gitignore` lists: a CA certificate, one server certificate and key per dialect whose only subjectAltName is `db.noorm.test`, a client certificate and key whose common name is `noorm_tls`, and the certificate of a second, unrelated CA. Neither CA key stays on disk. The directory is mode `0700` and its files `0600`. A run that finds every file present changes nothing, and a run that finds some missing regenerates the whole set.
- [ ] `docker-compose.test.yml` holds `postgres-tls` (host port 15433), `mysql-tls` (13307) and `mssql-tls` (11435) under the `tls` profile, on the images of the plain services, each with a healthcheck. `TEST_POSTGRES_TLS_PORT`, `TEST_MYSQL_TLS_PORT` and `TEST_MSSQL_TLS_PORT` move a host port, and the tests read the same variables. Each start copies the mounted certificate files and gives the key to the server's own user at mode `0600`, and the host files keep their modes. PostgreSQL runs `ssl = on` with a `pg_hba.conf` whose only network line is `hostssl ... scram-sha-256 clientcert=verify-full`. MySQL runs `require_secure_transport = ON` with the fixture `ssl_ca`, `ssl_cert` and `ssl_key`, an account `noorm_tls` altered to `REQUIRE X509`, and an account `noorm_tls_password` that needs no certificate. SQL Server runs as the `mssql` user with an `mssql.conf` `[network]` section that sets `tlscert`, `tlskey` and `forceencryption = 1`. Every database is named `noorm_tls_test`.
- [ ] `tests/integration/connection/postgres-tls-enforced.test.ts`, `mysql-tls-enforced.test.ts` and `mssql-tls-enforced.test.ts` are skipped when `TEST_TLS_DIR` is unset. Each runs `SELECT` or `SHOW` statements only, destroys every connection, dials `localhost`, and asserts behavior and never certificate or key content. Through `createConnection` each shows that `ssl: { caFile }` with `tlsServerName: 'db.noorm.test'` connects encrypted (PostgreSQL `pg_stat_ssl` for the backend pid, with the client certificate's subject; MySQL `Ssl_cipher`; MSSQL `encrypt_option`), that the unrelated CA and `ssl: true` with no CA are rejected with the hint naming `ssl.caFile`, that a wrong `tlsServerName` is rejected with the hostname hint, that `ssl: { rejectUnauthorized: false }` connects encrypted, and that a missing `caFile` fails with `SslFileError` while a local listener standing in for the server accepts no socket. One case per file connects through the SDK `createContext` with certificate paths relative to a project root that is not the working directory.
- [ ] PostgreSQL and MSSQL reject `localhost` with the hostname hint when `tlsServerName` is unset. MySQL connects, because it checks the name only under `tlsServerName`.
- [ ] PostgreSQL and MySQL log in with `certFile` and `keyFile`. Without them PostgreSQL's refusal surfaces as `connection requires a valid client certificate`, and MySQL's as the access-denied hint.
- [ ] `ssl: false` is refused by PostgreSQL with the `pg_hba.conf` hint and by MySQL, for `noorm_tls_password`, with `The server only accepts TLS connections. Turn ssl on for this connection.` MSSQL connects with `encrypt_option` `TRUE`.
- [ ] The CI job that runs the integration tests generates the fixtures, starts the three services with `docker compose up -d --wait`, fails the step when one is not healthy, and exports `TEST_TLS_DIR`. The step sits after every step that finds a service container with `--filter ancestor=`, because the TLS containers share those images.
- [ ] `docs/dev/ci.md` says how to run the live TLS tests locally, the enforced suites included. `.claude/rules/testing.md` names the three services, their ports and `TEST_TLS_DIR`.
- [ ] `bun run lint`, `bun run typecheck`, `bun run lint:docs` and the five CI test groups pass. New test files do not use `mock.module`, with two exceptions. A new in-process TUI screen test in the CLI group may register the mocks of `src/core/index.js` and `src/core/identity/index.js` that spread the actual module, as `ConfigAddScreen.test.tsx` and `tests/cli/app-context.test.tsx` register them, and the connection-factory mock that `ConfigAddScreen.test.tsx` and `ConfigEditScreen.test.tsx` register, which replaces `testConnection`. `tests/cli/screens/config/ConfigImportScreen.test.tsx` may also register a mock of `src/core/identity/storage.js` that spreads the actual module and replaces `loadPrivateKey` only, because `ConfigImportScreen.tsx` imports `loadPrivateKey` from that module and `tests/cli/hooks/useVaultSecretKeys.test.tsx`, an earlier file in the group, replaces that export. No product import changes for it. Those replacements already hold for the rest of the process, and `AppContextProvider` takes its managers only from `getStateManager` and `getSettingsManager`. A test of a site that connects through `createConnection` (activation) adds no other mock: it proves which config was used by the stage's certificate path in the `SslFileError` message. The activation tests supply an identity with `setIdentityOverride` and clear it with `clearIdentityOverride` in `afterEach`. Their `src/core/identity/index.js` mock replaces `loadExistingIdentity` with `async () => getIdentityOverride()`, because that mock also replaces the export `src/core/identity/sync.ts` imports from `factory.js`, and a stand-in that resolved `null` would end the sync before it connects. A throwaway `HOME` cannot stand in for the override, because `src/core/identity/storage.ts` fixes `~/.noorm` at module load. Each new test file passes alone and in the group command. Tests added to an existing file inherit its mocks.


## Approach


Store the path, read the file at connect time in one connection-factory step. See [the design](../design/enterprise-connectivity.md).


## Change tree


```
src/core/config/
├── schema.ts ................... M  (SSLSchema: file fields, same-field exclusion; sslFilePath helper shared with settings)
├── ssl-combine.ts .............. A  (combineSsl: field-by-field ssl layer combination, rejectUnauthorized never inherited)
├── anchor.ts ................... A  (anchorSslFiles: relative file paths to project root, no I/O)
├── index.ts .................... M  (getEnvConfig: a scalar NOORM_CONNECTION_SSL beside a nested ssl variable fails with a ConfigValidationError)
└── resolver.ts ................. M  (mergeLayer combines ssl with combineSsl; pre-merge check of environment and inline ssl, including wrong-case keys; the effective config of a stored config, sharing the default, stage and stored merge with resolveConfig, with isTest trusted from the stored config only and undefined fields treated as absent)
src/core/settings/
├── types.ts .................... M  (StageDefaults.ssl: boolean or file-form object)
└── schema.ts ................... M  (StageDefaultsSchema.ssl: refuses inline PEM)
src/core/connection/
├── types.ts .................... M  (ConnectionConfig.ssl: file fields; SSL_FIELD_PAIRS; tlsServerName doc covers MySQL)
├── options.ts .................. M  (wrongCaseSslKeyMessage, ipTlsServerNameMessage)
├── index.ts .................... M  (exports SslFileError and isSslFileErrorMessage)
├── ssl-files.ts ................ A  (SslFileError, resolveSslFiles, isSslFileErrorMessage)
├── factory.ts .................. M  (openConnection: resolve files per attempt, no retry on SslFileError; testConnection keeps an SslFileError out of the missing-database fallback)
├── errors.ts ................... M  (SslFileError passes through; certificate hints name caFile and rejectUnauthorized)
└── dialects/
    ├── mysql.ts ................ M  (ssl passthrough, tlsServerName, stream function, identity rule)
    └── mssql.ts ................ M  (cryptoCredentialsDetails, one certificate-validation rule)
src/cli/config/sync.ts .......... M  (config sync combines ssl with combineSsl; preview prints [inline PEM])
src/sdk/
├── index.ts .................... M  (exports SslFileError)
├── context.ts .................. M  (Context constructor anchors ssl file paths to projectRoot after policy binding)
└── guards.ts ................... M  (bindSdkDestination anchors after policy binding)
src/tui/
├── app-context.tsx ........................... M  (activeConfig is the memoized effective config, policy bound on it)
├── utils/
│   ├── config-validation.ts .................. M  (buildConnectionConfig: SSL fields, Verify Certificate, untouched fields keep stored values, keeps existing connection fields; buildSslFields: effective state and stage placeholders on edit; validateSslForm: effective result)
│   └── index.ts .............................. M  (exports the SSL form helpers, connectionOverStage and skipsVerification)
├── components/
│   └── status/ConnectionStatus.tsx ........... M  (isDatabaseNotFoundError: false for an SslFileError message)
├── screens/config/
│   ├── ConfigAddScreen.tsx ................... M  (SSL fields, Verify Certificate, stage beneath the connection test and the submit check, no stage state shown)
│   ├── ConfigEditScreen.tsx .................. M  (SSL fields from the effective config, stage beneath the connection test, preserved connection fields)
│   ├── ConfigListScreen.tsx .................. M  (activation uses the effective config; TLS tag on the row)
│   ├── ConfigUseScreen.tsx ................... M  (activation uses the effective config)
│   ├── ConfigValidateScreen.tsx .............. M  (validates the effective config)
│   ├── ConfigExportScreen.tsx ................ M  (exports the stored connection without credentials)
│   └── ConfigImportScreen.tsx ................ M  (saves the parsed connection from the file; TLS lines in the preview)
├── screens/db/
│   ├── DbTransferScreen.tsx .................. M  (destination is the effective config)
│   └── SqlTerminalScreen.tsx ................. M  (the policy re-bind keeps the isTest bound on activeConfig)
└── screens/home.tsx .......................... M  (isDatabaseMissingError: false for an SslFileError message)
tests/core/config/
├── schema-ssl-files.test.ts .... A
├── env.test.ts ................. M
├── stage-materialization.test.ts M
├── resolver.test.ts ............ M
├── validate.test.ts ............ M
├── ssl-combine.test.ts ......... A
└── anchor.test.ts .............. A
tests/core/settings/schema.test.ts ............ M
tests/core/state/manager.test.ts .............. M
tests/core/connection/
├── ssl-files.test.ts ........... A
├── ssl-files-home.test.ts ...... A  (the ~/ rule under a throwaway HOME)
├── fixtures/ssl-home-child.ts .. A
├── factory.test.ts ............. M
├── errors.test.ts .............. M
└── dialects/
    ├── postgres.test.ts ........ A
    ├── mysql.test.ts ........... M
    └── mssql.test.ts ........... M
tests/integration/connection/
├── mysql-tls.test.ts ........... A  (live handshakes with the container's CA; skipped without TEST_MYSQL_CA_FILE)
├── mssql-tls.test.ts ........... A  (live encryption without validation, and the rejection hint)
├── postgres-tls-enforced.test.ts A  (live matrix against postgres-tls; skipped without TEST_TLS_DIR)
├── mysql-tls-enforced.test.ts .. A  (live matrix against mysql-tls; skipped without TEST_TLS_DIR)
└── mssql-tls-enforced.test.ts .. A  (live matrix against mssql-tls; skipped without TEST_TLS_DIR)
tests/utils/tls.ts .............. A  (fixture paths, one-query connections, the dial counter, the SDK round trip)
tests/fixtures/tls/
├── pg_hba.conf ................. A  (TLS and a client certificate on every network login)
├── mysql-accounts.sql .......... A  (REQUIRE X509 on noorm_tls; the password-only account)
└── mssql.conf .................. A  (tlscert, tlskey, forceencryption)
scripts/gen-test-tls.sh ......... A  (generates the fixture certificates)
docker-compose.test.yml ......... M  (postgres-tls, mysql-tls, mssql-tls under the tls profile)
.gitignore ...................... M  (tests/fixtures/tls/generated/)
.claude/rules/testing.md ........ M  (the TLS services, their ports, TEST_TLS_DIR)
.github/workflows/ci.yml ........ M  (exports the MySQL container's public CA as TEST_MYSQL_CA_FILE; starts the TLS services and exports TEST_TLS_DIR)
tests/cli/config/
├── export.test.ts .............. M
├── import.test.ts .............. M
└── stage-commands.test.ts ...... M  (config sync)
tests/sdk/
├── inline-connection.test.ts ... M
├── context-ssl-anchor.test.ts .. A
└── bundle-smoke.test.ts ........ M
tests/cli/screens/config/
├── ConfigAddScreen.test.tsx .... M
├── ConfigEditScreen.test.tsx ... M
├── ConfigListScreen.test.tsx ... A
├── ConfigUseScreen.test.tsx .... A
├── ConfigValidateScreen.test.tsx A
├── ConfigExportScreen.test.tsx . A
└── ConfigImportScreen.test.tsx . A
tests/cli/screens/db/
├── DbTransferScreen.test.tsx ... M
├── sql-policy-rebind.test.tsx .. A
└── DbListScreen.test.tsx ....... A
tests/cli/screens/home.test.tsx ............... A
tests/cli/components/
└── status.test.tsx ............. M
tests/cli/app-context.test.tsx ................ M
tests/cli/utils/config-validation.test.ts ..... A
docs/
├── dev/config.md ............... M
├── dev/ci.md ................... M  (running the live TLS tests locally)
├── dev/datamodel.md ............ M
├── dev/config-sharing.md ....... M
├── dev/sdk.md .................. M
├── guide/environments/configs.md M
├── guide/environments/stages.md  M
├── guide/troubleshooting.md .... M
├── guide/deployment.md ......... M
├── headless.md ................. M
├── tui.md ...................... M
├── reference/sdk.md ............ M
├── design/enterprise-connectivity.md  A  (design; checkpoint 11c keeps its TUI section current)
└── spec/connection-cert-files.md ..... A  (this file)
skills/noorm/references/
├── config.md ................... M
├── sdk.md ...................... M
└── cli.md ...................... M
.changeset/connection-cert-files.md  A
.claude/project/followups/
├── connection-cert-files-tui-export-tls-server-name.md  D  (in checkpoint 11c)
├── connection-cert-files-db-list-badge.md ............. D  (in checkpoint 11c)
├── connection-cert-files-env-scalar-plus-nested.md .... D  (in checkpoint 11c)
├── connection-cert-files-ci-live-tls.md ............... D  (in checkpoint 12)
├── connection-cert-files-compiled-binary.md ........... D  (in checkpoint 12)
├── connection-cert-files-mysql-cert-reason-regex.md ... D  (in checkpoint 12)
├── connection-cert-files-tui-screenshot.md ............ D  (by the orchestrator after the checkpoints, once the screenshot is regenerated; in no checkpoint)
└── INDEX.md ........................................... M  (re-rendered in checkpoint 11c)
```


## Outline


```
src/core/config/schema.ts
  SSLSchema — adds caFile, certFile, keyFile; refinement names the field when inline and file form of one field are both set; not exported
  sslFilePath — the optional non-blank file path schema, shared with the stage defaults schema; the message prefix is a parameter

src/core/config/ssl-combine.ts
  combineSsl — returns the ssl a higher and a lower layer produce together; rejectUnauthorized is never inherited and appears only when the higher layer is an object that sets it: no ssl in the higher layer leaves the lower value whole, false turns off, true over an object keeps the lower certificate fields without its rejectUnauthorized (true when none remain), an object over an object combines per field with the higher layer's inline or file form replacing the lower layer's form of that field, an object over true, false or nothing is that object

src/core/config/anchor.ts
  anchorSslFiles — returns a connection whose relative ssl file paths are joined to a project root; absolute paths, ~/ paths and non-file ssl untouched

src/core/config/resolver.ts
  mergeLayer — sets the merged connection.ssl to combineSsl of the lower and higher layer after the deep merge
  assertSslLayer — rejects an environment or inline ssl key spelled in another letter case, naming the camelCase spelling, then checks the layer against the schema
  resolveConfig — calls assertSslLayer on the environment and inline layers before merging, on the stored-config path and in resolveFromEnvOnly; returns ssl file paths as written; takes its default, stage and stored layers from the shared merge
  effectiveConfig — returns a stored config merged over the defaults and the defaults of the stage found by findStageForConfig, through stageFields and mergeLayer; returns the config with its policy context already bound, so a site uses the result and binds nothing itself; reads no environment variable and takes no flags; accepts a connection built from a form in place of the stored one, for the add and edit connection tests; never mutates its inputs
    stage fields — type, isTest and access merge beneath the stored config, as in resolveConfig; access roles never come from NOORM_ACCESS_USER or NOORM_ACCESS_AGENT
    trusted isTest — the bound policy context isTest is true only when the stored config's own isTest is true, in both role-validation modes; the merged isTest field is never its source
    undefined rule — a stored or form connection field whose value is undefined counts as absent, so the stage value beneath it stays
    role validation — the caller chooses whether roles are validated
  revalidateConfigPolicy — re-binds a bound config with roles validated and keeps its bound isTest trust; the SQL terminal re-bind calls it

src/core/config/index.ts
  getEnvConfig — throws a ConfigValidationError for field connection.ssl when NOORM_CONNECTION_SSL is a scalar and a nested ssl variable is set; the message names both variables and says a scalar NOORM_CONNECTION_SSL cannot be combined with a nested NOORM_CONNECTION_SSL_* variable: set one form, not both

src/core/settings/types.ts
  StageDefaults.ssl — boolean or { caFile, certFile, keyFile, rejectUnauthorized }

src/core/settings/schema.ts
  StageSslSchema — strict object without ca, cert, key
  StageDefaultsSchema.ssl — boolean or StageSslSchema

src/cli/config/sync.ts
  stage sync update — sets the updated connection.ssl to combineSsl with the stage ssl as the higher layer, matching the stage-wins spread for other fields
  redactInlinePem — prints [inline PEM] for an inline ca, cert or key in the preview changes, in text and JSON

src/core/connection/types.ts
  ConnectionConfig.ssl — adds the three file fields
  SSL_FIELD_PAIRS — each certificate field as its inline and file form; the one list the config, settings, anchor, combine, resolve and TUI code read

src/core/connection/options.ts
  wrongCaseSslKeyMessage — names the camelCase ssl key when a key differs only in letter case; shares its wording with unknownPoolKeyMessage
  ipTlsServerNameMessage — the refusal of an IP address as tlsServerName, shared by MySQL and MSSQL

src/core/connection/index.ts
  SslFileError export
  isSslFileErrorMessage export

src/core/connection/ssl-files.ts
  SslFileError — field, path, code; message never holds content
  isSslFileErrorMessage — true for a message string that messageFor produced for any code, with or without the prefix "Connection failed: "; defined beside messageFor so the message shapes and the predicate change together
  resolveSslFiles — returns a new connection with each file field read into its inline field, relative to the working directory, with a leading ~/ expanded to the home directory; never mutates its input; returns a SQLite connection unchanged; refuses with EINVAL (not a regular file), EMPTY, EFBIG (over 1 MiB, checked before the read) and ENOTPEM

src/sdk/index.ts
  SslFileError export — re-exported beside DatabaseConnectionError

src/sdk/context.ts
  Context constructor — anchors the config's ssl file paths to projectRoot after bindSdkPolicy, whether or not the config has access

src/sdk/guards.ts
  bindSdkDestination — anchors the destination's ssl file paths to the context's projectRoot after binding

src/core/connection/factory.ts
  openConnection — calls resolveSslFiles per attempt, before the dialect factory; emits an SslFileError message unmasked under a runtime.password callback
    shouldRetry — returns false for SslFileError
  testConnection — does not treat an SslFileError as a missing target database

src/core/connection/errors.ts
  explainConnectionError — returns SslFileError unchanged, so the event carries no serverCode for it
  explainTransport — certificate hint names ssl.caFile and ssl.rejectUnauthorized false on every dialect, with the tlsServerName caveat for PostgreSQL and MySQL; a hostname mismatch gets a hint naming tlsServerName

src/core/connection/dialects/mysql.ts
  resolveMysqlSsl — ssl object from ca, cert, key, rejectUnauthorized; identity rule for tlsServerName; refuses an IP address as the name
  buildMysqlOptions — host becomes tlsServerName, adds stream and verifyIdentity when the name is set
  dialMysqlStream — net socket to the real host and port with no-delay, and keepalive from mysql2's resolved config

src/core/connection/dialects/mssql.ts
  buildTediousOptions — adds cryptoCredentialsDetails; trustServerCertificate follows the validation rule
  resolveTlsServerName — validatingCertificate is ssl truthy and rejectUnauthorized not false

src/tui/app-context.tsx
  readActiveConfig — reads the stored active config, as the source of the effective one; reports malformed access without throwing
  policyActiveConfig — the effective config of the active stored config with policy bound on it and roles not validated, memoized on the stored config and the settings; the context exposes it as activeConfig

src/tui/screens/db/SqlTerminalScreen.tsx
  handleExecute — re-binds activeConfig with roles validated; isTest comes from the policy context the effective-config function bound on activeConfig, never from activeConfig.isTest
  confirmQuery — the same re-bind, so the fingerprint it checks matches the one handleExecute minted

src/tui/utils/config-validation.ts
  SSL_FILE_FIELDS — SSL_FIELD_PAIRS with each field's form key
  skipsVerification — true for an ssl object whose rejectUnauthorized is false; the one predicate the forms, the config list tag and the import preview use
  connectionOverStage — the form connection over the defaults of the stage named in the form, through effectiveConfig with roles not validated, as an error tuple; fails with Settings are not available when there is no settings manager, so no connection test runs on an unmerged connection
  buildSslFields — the six SSL field definitions for both screens; the edit form passes the stored connection and the effective one, the add form passes neither
    Use SSL — checked when the effective ssl is on; unchecked on the add form
    Verify Certificate — unchecked when the effective rejectUnauthorized is false; checked on the add form
    file fields — the stored path as the value; the placeholder (stage: <path>) when only the stage supplies the field, (inline certificate stored) when the stored form is inline PEM; no placeholder on the add form
  buildConnectionConfig — maps SSL form values, trimmed; starts from the existing connection when given; drops a stored SQLite filename
    port rule — an empty Port field keeps the stored port on edit, absent included; the add form stores the dialect default
    untouched rule — keeps the stored ssl when no SSL checkbox or file field changed, and the stored tlsServerName when its field did not change; a change to Verify Certificate alone under an unchecked, unchanged Use SSL counts as untouched
    Use SSL mapping — unchecked after a change stores false; checked stores an object of the remaining fields, or true when none remain
    Verify Certificate mapping — unchecked with Use SSL checked stores rejectUnauthorized false, also when the stage supplied the false and another SSL field changed; checked removes it, and stores true over a stage that supplied the false
  validateSslForm — returns an error message when the effective result of the save contradicts itself, else none; Form field validators see only their own value, so the screens call it at submit
    TLS server name rule — for PostgreSQL or MySQL, a name fails when the effective ssl would be off or the effective rejectUnauthorized would be false; passes for MSSQL
    certificate path rule — a file path fails when the effective ssl would be off: any path on add, a path entered or changed on edit

src/tui/screens/config/ConfigAddScreen.tsx
  matchedStage — supplies the default access only
  fields — Use SSL (unchecked), Verify Certificate (checked), CA file, client certificate file, client key file, TLS server name; no stage state
  submit — calls validateSslForm with the defaults of the stage that matches the name in the form and shows its message through setConnectionError, the way the screen shows a save or connection error
  connection test — tests the form connection over the stage that matches the name in the form
  save — stores the connection built from the form alone, the path as typed

src/tui/screens/config/ConfigEditScreen.tsx
  fields — the same six, built from the stored config and its effective config
  submit — calls validateSslForm with the stage defaults and shows its message through setConnectionError
  connection test — tests the form connection over the stage that matches the name in the form
  save — passes the stored connection so unseen fields survive; an emptied path field removes the stored path and an empty field over inline PEM keeps it

src/tui/screens/config/ConfigListScreen.tsx
  items — adds the TLS tag (tls or tls unverified) from each config's effective config, built with roles validated; the row of a stored config with an unknown access role renders without the tag
  handleSelect — syncs identity with the effective config of the selected name, as the core function returns it with roles validated; shows a validation error as a toast

src/tui/screens/config/ConfigUseScreen.tsx
  switchConfig — syncs identity with the effective config of the named config, as the core function returns it with roles validated; shows a validation error

src/tui/screens/config/ConfigValidateScreen.tsx
  validate — passes the effective config of the named config to validateConfigChecks; validates no roles

src/tui/screens/config/ConfigExportScreen.tsx
  exported connection — the stored connection with user, password, ssl.key and ssl.cert removed; an ssl object left empty becomes true

src/tui/screens/config/ConfigImportScreen.tsx
  imported config — the result of one parseConfig call over the form's name, the file's type, isTest, access and connection, with user and password from the form; an unknown key in the file is not saved
  preview — adds SSL, certificate verification, certificate file paths and TLS server name lines, and the note that a path must exist on this machine; reads a null ssl as off and a missing secrets key as none

src/tui/screens/db/DbTransferScreen.tsx
  destination load — uses the effective config of the destination name, as the core function returns it with roles not validated, for the permission check, the plan and the transfer

src/tui/screens/home.tsx
  isDatabaseMissingError — calls isSslFileErrorMessage first and returns false when it is true, whatever the path contains

src/tui/components/status/ConnectionStatus.tsx
  isDatabaseNotFoundError — calls isSslFileErrorMessage first and returns false when it is true, whatever the path contains; DbListScreen picks its badge with this function and needs no edit

tests/core/config/schema-ssl-files.test.ts
  file fields accepted by full and partial schema
  an empty-string file path is rejected with the field named
  inline plus file form of one field is rejected with the field named

tests/core/config/env.test.ts
  NOORM_CONNECTION_SSL_caFile nests as ssl.caFile
  NOORM_CONNECTION_SSL=true with NOORM_CONNECTION_SSL_caFile throws a ConfigValidationError for connection.ssl whose message names both variables and says to set one form, not both
  NOORM_CONNECTION_SSL=false with NOORM_CONNECTION_SSL_caFile throws the same error, and its message does not say that a nested variable enables SSL
  a scalar beside a nested variable under another key keeps the parser's own error

tests/core/config/stage-materialization.test.ts
  object ssl in stage defaults reaches the materialized connection

tests/core/config/ssl-combine.test.ts
  false over anything is false
  true over nothing, false or true is true
  true over an object keeps the certificate fields and drops the lower rejectUnauthorized
  true over an object holding nothing but rejectUnauthorized is true
  an object over an object replaces each of ca, cert and key by the higher layer's form, inline or file
  an object over an object takes rejectUnauthorized from the higher object only
  an object over nothing, true or false is that object
  an undefined higher layer leaves the lower layer whole, rejectUnauthorized included
  neither argument is mutated
  after combining valid layers, no inline and file pair of one field remains

tests/core/config/anchor.test.ts
  relative path joins to the project root
  absolute path unchanged
  a ~/ path is unchanged

tests/core/config/resolver.test.ts
  stored ssl true over stage { caFile } keeps caFile
  stored inline ca over stage caFile resolves to the inline ca only
  NOORM_CONNECTION_SSL_caFile over stored inline ca resolves to caFile only
  a stage rejectUnauthorized false does not reach a stored ssl true or a stored { caFile }, and applies to a stored config with no ssl
  a stored rejectUnauthorized false does not survive NOORM_CONNECTION_SSL=true or SDK inline ssl true; a stored { ca, rejectUnauthorized false } under env true resolves to { ca }
  NOORM_CONNECTION_SSL_CAFILE and NOORM_CONNECTION_SSL_REJECTUNAUTHORIZED fail naming the camelCase key; an inline { cafile } or { Ca } fails; the correct spelling passes
  an SDK inline ssl undefined keeps the stored ssl
  stored ssl false over a stage object is off
  environment ca with caFile fails naming ssl.ca
  SDK inline ca with caFile fails naming ssl.ca
  environment ca with caFile under an SDK inline ssl { caFile } fails naming ssl.ca, on the stored-config path and the env-only path
  stored and env-only resolution return ssl file paths as written, for a project root that differs from the working directory
  the bound target identity equals policyTargetIdentity of the connection with the path as written
  the effective config of a stored config with no ssl under a stage { caFile } holds that caFile, and a stage password reaches a stored config without one
  the effective connection equals the resolveConfig connection for the same name when no NOORM_ variable is set
  NOORM_CONNECTION_HOST does not change the effective config
  with NOORM_ACCESS_USER=admin set, the effective config's access roles equal the stored roles
  the effective config's bound target identity equals policyTargetIdentity of the effective connection
  building the effective config mutates neither the stored config nor the stage defaults
  a form connection passed in place of the stored one sits over the stage defaults
  the effective config takes type, isTest and access from the stage where the stored config lacks them
  a stored config without isTest under a stage isTest true has a policy context with isTest false, with roles validated and not validated; a stored isTest true keeps it true
  getPolicyFingerprint of the effective config equals getPolicyFingerprint of the resolveConfig result for the same name when no NOORM_ variable is set
  a stored connection with user and password keys set to undefined takes the stage user and password
  a form connection with user and password keys set to undefined takes the stage user and password
  an unknown role throws when roles are validated and binds when they are not

tests/cli/app-context.test.tsx
  activeConfig holds a stage caFile the stored config lacks
  activeConfig keeps its identity across provider re-renders and changes when the stored config or the settings change
  the policy fingerprint of activeConfig equals the fingerprint of the effective config bound outside the provider
  activeConfig for a stored config without isTest under a stage isTest true has a policy context with isTest false
  activeConfig for a stored config with an unknown role is still exposed
  (9a) a stored pool.min above the default pool.max, and a stored database name the schema refuses, each leave the app ready with activeConfig null, the name kept and the message in activeConfigAccessError

tests/cli/screens/db/sql-policy-rebind.test.tsx
  with a stored config without isTest under a stage isTest true, a statement the role is denied stays denied after the re-bind, so the re-bind keeps isTest false

tests/core/config/validate.test.ts
  validateConfigChecks reports the SslFileError message for an unreadable path

tests/core/settings/schema.test.ts
  stage ssl accepts boolean and file form; inline ca is refused

tests/core/state/manager.test.ts
  a config saved with the file form and reloaded holds paths and no PEM

tests/core/connection/ssl-files.test.ts
  reads files into PEM text
  a SQLite config comes back unchanged
  a file over 1 MiB fails with EFBIG before it is read; a file of exactly 1 MiB passes the size check
  missing file throws SslFileError with field and path, not content
  a file with no PEM block fails with code ENOTPEM and none of its content in the message
  a rotated file is read again on the next call
  a keyFile that is not PEM leaves its content out of the thrown error
  isSslFileErrorMessage is true for the message of an SslFileError built with each code (a system code, EINVAL, EMPTY, EFBIG, ENOTPEM), with and without the prefix "Connection failed: "
  isSslFileErrorMessage is false for the PostgreSQL, MySQL and MSSQL missing-database messages

tests/core/connection/ssl-files-home.test.ts
  a leading ~/ resolves under the home directory, run in a child process with a throwaway HOME

tests/core/connection/factory.test.ts
  SslFileError is not retried, counts one attempt, and reaches connection:error without a serverCode
  with a runtime.password callback the connection:error message is the SslFileError message, unmasked
  a keyFile that is not PEM leaves its content out of the connection:error event
  testConnection reports the SslFileError message for an unreadable path
  createConnection rethrows SslFileError as the same type
  the config passed in still holds paths and no PEM after a connect, with PEM-shaped content so the connect reaches the dial

tests/core/connection/errors.test.ts
  SslFileError passes through explainConnectionError unchanged
  certificate hints name ssl.caFile and ssl.rejectUnauthorized false on every dialect
  with tlsServerName set on PostgreSQL or MySQL the hint says to remove tlsServerName too; on MSSQL it does not
  a hostname mismatch gets the hint naming tlsServerName and no certificate-authority advice
  a mysql2 self-signed server certificate maps to DEPTH_ZERO_SELF_SIGNED_CERT and a self-signed chain to SELF_SIGNED_CERT_IN_CHAIN
  a mysql2 HANDSHAKE_SSL_ERROR for a rejected certificate gets the certificate hint; a HANDSHAKE_SSL_ERROR for another reason does not

tests/core/connection/dialects/postgres.test.ts
  resolveSslFiles output passed to buildPostgresPoolOptions carries ca, cert and key in the pg ssl object with and without tlsServerName
  file fields never reach pg

tests/core/connection/dialects/mysql.test.ts
  ssl keys reach mysql2
  tlsServerName sets host, verifyIdentity and a stream; a local net server receives the dial to the real host and port
  the client socket the built stream function returns, called the way mysql2 calls it, has no-delay and keepalive with the configured initial delay
  keepalive is on when no keepalive option is set, off for enableKeepAlive false, and follows a driver override
  an IP address as tlsServerName throws naming the field
  tlsServerName without ssl throws "MySQL TLS identity options require ssl to be enabled explicitly"
  tlsServerName with rejectUnauthorized false throws "MySQL TLS identity options require certificate verification"
  verifyIdentity is unset when tlsServerName is absent

tests/core/connection/dialects/mssql.test.ts
  PEM reaches cryptoCredentialsDetails
  rejectUnauthorized false sets trustServerCertificate
  an IP host with ssl rejectUnauthorized false and no tlsServerName does not throw

tests/integration/connection/mysql-tls.test.ts
  ssl { caFile } connects and the session reports a cipher
  a wrong tlsServerName is rejected with the hostname hint
  tlsServerName equal to the certificate's common name connects
  ssl true with no CA is rejected with the hint naming ssl.caFile

tests/integration/connection/mssql-tls.test.ts
  ssl { rejectUnauthorized false } connects and the session is encrypted
  ssl true with no CA is rejected with the hint naming ssl.caFile

.github/workflows/ci.yml
  Export the MySQL server CA for the live TLS test — writes the container's public CA to a file, fails without a certificate line, exports TEST_MYSQL_CA_FILE
  Start the TLS-enforcing databases — generates the fixtures, starts the three services and waits for healthy, exports TEST_TLS_DIR

scripts/gen-test-tls.sh
  authority — a self-signed CA certificate
  signed — a key and a certificate signed by the fixture CA, with the server or client extensions

docker-compose.test.yml
  postgres-tls — ssl on, the fixture certificate, pg_hba.conf from tests/fixtures/tls
  mysql-tls — require_secure_transport, the fixture certificate, accounts from mysql-accounts.sql
  mssql-tls — mssql.conf from tests/fixtures/tls, creates noorm_tls_test, runs the server as mssql

tests/utils/tls.ts
  TLS_DIR — the fixture directory from TEST_TLS_DIR, undefined when the suites skip
  TLS_SERVER_NAME — the name the server certificates are issued for
  tlsFile — a fixture path, absolute or relative to a project root
  tlsPort — a service port from its variable or the default
  rowsOver — rows of one query over a connection opened and destroyed for it
  rejection — the error a connection attempt fails with
  rejectionBeforeDial — the error, and the sockets a local listener accepted
  rowsThroughSdk — rows of one query through createContext under a throwaway project root

tests/integration/connection/postgres-tls-enforced.test.ts
tests/integration/connection/mysql-tls-enforced.test.ts
tests/integration/connection/mssql-tls-enforced.test.ts
  caFile, tlsServerName and the client certificate connect encrypted
  the same through the SDK with paths relative to the project root
  the unrelated CA is rejected with the hint naming ssl.caFile
  ssl true with no CA is rejected with the same hint
  localhost with no tlsServerName: the hostname hint (PostgreSQL, MSSQL), a connection (MySQL)
  a wrong tlsServerName is rejected with the hostname hint
  no client certificate is refused by the server (PostgreSQL, MySQL)
  rejectUnauthorized false connects encrypted
  ssl false is refused (PostgreSQL, MySQL) or connects encrypted (MSSQL)
  a missing caFile fails with SslFileError and no socket is opened

docs/dev/ci.md
  Live TLS Tests — how to run the live TLS tests locally, the enforced suites included

.claude/rules/testing.md
  TLS-enforcing services — the three services, their ports, TEST_TLS_DIR

tests/cli/config/export.test.ts
  export of a file-form config prints paths and no PEM

tests/cli/config/import.test.ts
  config import accepts a config whose caFile does not exist (parseConfig)

tests/cli/config/stage-commands.test.ts
  config sync keeps the stored certFile and keyFile when the stage ssl is { caFile }
  config sync with a stage ssl true over a stored { rejectUnauthorized false, caFile } stores { caFile }
  config sync never prints a stored inline key, cert or ca in the text or JSON preview

tests/sdk/inline-connection.test.ts
  a rejected connect() for an unreadable caFile is an instance of SslFileError imported from the SDK entry point

tests/sdk/bundle-smoke.test.ts
  the built bundle exports SslFileError

tests/sdk/context-ssl-anchor.test.ts
  a stored config and a config: false context hold ssl file paths anchored to a projectRoot that differs from the working directory
  the context's policy fingerprint equals the fingerprint of the same config bound with the path as written
  a connect() reads the file under projectRoot, not under the working directory
  a transfer destination bound by bindSdkDestination holds anchored paths
  ~/ and absolute paths are left as written

tests/cli/screens/config/ConfigAddScreen.test.tsx
  SSL fields render and save
  a TLS server name with Use SSL unchecked for PostgreSQL and no matching stage shows the form error message and saves nothing
  untouched SSL fields store no ssl key
  (9a) with a typed name that matches a stage ssl { caFile } and untouched SSL fields, testConnection receives the caFile and the saved config has no ssl key
  (9a) with a blank user and password under a stage password, testConnection receives the stage password
  (10a) Verify Certificate renders checked; unchecking it with Use SSL checked saves rejectUnauthorized false
  (10a) with a typed name that matches a stage ssl { caFile }, Use SSL stays unchecked and no field shows a stage placeholder
  (10a) a TLS server name over a stage that supplies ssl, with Use SSL untouched, saves

tests/cli/screens/config/ConfigEditScreen.test.tsx
  SSL fields render with stored values and save
  edit keeps pool, inline PEM and timeouts
  a path replaces inline PEM of the same field only
  unchecking Use SSL on a config with a stored truthy ssl stores ssl false
  a TLS server name with Use SSL unchecked on a config with no stored ssl and no stage ssl shows the form error message and saves nothing
  a config with no stored ssl and no stage ssl, saved untouched, has no ssl key
  (9a) a config with no stored ssl under a stage ssl { caFile }, saved untouched, keeps ssl absent, and testConnection receives the stage caFile
  (10a) that config shows Use SSL checked and the placeholder (stage: <path>)
  (10a) unchecking Use SSL on that config stores ssl false
  (10a) unchecking Verify Certificate stores rejectUnauthorized false; checking it again removes it
  (10a) a stored ssl false under a stage ssl { caFile } shows Use SSL unchecked and no stage placeholder; checking Use SSL stores true
  a SQLite config shows none of the six SSL fields

tests/cli/screens/config/ConfigListScreen.test.tsx
  (9b) activating a config with no stored ssl under a stage ssl { caFile: <missing file> } emits an identity:sync:connection error whose SslFileError message holds the stage path
  (9b) activating a config with an unknown role shows the validation error
  (9b) activating a stored SQLite :memory: config with role viewer and no isTest, under a stage isTest true, emits no identity:synced event, so the sync was handed no trusted-test grant
  (9b) activating the same config with a stored isTest true emits identity:synced
  (10b) a row shows tls for an effective ssl, tls unverified for an effective rejectUnauthorized false, and no TLS tag when ssl is off
  (10b) a stored config with no ssl under a stage that supplies ssl shows tls
  (10b) a SQLite row shows no TLS tag
  (10b) the row of a stored config with an unknown access role renders without a TLS tag

tests/cli/screens/config/ConfigUseScreen.test.tsx
  switching to a config with no stored ssl under a stage ssl { caFile: <missing file> } emits an identity:sync:connection error whose SslFileError message holds the stage path
  switching to a config with an unknown role shows the validation error
  switching to a stored SQLite :memory: config with role viewer and no isTest, under a stage isTest true, emits no identity:synced event, so the sync was handed no trusted-test grant
  switching to the same config with a stored isTest true emits one identity:synced event

tests/cli/screens/config/ConfigValidateScreen.test.tsx
  validating a config with no stored ssl under a stage ssl { caFile } hands testConnection a connection that carries the caFile

tests/cli/screens/db/DbTransferScreen.test.tsx
  the destination handed to the plan and the transfer carries a stage caFile the stored destination lacks
  the destination permission check and the transfer use the same bound object
  a destination with an unknown role still loads
  a stored destination without isTest under a stage isTest true, with a role denied db:reset, stays refused

tests/cli/screens/config/ConfigExportScreen.test.tsx
  the decrypted payloads of two configs, one with inline ssl ca, cert and key and one with caFile, certFile and keyFile, carry every non-credential connection field between them
  user, password, ssl.key and ssl.cert are absent from both payloads; ssl.ca, rejectUnauthorized and the three file paths are present
  an ssl of { key, cert } exports as true
  a stage value the stored config lacks is absent from the payload

tests/cli/screens/config/ConfigImportScreen.test.tsx
  an import saves tlsServerName, pool, the timeouts, applicationName, the keepalive fields and the ssl object from the file
  user and password come from the form, not the file
  an unknown connection key in the file is absent from the saved config
  a file holding dialect, host, port, database and ssl only imports
  the preview shows SSL, certificate verification, each file path and the TLS server name, and the note that a path must exist on this machine
  a file with an invalid type shows the error and setConfig is not called
  the preview renders for a file whose ssl is null, and for a file with no secrets key

tests/cli/screens/home.test.tsx
  an SslFileError message for a path under "does not exist" shows the error state and the message, not the database-missing state
  a missing-database server message shows the database-missing state

tests/cli/screens/db/DbListScreen.test.tsx
  an SslFileError message for a path under "does not exist" shows ERROR and the message, not NOT CREATED

tests/cli/components/status.test.tsx
  isDatabaseNotFoundError is false for an SslFileError message whose path holds "does not exist" or "unknown database"
  isDatabaseNotFoundError stays true for the PostgreSQL, MySQL and MSSQL missing-database messages

tests/cli/utils/config-validation.test.ts
  buildConnectionConfig maps SSL values and keeps existing connection fields
  an edit that leaves the Port field empty keeps an absent stored port absent; the add form stores the dialect default
  checking Use SSL with no path or inline PEM stores ssl true
  untouched SSL fields leave a stored ssl and tlsServerName as they were, absent included, under a stage that supplies ssl
  an unchanged tlsServerName field keeps the stored value when another SSL field changed
  a whitespace-only difference in a field and a checkbox returned to its initial state count as untouched
  a change to Verify Certificate alone, with Use SSL unchecked and unchanged, counts as untouched: an absent ssl stays absent and a stored ssl false stays false
  unchecking Use SSL stores false, from a stored truthy ssl and from a stage-supplied one
  checking Use SSL over a stored false or absent ssl stores true
  unchecking Verify Certificate with Use SSL checked stores rejectUnauthorized false; with Use SSL unchecked it stores nothing
  checking Verify Certificate removes a stored rejectUnauthorized false, and stores true when the stage supplied the false
  with a stage rejectUnauthorized false and no stored ssl, an entered CA path with Verify Certificate left unchecked stores { caFile, rejectUnauthorized false }
  an emptied field whose stored form is a path removes that path
  an empty field whose stored form is inline PEM keeps the PEM
  an empty field under a stage placeholder stores nothing
  an entered path replaces either form
  buildSslFields checks Use SSL for a stage-supplied ssl and unchecks Verify Certificate for an effective rejectUnauthorized false
  a file field supplied only by the stage is empty with the placeholder (stage: <path>)
  buildSslFields with no connection, as the add form calls it, leaves Use SSL unchecked, Verify Certificate checked and no stage placeholder
  a stored ssl false over a stage { caFile } leaves Use SSL unchecked with no stage placeholder
  validateSslForm fails a TLS server name for PostgreSQL and MySQL when the effective ssl is off, and when the effective rejectUnauthorized is false; passes for MSSQL
  validateSslForm passes a TLS server name when the stage supplies ssl beneath an untouched Use SSL
  validateSslForm fails a certificate path when the effective ssl is off on add, and an entered or changed path on edit; an untouched stored path with Use SSL unchecked passes
  a stored ssl false stays false untouched, becomes true checked, and fails a TLS server name
  typed paths and the TLS server name are trimmed
  an inline-PEM field carries the placeholder (inline certificate stored)
  editing a SQLite config drops a stored filename

docs/dev/config.md
  connection.ssl — file fields, relative-path and ~/ rule, environment variables, layer combination

docs/design/enterprise-connectivity.md
  TUI section — a table of the six form fields, Verify Certificate included, and two or three sentences: the TUI connects with the stored config over its stage defaults, the edit form shows the effective state, the config list shows a TLS tag, the TUI export carries every non-credential field and withholds the inline key and client certificate

docs/dev/datamodel.md
  connection entity — ssl file fields
  shared config payload — config.connection holds every connection field except user, password, ssl.key and ssl.cert

docs/dev/config-sharing.md
  export and import — paths travel and files do not; import does not check existence
  what the TUI export carries and withholds — every connection field travels except user, password and the inline ssl.key and ssl.cert; tlsServerName travels; an older export file imports

docs/dev/sdk.md
  InlineConnection.ssl — file fields; a relative path resolves from projectRoot, ~/ expands to the home directory

docs/guide/environments/configs.md
  SSL section — file fields, tlsServerName on all three dialects
  TUI form fields — Verify Certificate, the stage placeholder, the TLS tag in the config list
  export table — what the TUI export carries and withholds

docs/guide/environments/stages.md
  stage defaults — ssl boolean or file-form object, no inline PEM
  where stage defaults apply — the CLI, SDK and TUI all apply them beneath the stored config at connect; the TUI applies no environment override

docs/reference/sdk.md
  ssl option — file fields, projectRoot anchoring, SslFileError conditions, the never-inherited rejectUnauthorized rule, driver-order table

docs/guide/troubleshooting.md
  certificate rows — the non-PEM and EFBIG SslFileError cases

docs/guide/deployment.md
  RDS example and row — the CA bundle named by caFile and read each time a pool opens, on every connect attempt

docs/headless.md
  config export and import — file-form paths export as paths, inline PEM exports as stored; import does not check that a file exists

docs/tui.md
  SSL fields — the six fields, the two placeholders on the edit form, the add form showing no stage state, the untouched-fields rule, the certificate-path rule and the TLS server name rule, which judge the effective result of the save
  stage defaults — the TUI connects with stage defaults beneath the stored config
  config list — the tls and tls unverified tags
  export and import — what travels, what is withheld, the TLS lines in the import preview

skills/noorm/references/config.md
  ssl file fields, environment variables, stage ssl shape, layer combination
  TUI behavior — stage defaults beneath the stored config, Verify Certificate, the TLS tag, what the TUI export carries and withholds

skills/noorm/references/sdk.md
  InlineConnection ssl file fields

skills/noorm/references/cli.md
  config export and import behavior with file paths

.changeset/connection-cert-files.md
  minor bump for @noormdev/cli and @noormdev/sdk; lists the behavior changes for MSSQL, MySQL and layer combination
  TUI behavior change — the TUI connects with stage defaults beneath the stored config; Verify Certificate; the TLS tag; what the TUI export carries and withholds
  environment error — a scalar NOORM_CONNECTION_SSL beside a nested ssl variable fails with a message that says to set one form, not both

.claude/project/followups/INDEX.md
  index — re-rendered with atomic followups render in checkpoint 11c, after the three entries it closes are deleted
```


## Flows


**Flow: connect with file certificates**

1. The config stores `ssl: { caFile: ./certs/corp-ca.pem }` and `tlsServerName: db.internal.corp`.
2. The CLI and TUI hold a working directory equal to the project root, so the relative path names a file under the project root there. In the SDK, the `Context` constructor binds policy on the path as written, then joins the relative path to `projectRoot` in its in-memory config. The stored value is unchanged.
3. `createConnection` calls `openConnection`. Each attempt calls `resolveSslFiles`, which reads `caFile` and returns `ssl` with `ca` as PEM text and no file fields.
4. The dialect factory receives that config and passes the PEM to its driver. No dialect reads the file system.
5. The pool opens. The next pool open reads the file again, so a rotated certificate takes effect without a config change.

**Flow: combine ssl across layers**

1. `resolveConfig` checks the environment and inline `ssl` layers with `assertSslLayer` before merging: a key spelled in another letter case (`CAFILE`) fails naming the camelCase spelling, and both forms of one field in one layer fail naming the field.
2. It merges defaults, stage, stored, environment and inline layers in that order. After each deep merge, `mergeLayer` sets `connection.ssl` to `combineSsl(lower, higher)`.
3. The stage supplies `ssl: { caFile: ./certs/corp-ca.pem }` and the stored config supplies `ssl: true`. The result keeps `caFile`, because `true` adds nothing.
4. The stored config instead supplies inline `ca`. The result holds that `ca` and no `caFile`, because the higher layer's form of a field replaces the lower layer's form.
5. The stored config supplies `ssl: false`. The result is `false`.
6. The stage supplies `ssl: { rejectUnauthorized: false }`. A stored `ssl: true` or `{ caFile }` still validates, because `rejectUnauthorized` is never inherited; a stored config with no `ssl` takes the stage object. A stored `{ rejectUnauthorized: false }` under `NOORM_CONNECTION_SSL=true` or an inline `ssl: true` resolves to `true`.
7. `parseConfig` validates the combined result. The same-field exclusion cannot fire across layers, because combining already removed the lower layer's other form.
8. `config sync` applies `combineSsl` to the stored `ssl` (lower) and the stage `ssl` (higher), so stored fields the stage does not set stay, and the preview prints `[inline PEM]` for an inline `ca`, `cert` or `key`.

**Flow: unreadable file**

1. `resolveSslFiles` fails to read `ssl.keyFile`, finds it is not a regular file, is empty, is over 1 MiB, or holds no PEM block.
2. It throws `SslFileError` with the field `ssl.keyFile`, the path and the code: the system error code, or `EINVAL`, `EMPTY`, `EFBIG` or `ENOTPEM`. The message holds no file content.
3. `shouldRetry` returns false for `SslFileError`, so the retry loop stops after one attempt.
4. `explainConnectionError` returns the error unchanged. `openConnection` emits `connection:error` with that message (unmasked even under a `runtime.password` callback, because it holds no secret) and no `serverCode`, and rethrows. An SDK caller catches it as `SslFileError` imported from the SDK entry point.
5. `config validate` and the TUI connection test show the message. `config import` never reaches this step because it does not open a connection.

**Flow: MySQL with tlsServerName**

1. The config sets `ssl: true` (or file fields) and `tlsServerName: db.internal.corp` with `host: 10.0.0.5`.
2. `buildMysqlOptions` checks the identity rule: the name must be a hostname, `ssl` must be enabled and `rejectUnauthorized` must not be `false`. An IP address as the name, or a failed rule, throws.
3. mysql2 receives `host: db.internal.corp`, the `ssl` object with `verifyIdentity: true`, and a `stream` function.
4. For each physical connection mysql2 calls `stream`. It opens a socket to `10.0.0.5` on the configured port, sets no-delay, and sets keepalive from `enableKeepAlive` and `keepAliveInitialDelay`.
5. mysql2 upgrades that socket to TLS and checks the server certificate against `db.internal.corp`.

**Flow: connect from the TUI with a stage's ssl**

1. `settings.yml` defines the stage `prod` with `defaults.ssl: { caFile: ./certs/corp-ca.pem }`. The stored config `prod` has no `ssl`.
2. The app context reads the stored active config and builds its effective config: defaults, then the stage defaults, then the stored config, with `ssl` combined by `combineSsl`. No environment variable is read.
3. The app context binds policy on the effective config and memoizes the result on the stored config and the settings. It exposes that object as `activeConfig`.
4. `ConnectionProvider` compares `activeConfig` by identity. The object is stable across re-renders, so the provider opens one connection and `retainConnection` accepts it.
5. `createConnection` receives `ssl: { caFile }`, and `resolveSslFiles` reads the file. The connection uses TLS with the stage's CA.
6. A screen that loads a config by name (activation, validate, the transfer destination) builds the effective config of that name the same way before it connects, with the role-validation mode that site uses, and uses the policy context the function bound on it.
7. The stage also sets `isTest: true` and the stored config does not. `activeConfig.isTest` is true, its policy context `isTest` is false, and the SQL terminal's re-bind keeps it false.
8. The stored config still has no `ssl`. A change to the stage's `ssl` in `settings.yml` produces a new `activeConfig`, and the provider reconnects.

**Flow: add a config whose name matches a stage**

1. The user opens the add form. Use SSL is unchecked, Verify Certificate is checked, and no field shows a stage placeholder.
2. The user types the name `prod`, which matches a stage with `defaults.ssl: { caFile: ./certs/corp-ca.pem }` and `defaults.password`, fills host and database, leaves user and password blank, and submits. The form does not change what it shows.
3. `validateSslForm` judges the form connection over the stage defaults. The effective `ssl` is on, so a TLS server name passes.
4. The connection test calls `testConnection` with the form connection over the stage defaults. The blank user and password count as absent, so the stage password and the stage `caFile` reach the test.
5. The save stores the connection built from the form alone, with no `ssl` key. The config list row shows `tls`.

**Flow: edit a config whose SSL comes from its stage**

1. `ConfigEditScreen` loads the stored config `prod`, which has no `ssl`, and builds its effective config over the stage `ssl: { caFile: ./certs/corp-ca.pem }`.
2. The form shows Use SSL checked and Verify Certificate checked. The CA file field is empty with the placeholder `(stage: ./certs/corp-ca.pem)`. A field whose stored form is a path shows the path, and a field whose stored form is inline PEM shows `(inline certificate stored)`.
3. The user changes the host and submits. The screen calls `validateSslForm`, which judges the effective result of the save: the connection the save would store, over the stage defaults. The effective `ssl` is on, so a TLS server name passes.
4. `buildConnectionConfig` starts from the stored `connection`. No SSL field changed, so the stored `ssl` stays absent. `pool`, timeouts, `applicationName`, keepalive fields and inline PEM stay.
5. The connection test calls `testConnection` with the built connection over the stage defaults, so the test uses the stage's CA. An unreadable path shows on the form before save.
6. The screen saves the built connection. The stored config has the new host and no `ssl`.
7. The user opens the form again and unchecks Use SSL. The save stores `ssl: false`, which turns SSL off over the stage. With Use SSL unchecked, a TLS server name on PostgreSQL or MySQL, or a certificate path entered or changed, stops the submit with a message shown through `setConnectionError`.
8. The user instead leaves Use SSL checked and unchecks Verify Certificate. The save stores `ssl: { rejectUnauthorized: false }`. The effective `ssl` keeps the stage's `caFile` and skips validation. In that state a TLS server name on PostgreSQL or MySQL stops the submit, because the name requires validation.
9. The user checks Verify Certificate again. The save removes the stored `rejectUnauthorized: false` and stores `ssl: true`.
10. An entered path for `ca`, `cert` or `key` sets the file field and removes the inline field of the same name. An emptied field whose stored form is a path removes that path. An empty field whose stored form is inline PEM keeps the PEM.

**Flow: export and import a config in the TUI**

1. The user highlights a config, presses `+`, then `x`, and picks a recipient. `ConfigExportScreen` loads the stored config and passes the `secret:read` policy check.
2. The screen copies the stored connection and removes `user`, `password`, `ssl.key` and `ssl.cert`. `tlsServerName`, `pool`, the timeouts, `applicationName`, the keepalive fields, `filename`, `ssl.ca`, `rejectUnauthorized` and the three file paths stay. Stage values are not in the copy.
3. The screen encrypts `{ config, secrets }` for the recipient and writes `<name>.noorm.enc`.
4. The recipient opens the file in `ConfigImportScreen`. The preview shows the dialect, database and host, then the SSL state, certificate verification, each certificate file path and the TLS server name. It says a certificate file path must exist on this machine.
5. The recipient enters a user and a password. The screen saves the config `parseConfig` returns for the file's config with those credentials, without checking that a certificate file exists. An unknown key in the file is not saved.
6. A file that holds `dialect`, `host`, `port`, `database` and `ssl` only imports to a config with those fields.

**Flow: a certificate error on a status surface**

1. The active config names a `caFile` under a directory called `does not exist`. The connection fails with an `SslFileError`, and the TUI holds the message `Connection failed: Cannot read ssl.caFile '<path>': ENOENT`.
2. Home, `ConnectionStatus` and `DbListScreen` each pass the message string to their classifier.
3. The classifier calls `isSslFileErrorMessage` first. It is true, so the classifier returns "not a missing database" without reading the path.
4. The surface shows the error state with the message. A server message such as `database "app" does not exist` fails the predicate and still classifies as a missing database.

**Flow: a scalar `NOORM_CONNECTION_SSL` beside a nested ssl variable**

1. The environment sets `NOORM_CONNECTION_SSL=true` and `NOORM_CONNECTION_SSL_caFile=./certs/corp-ca.pem`.
2. `getEnvConfig` cannot nest `caFile` under a scalar. It throws a `ConfigValidationError` for `connection.ssl` that names both variables and says to set one form, not both. `NOORM_CONNECTION_SSL=false` beside the nested variable fails the same way.
3. The user keeps one form. The nested variable alone resolves to `ssl: { caFile }`.


## Checkpoints


| # | Checkpoint | Files/areas | Agent | Est. files | Verifies |
|---|------------|-------------|-------|------------|----------|
| 1 | Schema, types, environment parsing, stage defaults, same-field exclusion | `src/core/config/schema.ts`, `src/core/connection/types.ts`, `src/core/settings/types.ts`, `src/core/settings/schema.ts`, `tests/core/config/schema-ssl-files.test.ts`, `tests/core/config/env.test.ts`, `tests/core/config/stage-materialization.test.ts`, `tests/core/settings/schema.test.ts` | atomic-implementer (mode: feature) | ~8 | `bun test --serial tests/core/config tests/core/settings`; `bun run typecheck`; the exclusion test names the field |
| 2 | Layer combination: `combineSsl`, resolver merge, `config sync` | `src/core/config/ssl-combine.ts`, `src/core/config/resolver.ts`, `src/cli/config/sync.ts`, `tests/core/config/ssl-combine.test.ts`, `tests/core/config/resolver.test.ts`, `tests/cli/config/stage-commands.test.ts` | atomic-implementer (mode: feature) | ~6 | `bun test --serial tests/core/config tests/cli/config/stage-commands.test.ts`; `bun run typecheck`; stored `ssl: true` over stage `{ caFile }` keeps `caFile`; stored inline `ca` over stage `caFile` resolves to the inline `ca` only; `NOORM_CONNECTION_SSL_caFile` over stored inline `ca` resolves to `caFile` only; stored `ssl: false` over a stage object is off; an environment or SDK inline `ca` with `caFile` fails naming `ssl.ca`; an environment `ca` with `caFile` fails naming `ssl.ca` also under an SDK inline `caFile`, on both resolver paths; sync keeps stored `certFile` and `keyFile` under a stage `{ caFile }` |
| 3 | File resolution step, `SslFileError`, no retry, error pass-through, unreadable-path reports, SDK export | `src/core/connection/ssl-files.ts`, `src/core/connection/factory.ts`, `src/core/connection/errors.ts`, `src/sdk/index.ts`, `tests/core/connection/ssl-files.test.ts`, `tests/core/connection/factory.test.ts`, `tests/core/connection/errors.test.ts`, `tests/core/config/validate.test.ts`, `tests/sdk/inline-connection.test.ts`, `tests/sdk/bundle-smoke.test.ts` | atomic-implementer (mode: feature) | ~10 | `bun run build:packages`, then `bun test --serial tests/core/connection/ssl-files.test.ts tests/core/connection/factory.test.ts tests/core/connection/errors.test.ts tests/core/config/validate.test.ts tests/sdk/inline-connection.test.ts tests/sdk/bundle-smoke.test.ts`; the factory test counts one attempt for an unreadable file; the non-PEM `keyFile` content appears in no error text and no event; an SDK caller sees `instanceof SslFileError` on a rejected `connect()`; under a `runtime.password` callback the event message is the `SslFileError` message |
| 4 | SDK anchoring, `~/` expansion, policy fingerprint, leak proofs | `src/core/config/anchor.ts`, `src/core/config/schema.ts`, `src/core/connection/ssl-files.ts`, `src/sdk/context.ts`, `src/sdk/guards.ts`, `tests/core/config/anchor.test.ts`, `tests/core/config/resolver.test.ts`, `tests/core/config/schema-ssl-files.test.ts`, `tests/core/connection/ssl-files.test.ts`, `tests/sdk/context-ssl-anchor.test.ts`, `tests/core/state/manager.test.ts`, `tests/cli/config/export.test.ts`, `tests/cli/config/import.test.ts` | atomic-implementer (mode: feature) | ~13 | `bun run build`, then `bun test --serial tests/core/config tests/core/connection/ssl-files.test.ts tests/sdk/context-ssl-anchor.test.ts tests/core/state/manager.test.ts tests/cli/config/export.test.ts tests/cli/config/import.test.ts`; the SDK test shows the context's fingerprint equals the fingerprint of the config bound with the path as written; a `connect()` reads the file under `projectRoot`; reloaded state and export output hold paths and no PEM |
| 5 | MySQL passthrough, `tlsServerName`, `stream` function | `src/core/connection/dialects/mysql.ts`, `tests/core/connection/dialects/mysql.test.ts` | atomic-implementer (mode: feature) | ~2 | `bun test --serial tests/core/connection/dialects tests/core/connection/options.test.ts`; a local `net` server receives the dial to the real host and port; the client socket the `stream` function returns has no-delay and keepalive with the configured initial delay; the two MySQL identity errors and the unset `verifyIdentity` are asserted |
| 6 | MSSQL passthrough, one certificate-validation rule, PostgreSQL proof, MySQL certificate hint | `src/core/connection/dialects/mssql.ts`, `src/core/connection/errors.ts`, `tests/core/connection/dialects/mssql.test.ts`, `tests/core/connection/dialects/postgres.test.ts`, `tests/core/connection/errors.test.ts` | atomic-implementer (mode: feature) | 5 | `bun test --serial tests/core/connection/dialects`; built options hold `cryptoCredentialsDetails` and the expected `trustServerCertificate`; the IP-host test with `rejectUnauthorized: false` does not throw; `resolveSslFiles` output through `buildPostgresPoolOptions` puts the PEM in the `pg` ssl object |
| 7 | TUI add and edit forms, edit preservation, clearing rule, `validateSslForm` | `src/tui/utils/config-validation.ts`, `src/tui/screens/config/ConfigAddScreen.tsx`, `src/tui/screens/config/ConfigEditScreen.tsx`, `tests/cli/screens/config/ConfigAddScreen.test.tsx`, `tests/cli/screens/config/ConfigEditScreen.test.tsx`, `tests/cli/utils/config-validation.test.ts` | atomic-implementer (mode: feature) | ~6 | the CLI group command (the `Run CLI tests` step of `.github/workflows/ci.yml`), run as written there; edit save keeps `pool`, inline PEM and timeouts; the three clearing cases pass |
| 8 | Docs, skill references, changeset | `docs/dev/config.md`, `docs/dev/datamodel.md`, `docs/dev/config-sharing.md`, `docs/dev/sdk.md`, `docs/guide/environments/configs.md`, `docs/guide/environments/stages.md`, `docs/reference/sdk.md`, `skills/noorm/references/{config,sdk,cli}.md`, `.changeset/connection-cert-files.md` | atomic-implementer (mode: feature) | ~11 | `bun run lint:docs`; `bun run lint`; `bun run typecheck`; the five CI test groups (the `Run core tests (non-transfer)`, `Run transfer tests (isolated)`, `Run CLI tests`, `Run CLI logger settings tests (isolated)` and `Run integration tests` steps of `.github/workflows/ci.yml`); the changeset bumps `@noormdev/cli` and `@noormdev/sdk` as `minor` |
| 9a | Effective config in core and app context: the core function with trusted `isTest`, the undefined rule and the caller's role-validation mode; the memoized `activeConfig`; the SQL terminal re-bind; the add and edit connection tests over the stage. The forms still run the built `buildSslFields` and `validateSslForm`, so the review of this checkpoint tolerates `validateSslForm` and the Use SSL state judging stored values until 10a. Outline lines marked (10a) are not part of it | `src/core/config/resolver.ts`, `src/tui/app-context.tsx`, `src/tui/screens/db/SqlTerminalScreen.tsx`, `src/tui/screens/config/ConfigAddScreen.tsx`, `src/tui/screens/config/ConfigEditScreen.tsx`, `tests/core/config/resolver.test.ts`, `tests/cli/app-context.test.tsx`, `tests/cli/screens/db/sql-policy-rebind.test.tsx`, `tests/cli/screens/config/ConfigAddScreen.test.tsx`, `tests/cli/screens/config/ConfigEditScreen.test.tsx` | atomic-implementer (mode: feature) | ~10 | `bun test --serial tests/core/config`; `bun run build`, then the CLI group command (the `Run CLI tests` step of `.github/workflows/ci.yml`), run as written there; `bun test --serial tests/cli/screens/db/sql-policy-rebind.test.tsx` alone; `bun run typecheck`; `bun run lint`; the effective connection and policy fingerprint equal those of `resolveConfig` with no `NOORM_` variable set; a stage `isTest: true` leaves the policy context `isTest` false in the resolver, in `activeConfig` and after the SQL terminal re-bind; an `undefined` stored or form `password` takes the stage password; `activeConfig` keeps its identity across re-renders; `testConnection` receives a stage `caFile` and the saved config has no `ssl` key |
| 9b | Effective config at the by-name sites: activation, validate, transfer destination. Each site uses the core function's bound result, so a stage `isTest: true` grants nothing there. Depends on 9a | `src/tui/screens/config/ConfigUseScreen.tsx`, `src/tui/screens/config/ConfigListScreen.tsx`, `src/tui/screens/config/ConfigValidateScreen.tsx`, `src/tui/screens/db/DbTransferScreen.tsx`, `tests/cli/screens/config/ConfigUseScreen.test.tsx`, `tests/cli/screens/config/ConfigListScreen.test.tsx`, `tests/cli/screens/config/ConfigValidateScreen.test.tsx`, `tests/cli/screens/db/DbTransferScreen.test.tsx` | atomic-implementer (mode: feature) | ~8 | `bun run build`, then the CLI group command (the `Run CLI tests` step of `.github/workflows/ci.yml`); each new test file also passes alone (`bun test --serial <file>`); `bun run typecheck`; `bun run lint`; validate and the transfer destination hand on a stage `caFile` the stored config lacks; each activation site emits an `identity:sync:connection` error whose `SslFileError` message holds the stage's path; an unknown role shows an error at activation and still loads as a transfer destination; a stored destination without `isTest` under a stage `isTest: true`, with a role denied `db:reset`, stays refused, and each activation of a stored viewer config without `isTest` under a stage `isTest: true` emits no `identity:synced` event, while a stored `isTest: true` emits one; the activation tests supply their identity with `setIdentityOverride` and clear it in `afterEach` |
| 10a | Forms: effective Use SSL state and stage placeholders on the edit form, no stage state on the add form, Verify Certificate, untouched-fields rule, `validateSslForm` on the effective result. Depends on 9a | `src/tui/utils/config-validation.ts`, `src/tui/screens/config/ConfigAddScreen.tsx`, `src/tui/screens/config/ConfigEditScreen.tsx`, `tests/cli/utils/config-validation.test.ts`, `tests/cli/screens/config/ConfigAddScreen.test.tsx`, `tests/cli/screens/config/ConfigEditScreen.test.tsx` | atomic-implementer (mode: feature) | ~6 | `bun test --serial tests/cli/utils/config-validation.test.ts`; `bun run build`, then the CLI group command (the `Run CLI tests` step of `.github/workflows/ci.yml`); `bun run typecheck`; `bun run lint`; an untouched save under a stage `ssl` leaves `ssl` absent; unchecking Use SSL stores `false`; the two Verify Certificate mappings pass; a Verify Certificate change alone under an unchecked Use SSL stores nothing; the add form shows no stage state under a matching name |
| 10b | Display: the TLS tag in the config list, the `isSslFileErrorMessage` predicate, an `SslFileError` message never read as a missing database. Depends on 9b | `src/core/connection/ssl-files.ts`, `src/core/connection/index.ts`, `src/tui/screens/config/ConfigListScreen.tsx`, `src/tui/screens/home.tsx`, `src/tui/components/status/ConnectionStatus.tsx`, `tests/core/connection/ssl-files.test.ts`, `tests/cli/screens/config/ConfigListScreen.test.tsx`, `tests/cli/screens/home.test.tsx`, `tests/cli/screens/db/DbListScreen.test.tsx`, `tests/cli/components/status.test.tsx` | atomic-implementer (mode: feature) | ~10 | `bun test --serial tests/core/connection/ssl-files.test.ts`; `bun run build`, then the CLI group command (the `Run CLI tests` step of `.github/workflows/ci.yml`); each new test file also passes alone; `bun run typecheck`; `bun run lint`; the predicate is true for every `SslFileError` code's message with and without `Connection failed: `; a path under `does not exist` shows `ERROR` and the message at all three sites; a missing-database message still shows `NOT CREATED`; the row of a stored config with an unknown access role renders without a TLS tag |
| 11a | TUI export and import, the environment error for a scalar `NOORM_CONNECTION_SSL` beside a nested ssl variable. Depends on 10a and 10b | `src/tui/screens/config/ConfigExportScreen.tsx`, `src/tui/screens/config/ConfigImportScreen.tsx`, `src/core/config/index.ts`, `tests/cli/screens/config/ConfigExportScreen.test.tsx`, `tests/cli/screens/config/ConfigImportScreen.test.tsx`, `tests/core/config/env.test.ts` | atomic-implementer (mode: feature) | ~6 | `bun test --serial tests/core/config/env.test.ts`; `bun run build`, then the CLI group command (the `Run CLI tests` step of `.github/workflows/ci.yml`); each new test file also passes alone; `bun run typecheck`; `bun run lint`; the decrypted export payload holds `tlsServerName` and no `ssl.key`; an unknown key in an import file is not saved; `tests/cli/config/export.test.ts` passes without an edit; the environment error names both variables for a `true` and for a `false` scalar; `ConfigImportScreen.test.tsx` registers the `src/core/identity/storage.js` mock that replaces `loadPrivateKey` only, and passes alone and after `tests/cli/hooks/useVaultSecretKeys.test.tsx` in the group |
| 11c | Docs, design TUI section, skill reference, changeset, closure of three follow-ups. Depends on 11a | `docs/tui.md`, `docs/guide/environments/configs.md`, `docs/guide/environments/stages.md`, `docs/dev/config-sharing.md`, `docs/dev/datamodel.md`, `docs/design/enterprise-connectivity.md`, `skills/noorm/references/config.md`, `.changeset/connection-cert-files.md`, `.claude/project/followups/` (`connection-cert-files-tui-export-tls-server-name.md`, `connection-cert-files-db-list-badge.md` and `connection-cert-files-env-scalar-plus-nested.md` deleted; `INDEX.md` re-rendered) | atomic-implementer (mode: feature) | ~12 | `bun run lint:docs`; `bun run lint`; `bun run typecheck`; `bun run build`, then the five CI test groups (the same five steps of `.github/workflows/ci.yml`); `atomic followups render`, then `INDEX.md` lists none of the three entries closed in 11c; the changeset names the TUI behavior change and the environment error |
| 12 | Live TLS tests for MySQL and MSSQL, the CI step that exports the MySQL CA, the manual compiled-binary check, closure of three follow-ups. Depends on 6 | `.github/workflows/ci.yml`, `tests/integration/connection/mysql-tls.test.ts`, `tests/integration/connection/mssql-tls.test.ts`, `docs/dev/ci.md`, `docs/design/enterprise-connectivity.md`, `.claude/project/followups/` (`connection-cert-files-ci-live-tls.md`, `connection-cert-files-compiled-binary.md` and `connection-cert-files-mysql-cert-reason-regex.md` deleted; `INDEX.md` re-rendered) | atomic-implementer (mode: feature) | ~6 | Both test files pass against the local containers with `TEST_MYSQL_CA_FILE` set, and the MySQL file skips without it; `bun run lint`; `bun run typecheck`; `bun run lint:docs`; the binary from `bun run build:binary` connects to MySQL with a `~/` `ssl.caFile`, prints the `SslFileError` message for a missing file, and validates `ssl: true` under `NODE_EXTRA_CA_CERTS` |
| 13 | TLS-enforcing containers and the enforced live suites: the fixture script, the three compose services, the three test files and their helper, the CI step, docs. Depends on 12 | `scripts/gen-test-tls.sh`, `docker-compose.test.yml`, `.gitignore`, `tests/fixtures/tls/` (`pg_hba.conf`, `mysql-accounts.sql`, `mssql.conf`), `tests/utils/tls.ts`, `tests/integration/connection/{postgres,mysql,mssql}-tls-enforced.test.ts`, `.github/workflows/ci.yml`, `docs/dev/ci.md`, `.claude/rules/testing.md` | atomic-implementer (mode: feature) | ~13 | The three files pass with `TEST_TLS_DIR` set against the three services and skip without it; `mysql-tls.test.ts` and `mssql-tls.test.ts` still pass; `docker compose -f docker-compose.test.yml config -q`; a second run of the script changes no file; `bun run lint`; `bun run typecheck`; `bun run lint:docs` |


## Risks


| Risk | Likelihood | Mitigation |
|------|-----------|-----------|
| The MySQL `stream` function drifts from mysql2's own socket setup. mysql2 applies keepalive and no-delay only to a socket it creates itself (mysql2 3.19.1 `lib/base/connection.js:49-60`), so a custom socket that omits them loses half-open detection | med | `dialMysqlStream` sets no-delay and keepalive from `enableKeepAlive` and `keepAliveInitialDelay`. The test asserts on the client socket the `stream` function returns that both were applied with the configured initial delay; a server-accepted socket cannot show them. A local `net` server proves the dial target (real host and port). The function is used only when `tlsServerName` is set |
| MSSQL `rejectUnauthorized: false` sets `trustServerCertificate: true`. Every other truthy `ssl` validates the certificate (`validatesCertificate` in `src/core/connection/dialects/mssql.ts`), so a config with `ssl: { rejectUnauthorized: false }` connects to a server whose certificate does not validate | med | The changeset names the change. The test pins both outcomes. The result matches the PostgreSQL meaning of the key |
| A library caller hands a config with a relative ssl file path straight to `createConnection`, in a process whose working directory is not the project root. It resolves from the working directory and can read a different file. Every SDK path is anchored: the `Context` constructor and `bindSdkDestination` | low | The docs state the working-directory rule for a connection built without the SDK context. Absolute and `~/` paths behave the same everywhere |
| Resolved PEM is written back onto the context config. `connectionSecrets` (`src/mcp/prepared.ts:26-31`) redacts only inline `ssl.key`, `ssl.cert` and `ssl.ca`, so PEM held on a config object would reach agent-channel output unredacted | med | `resolveSslFiles` returns a new connection for the dialect factory and never mutates the config it receives. The factory test asserts the original config still holds paths and no PEM after a connect |
| An agent-channel caller (MCP or RPC) points `keyFile` at any file the process can read. The driver sends the key, not noorm's output, but a driver or TLS error could quote bytes from a file that is not PEM | low | `SslFileError` carries the field, path and error code only. `resolveSslFiles` never puts file content in a message or event. Tests in `ssl-files.test.ts` and `factory.test.ts` point `keyFile` at a non-PEM file and assert the content appears in no error text or event |
| The enforced-TLS suites are skipped wherever `TEST_TLS_DIR` is unset, so a local integration run without the fixtures proves no validated handshake and no client certificate. CI does not run the compiled binary | low | CI sets the variable in the job that runs the integration tests and fails the step when a TLS service is not healthy. `docs/dev/ci.md` and `.claude/rules/testing.md` give the local commands |
| The enforced suites pin driver and TLS-library wordings and codes (`SELF_SIGNED_CERT_IN_CHAIN`, `UNABLE_TO_VERIFY_LEAF_SIGNATURE`, the PostgreSQL client-certificate refusal), so a runtime, driver or server image upgrade can fail them with no product change | low | Each assertion names the hint it protects, so a failure points at the wording that moved |
| The MySQL certificate hint is recovered from mysql2 message text, so a wording change in mysql2 or the runtime's TLS library drops it | low | The rejection cases of `tests/integration/connection/mysql-tls.test.ts` assert the hints, so CI fails on a wording change |
| The activation tests need `syncIdentityWithConfig` to reach `createConnection`. It returns early when `loadExistingIdentity` finds no identity. It imports that function from `src/core/identity/factory.js`, and a `mock.module` of `src/core/identity/index.js` replaces it there too, because the barrel re-exports the same binding. The stand-in the other screen tests register, which resolves `null`, ends the sync before it connects. | med | The activation tests register `loadExistingIdentity: async () => getIdentityOverride()` in their `src/core/identity/index.js` mock, supply the identity with `setIdentityOverride` (`src/core/identity/storage.ts`) and clear it with `clearIdentityOverride` in `afterEach`. A throwaway `HOME` cannot do this in-process, because `storage.ts` fixes `~/.noorm` at module load. The tests assert that the `identity:sync:connection` error was emitted, so a sync that returned early fails the test. |
| A relative path in a committed `settings.yml` stage default means different files for each machine's project root | low | Stage defaults take the same rule as stored configs, and docs say the path must exist on every machine that connects |
| A path that contains a retry word such as `econnrefused` is retried if the retry decision reads the message text | low | `shouldRetry` tests `instanceof SslFileError`, not the message text |
| A stage default changes what an existing TUI config connects to. A stored config with no `ssl` under a stage with `ssl` starts using TLS, a stage `user` or `password` is used by a stored config that has none, and a stage `port` fills a stored config that lacks one. A stage `host` or `database` cannot fill a config: `buildConnectionConfig` always writes `host` for a server dialect, and the schema requires `database`. The add form writes the dialect default `port` for an empty Port field, so a stage `port` reaches a config saved from the edit form or stored without one. This is the intent, and it is a behavior change for anyone whose TUI config worked because the stage was ignored | high | The changeset and `docs/guide/environments/stages.md` name the change. A stored value always wins over the stage, and a stored `ssl: false` turns the stage's `ssl` off. The config list shows the TLS state in effect |
| A `NOORM_STAGES_<stage>_DEFAULTS_SSL` variable can turn TLS or certificate validation off for a TUI config that relies on its stage for `ssl`, as it does in the CLI | low | A config that stores its own `ssl` is unaffected, because `rejectUnauthorized` is never inherited and a stored `ssl` sits above the stage. The docs and the changeset say that settings variables still apply in the TUI |
| A stage default changes a TUI config's privileges. The effective config merges the stage's `type`, `isTest` and `access`, and a policy context that trusted a merged `isTest` would give every resolvable role at least the admin cell | med | The policy context `isTest` comes from the stored config's own `isTest` only. The core function returns the config with that context bound, every site uses the bound result, and the `SqlTerminalScreen` re-bind carries it over, with a test at the core function, the app context, the re-bind, both activation sites and the transfer destination. `RunListScreen.tsx` and `RunBuildScreen.tsx` read `activeConfig.isTest` and `type` for build-rule matching, so a stage value beneath a stored config that lacks the key changes which rules match, as in the CLI. That is rule matching, not a permission. A stored `isTest: true` config keeps its grant when a stage `port` retargets it, as in the CLI, where `resolveConfig` compares targets after the stage merge |
| The policy target fingerprint of a TUI config changes. `policyTargetIdentity` hashes the whole connection (`src/core/policy/check.ts:29-33`), and the effective connection adds the default `pool` and every stage field the stored config lacks, so the fingerprint changes for every TUI config whose stored connection lacks a `pool` or a field its stage supplies. Confirmations live in the process, so none outlives the change. A site left binding the stored config would mint or check a fingerprint that no other site matches, and a confirm-tier action there would ask again or be refused | med | Every site that connects binds the effective config, and the app-context test compares the `activeConfig` fingerprint with the fingerprint of the effective config bound outside the provider. Sites that only read policy for a stored config (`ConfigExportScreen`, `ConfigRemoveScreen`) mint and check on one object within the screen |
| `ConnectionProvider` compares `activeConfig` by identity (`src/tui/providers/ConnectionProvider.tsx:194-195`, `:235`, `:267-270`). An effective config rebuilt on each render makes the provider retire and reopen the connection in a loop, and `retainConnection` throws `The database target changed` | med | The effective config is built inside the existing `useMemo` in `src/tui/app-context.tsx`, keyed on the stored config and the settings. The app-context test asserts the object identity across re-renders |
| The TUI keeps a saved config in memory with `user: undefined` and `password: undefined` as own keys (`buildConnectionConfig`, `ConfigImportScreen`), and `merge` from `@logosdx/utils` lets an explicit `undefined` erase the stage value beneath it. The stage credential would apply only after a restart | med | The effective-config function treats an `undefined` stored or form connection field as absent. A resolver test passes explicit `undefined` keys, and an add-form test with a blank user and password asserts `testConnection` receives the stage password |
| Building the effective config parses the merged result inside the app-context `useMemo`, so a stored config that passes alone and fails once merged throws during render and the TUI exits at every start while that config is active. Two stored shapes reach it: `pool: { min: 11 }` with no `max` over the default `pool.max` of 10, and a non-SQLite database name the schema refuses, which the add and edit forms save without parsing | high | The memo takes the error as a value. The app stays ready, `activeConfig` is null, `activeConfigName` keeps the name and `activeConfigAccessError` carries the message, so the config stays listable and editable. The stored connection alone is never a fallback. The app-context test renders the provider with each shape |
| The untouched-fields rule depends on detecting an unchanged field. A value that differs from the initial one only by whitespace, or a checkbox toggled twice, read as changed would store `ssl: true` or `false` over a stage and change what the config connects to | med | A field counts as changed when its trimmed value differs from the initial value the form was built with. `config-validation.test.ts` covers the untouched save under a stage `ssl`, a whitespace-only difference, and a checkbox returned to its initial state |
| The add form shows Use SSL unchecked while a stage that matches the typed name supplies TLS. The untouched form stores no `ssl` key, so the saved config connects with the stage's TLS | med | The connection test and the submit check use the stage beneath the form values, and after the save the config list tag shows `tls` for the config |
| The edit form shows a stage placeholder and a Use SSL state computed when the form opened. A change to `settings.yml` while the form is open leaves them stale: the form shows a state the stage has stopped supplying | low | The submit check and the connection test read the stage defaults at submit time, so a stale display cannot store a value the user did not choose. The untouched-fields rule leaves the stored `ssl` as it was |
| An export file that holds `dialect`, `host`, `port`, `database` and `ssl` only imports to a config that lacks `tlsServerName` and the pool and timeout settings, and a config that needs the name fails its first connection | low | The import preview shows the incoming TLS settings, the name included, before the save. `docs/dev/config-sharing.md` says which fields a file carries |
| A recipient of a TUI export gets no inline client key or certificate, so a config that authenticates with inline `ssl.key` and `ssl.cert` imports without them and the server refuses the connection | med | The export withholds them as credentials, the same as `user` and `password`. `docs/dev/config-sharing.md` and `docs/tui.md` say the recipient supplies their own. The file-form paths travel |
| The new screen tests run in the CLI test group, one process in which earlier files replace `src/core/connection/factory.js` and `src/core/index.js` through `mock.module` for good. `tests/cli/hooks/useVaultSecretKeys.test.tsx` likewise replaces `loadPrivateKey` in `src/core/identity/storage.js`, which `ConfigImportScreen.tsx` imports. A test that depends on the real `testConnection`, the real managers or the real `loadPrivateKey` passes alone and fails in the group | med | A new in-process screen test registers the `src/core/index.js` and `src/core/identity/index.js` mocks that spread the actual module, and the connection-factory mock that replaces `testConnection`, as the existing screen tests do, so it sees one behavior alone and in the group. `ConfigImportScreen.test.tsx` also registers a `src/core/identity/storage.js` mock that spreads the actual module and replaces `loadPrivateKey` only. New test files use `mock.module` for nothing else. A site that connects through `createConnection` is proven by the stage's certificate path in the `SslFileError` message, with no extra mock. Each new test file is run alone and in the group command before its checkpoint closes |
| The `isSslFileErrorMessage` predicate and the `SslFileError` message shapes drift apart, and a certificate error whose path holds `does not exist` reads as a missing database again | low | The predicate sits beside `messageFor` in `ssl-files.ts`. A test builds the message of each `SslFileError` code and asserts the predicate, with and without the `Connection failed: ` prefix |


## Change log


### 2026-11-10 — Anchoring moves to the SDK; `~/` expands; empty paths are refused

**What changed:** Relative ssl file paths are anchored to the project root by the SDK `Context` constructor and by `bindSdkDestination`, each after policy binding. `resolveConfig` returns paths as written. `resolveSslFiles` expands a leading `~/` to the home directory. An empty-string file path fails schema validation.

**Why:** Correction, found by the checkpoint 4 review with a probe through the real functions. The SDK re-binds policy in the `Context` constructor after `resolveConfig` returns, so anchoring inside `resolveConfig` made the SDK's target fingerprint hash the absolute path. Anchoring an empty string produced the project root itself, and `~/ca.pem` became `<root>/~/ca.pem`.

**Superseded:** `resolveConfig` anchored its output after policy binding on both return paths, and transfer destinations bound by `bindSdkDestination` were an unanchored risk.

### 2026-11-10 — MySQL refuses an IP `tlsServerName`; the dialed socket follows mysql2's resolved keepalive

**What changed:** On MySQL an IP address as `tlsServerName` throws. The `stream` function reads keepalive settings from mysql2's resolved connection config.

**Why:** Correction, found by the checkpoint 5 review with a live probe against a TLS-enabled MySQL 8.0 server. mysql2 sends no TLS name when `host` is an IP, so the certificate was checked against the dial host and the configured name was ignored without an error. mysql2 treats an unset `enableKeepAlive` as on, and a `driver` override wins, so keepalive values captured before mysql2 resolves its config left the default socket without keepalive.

### 2026-11-10 — The certificate hint covers MySQL

**What changed:** A certificate rejected by a MySQL server gets the same hint as the other dialects.

**Why:** Found by the checkpoint 5 live probe. mysql2 replaces the TLS error code with `HANDSHAKE_SSL_ERROR`, so the hint that names `ssl.caFile` never appeared for MySQL.

### 2026-11-10 — One certificate hint for all dialects; a hostname mismatch gets its own

**What changed:** The certificate hint names `ssl.rejectUnauthorized: false` on PostgreSQL and MySQL as well as MSSQL, with a note to remove `tlsServerName` where the identity rule requires validation. A hostname mismatch gets a hint that names `tlsServerName`.

**Why:** Correction, found by the checkpoint 6 review with live runs. `ssl: { rejectUnauthorized: false }` keeps encryption on all three dialects, so advising PostgreSQL and MySQL users to turn SSL off sent them to cleartext. A certificate authority cannot fix a name mismatch.

**Superseded:** Only the MSSQL hint named `ssl.rejectUnauthorized: false`; PostgreSQL and MySQL were told to turn SSL off.

### 2026-11-10 — The TUI refuses a certificate path without Use SSL

**What changed:** The submit check covers certificate file paths as well as the TLS server name, under the name `validateSslForm`. Inline-PEM fields show a placeholder, typed values are trimmed, and the edit form drops a stored SQLite `filename`.

**Why:** Found by the checkpoint 7 review. A path typed with Use SSL unchecked was dropped without a message, so the connection test passed without TLS while the form showed a CA. Keeping every unseen field also kept a SQLite `filename`, which made the Database field stop deciding which file opens.

**Superseded:** The submit check was `validateTlsServerName` and covered the TLS server name only.

### 2026-11-10 — A file with no PEM block is refused

**What changed:** `resolveSslFiles` refuses a file that holds no PEM block, with `SslFileError` code `ENOTPEM`. A whitespace-only file path fails schema validation like an empty one.

**Why:** Found by review probes. Under Node a `ca` that is not PEM is accepted without error and the connection then waits for the connect timeout, far from the cause. A whitespace-only path passed validation and failed at connect.

### 2026-11-10 — `rejectUnauthorized` is never inherited; audit corrections

**What changed:** When layers combine, `rejectUnauthorized` comes only from the highest layer that sets `ssl`. The TUI refuses a TLS server name whenever Use SSL is unchecked. An `ssl` key spelled in another letter case fails resolution. A SQLite connection reads no ssl files. A file over 1 MiB is refused. The `config sync` preview masks inline PEM. The body's change tree, outline, flows and risks are brought in line with the earlier amendments.

**Why:** Correction, found by the final audit with probes at the base and at the head. Inheriting `rejectUnauthorized: false` let a committed stage default switch validation off beneath a stored `ssl: true`, and kept validation off under an environment or inline `ssl: true` that turned it on before this work. The TUI connects with the stored config, so allowing a TLS server name on the strength of a stage default produced a config that failed its own connection test. `NOORM_CONNECTION_SSL_CAFILE` was stripped without a message.

**Superseded:** `rejectUnauthorized` followed the higher layer when it set it and was otherwise kept from the lower layer. The edit form allowed a TLS server name with Use SSL unchecked when the stored config had no `ssl`.

### 2026-11-11 — The TUI honors every TLS setting the CLI and SDK honor

**What changed:** The TUI connects with the effective config: the stored config merged over the defaults and the defaults of its stage, built by one core function that shares the merge with `resolveConfig` and reads no environment variable. The app-context `activeConfig`, activation, validate, the transfer destination and the add and edit connection tests all use it, with policy bound on it. The effective config trusts `isTest` from the stored config only: the core function returns the config with that policy context bound, every site that binds an effective config uses the bound result (the activation sites and the transfer destination included, none through a binding that reads the config's own `isTest` field), and the SQL terminal's re-bind carries it over. Its access roles never come from `NOORM_ACCESS_USER` or `NOORM_ACCESS_AGENT`. It treats an `undefined` stored or form connection field as absent. A stored config that cannot be built into an effective config leaves the app ready with `activeConfig` null, the name kept and the message in `activeConfigAccessError`, and the TUI never connects with the unmerged stored config. The edit form shows the effective Use SSL state and a `(stage: <path>)` placeholder, and the add form shows no stage state. Both forms gain a Verify Certificate checkbox, leave the stored `ssl` and `tlsServerName` as they were when their fields are untouched, and `validateSslForm` judges the effective result of the save. The config list shows a `tls` or `tls unverified` tag. The TUI export carries every connection field except `user`, `password` and the inline `ssl.key` and `ssl.cert`, the import saves the parsed connection from the file, and the import preview shows the incoming TLS settings. An `SslFileError` message is never classified as a missing database, through one predicate exported beside the message shapes. A scalar `NOORM_CONNECTION_SSL` beside a nested ssl variable fails with a message that says to set one form, not both. CI runs a live TLS test against the MySQL service container: the workflow step fails when the copied CA file holds no certificate, the test learns the certificate's common name without a TLS socket of its own, and the pull request's integration log must show the four cases as pass. Checkpoint 11b carries the live test and a manual check of the compiled binary, and checkpoint 11c carries the docs, the design section, the skill reference, the changeset and the remaining follow-up closures. New in-process screen tests may register the `src/core/index.js`, `src/core/identity/index.js` and connection-factory mocks the existing screen tests register, and `ConfigImportScreen.test.tsx` may register a `src/core/identity/storage.js` mock that replaces `loadPrivateKey` only. The activation tests supply their identity with `setIdentityOverride`. The change tree, outline, flows, checkpoints 9a to 11c and risks cover the added scope.

**Why:** The owner manages databases mainly through the TUI and directed that it must not ignore or drop a TLS setting. An inventory of the branch found the TUI connecting with the stored config alone, hiding `rejectUnauthorized` with no way to set it, and dropping `tlsServerName` and other connection fields on export and import.

**Superseded:** The TUI connected with the stored config and applied no stage defaults. The form judged the stored values alone and refused a TLS server name whenever Use SSL was unchecked, whatever the stage supplied. Use SSL unchecked on the add form always stored no `ssl` key, and the Use SSL checkbox reflected the stored `ssl` only. The TUI export carried `dialect`, `host`, `port`, `database` and `ssl` only, inline key material included. The three status classifiers matched `does not exist` in any message. A scalar `NOORM_CONNECTION_SSL` beside a nested ssl variable threw `Cannot set property 'caFile' on primitive value` from the environment parser. No integration test was added and proof for every dialect was unit-level. New test files used no `mock.module`.


### 2026-11-11 — The live TLS test and the compiled-binary check leave this spec

**What changed:** Checkpoint 11b is removed with its criteria, its change-tree and outline entries and its risk row: the CI step that copies the MySQL container's CA, `tests/integration/connection/mysql-tls.test.ts`, the line in `docs/dev/ci.md`, and the manual check of the compiled binary. A live TLS test on the integration containers and verification in the compiled binary are non-goals, and their follow-up files stay open. Checkpoint 11c depends on 11a only, deletes three follow-up files, and no longer edits the `NODE_EXTRA_CA_CERTS` row of the design. Proof for every server dialect is unit-level. Corrections from the audit of the TUI scope, each measured with a probe: the body states that settings variables (`NOORM_STAGES_<stage>_DEFAULTS_*`, `NOORM_PATHS_*`) still apply in the TUI, with a risk row for a stage `ssl` variable; the activation tests prove the trusted-`isTest` rule by the `identity:synced` event of a real SQLite sync, because a check on `activeConfig` did not exercise the activation site; the TUI import parses the whole config once, so an invalid `type` or `isTest` is refused, and its preview renders for a `null` `ssl` and a missing `secrets` key; an empty Port field on the edit form keeps an absent stored port absent; the criterion and risk row on the identity mock say that a `src/core/identity/index.js` mock does replace the export `sync.ts` imports; and the outline names `effectiveConfig`, `revalidateConfigPolicy`, `connectionOverStage` and `skipsVerification`.

**Why:** Owner decision. Work specific to MySQL or MSSQL is deferred so the PostgreSQL path ships sooner.

**Removed:** Checkpoint 11b, because its work is deferred to the two follow-ups.

**Superseded:** CI ran a live TLS test against the MySQL service container, checkpoint 11b carried that test and a manual check of the compiled binary, and it deleted `connection-cert-files-ci-live-tls.md` and, on a passing check, `connection-cert-files-compiled-binary.md`. Checkpoint 11c depended on 11b.


### 2026-11-11 — Live TLS tests and the compiled-binary check are built

**What changed:** Checkpoint 12 adds a CI step that writes the MySQL service container's public CA to a file and exports `TEST_MYSQL_CA_FILE`, `tests/integration/connection/mysql-tls.test.ts` (four live cases, skipped without the variable), `tests/integration/connection/mssql-tls.test.ts` (encryption without validation, and the rejection hint), and a paragraph in `docs/dev/ci.md`. The two non-goals that deferred this work are replaced by narrower ones: no fixture CA, no validated live MSSQL test, no CI job for the compiled binary. The risk row on live proof is narrowed and a row covers the mysql2 wording dependence. The darwin-arm64 binary from `bun run build:binary` was checked by hand against the local MySQL container: a `~/` `ssl.caFile` connected, a missing file printed the `SslFileError` message, and `NODE_EXTRA_CA_CERTS` made `ssl: true` validate, so the design no longer calls that variable unverified in the compiled binary. The follow-up files `connection-cert-files-ci-live-tls.md`, `connection-cert-files-compiled-binary.md` and `connection-cert-files-mysql-cert-reason-regex.md` are deleted.

**Why:** 1.10.0 shipped MySQL and MSSQL certificate support with unit-level proof only, and the three follow-ups tracked the gap.

**Superseded:** A live TLS test and verification in the compiled binary were non-goals tracked by open follow-ups, and proof for every server dialect was unit-level.

### 2026-11-11 — The import preview shows privileges; export and remove bind the effective config

**What changed:** The TUI import preview gains a `Roles` line with the user and agent roles the import saves and, when the file sets `isTest`, a `Test database` line that says every role gets at least admin's permissions. The preview shares rows and its panel drops vertical padding so that it fits 20 rows with every TLS field set. `ConfigExportScreen` and `ConfigRemoveScreen` bind policy with `effectiveConfig`, so no TUI site binds a stored config alone.

**Why:** Two follow-ups from the audits of this spec. A file's roles and `isTest` decide what the user and agent roles may do on the imported config, and the preview hid both. The export and remove screens bound the stored config while every other TUI site bound the effective one, so a stage's roles were not applied to a stored config that carries none and the two bindings gave one config two policy fingerprints.

**Superseded:** The import preview showed connection and TLS settings only, on one row each with vertical padding. `ConfigExportScreen` and `ConfigRemoveScreen` bound the stored config with `withConfigPolicy`.

### 2026-11-11 — TLS-enforcing containers and the enforced live suites

**What changed:** Checkpoint 13 adds `scripts/gen-test-tls.sh`, which generates a fixture CA, a server certificate per dialect issued for `db.noorm.test`, a client certificate for `noorm_tls` and an unrelated CA into a gitignored directory. `docker-compose.test.yml` gains `postgres-tls`, `mysql-tls` and `mssql-tls` under the `tls` profile, each enforcing TLS with the fixture certificate. Three test files, skipped without `TEST_TLS_DIR`, run the matrix through `createConnection` and one case each through `createContext`: validated connections, both rejection hints, client-certificate login for PostgreSQL and MySQL, encryption without validation, the plaintext refusal, and a missing `caFile` that opens no socket. CI starts the services in a step and exports the variable. The non-goals on a fixture CA, a PostgreSQL live test and a validated MSSQL live test are replaced by the ones that still hold, and the risk row on live proof is rewritten.

**Why:** PostgreSQL had no live TLS test, no test presented a client certificate, and no MSSQL test validated a certificate, so an option that was built as asserted and failed a real handshake went uncaught.

**Superseded:** A fixture CA, a change to `docker-compose.test.yml`, a live PostgreSQL TLS test and a validated live MSSQL test were non-goals, and the live tests used only the certificates the MySQL and SQL Server containers generate for themselves.

## Implementation log


### built — 2026-11-10

Built across 26 iterations of /subagent-implementation. The branch ships as one squashed commit; the slices, in order:

- CP-1 accept ssl file paths in connection and stage defaults
- CP-2 combine ssl per field across layers
- CP-3 read ssl cert files at connect time
- CP-4 read ssl cert files relative to the project root
- CP-5 honor ssl certificates and tlsServerName on MySQL
- CP-6 honor MSSQL ssl certificates and rejectUnauthorized
- CP-7 edit ssl cert files in the TUI and keep unseen connection fields
- CP-8 document connection certificate files
- cleanup: refuse cert files with no PEM block
- audit fixes: never inherit rejectUnauthorized across ssl layers

**Out-of-scope work performed during this build:**

- The certificate hint for MySQL: mysql2 hides the TLS error code, so the hint that names `ssl.caFile` never appeared there.
- A dedicated hint for a hostname mismatch, naming `tlsServerName` and what the certificate is issued for.
- The `config sync` preview masks inline PEM, which it printed for a stored `ssl` object.
- The TUI edit form drops a stored SQLite `filename`, which keeping every unseen field would otherwise have preserved.

**Unforeseens — surprises that emerged during implementation:**

- The SDK re-binds policy after `resolveConfig` returns, so anchoring paths inside the resolver made the SDK's target fingerprint hash an absolute path. Anchoring moved to the SDK `Context` and `bindSdkDestination`.
- mysql2 takes the TLS name from `host` alone, sends none for an IP, and applies keepalive only to sockets it creates. `tlsServerName` on MySQL needed a caller-supplied `stream`, the driver's resolved keepalive settings, and a refusal of IP names.
- The local MySQL 8 test container exposes a TLS endpoint with its own CA, which gave live handshake proof the spec had assumed unavailable.
- A synchronous file read froze the process on a FIFO path beyond the reach of the abort signal. The read is asynchronous and refuses anything that is not a regular file.
- Inheriting `rejectUnauthorized` across layers let a committed stage default switch validation off beneath a stored `ssl: true`. It is never inherited.
- The TUI connects with the stored config and applies no stage defaults, so a form rule that deferred to a stage default produced a config that failed its own connection test.
- A PEM file with a byte-order mark, and a colon-stripping regular expression with cubic backtracking, were each caught by review probes before commit.

**Deferred items still open:**

- `.claude/project/followups/connection-cert-files-compiled-binary.md`: verify certificate files in the compiled CLI binary
- `.claude/project/followups/connection-cert-files-ci-live-tls.md`: live TLS integration test in CI
- `.claude/project/followups/connection-cert-files-tui-export-tls-server-name.md`: TUI config export omits `tlsServerName`
- `.claude/project/followups/connection-cert-files-tui-screenshot.md`: regenerate the add-config screenshot
- `.claude/project/followups/connection-cert-files-policy-fingerprint-binding.md`: fingerprint differs between stored-bound and resolver-bound configs
- `.claude/project/followups/connection-cert-files-env-scalar-plus-nested.md`: parser error for a scalar plus a nested ssl variable
- `.claude/project/followups/connection-cert-files-db-list-badge.md`: database list misreads a path containing "does not exist"
- `.claude/project/followups/connection-cert-files-mysql-cert-reason-regex.md`: MySQL hint depends on mysql2 message wording
- The tunnel in `docs/design/enterprise-connectivity.md`: a separate spec and pull request

