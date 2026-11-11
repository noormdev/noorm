# Troubleshooting


Find the message you see, read the cause, and apply the fix. Exit code `2` means the command never ran, `1` means it failed and a retry is safe, and `3` means some work landed ([exit codes](/headless#exit-codes)).


## Why does a command fail or surprise me?


| Message or symptom | Cause | Fix |
|---|---|---|
| `Unrecognized flag '--config' before the subcommand` | Only `-c`/`--cwd` is a root flag | `noorm run build --config prod` |
| `Error: --cwd path is not a directory: …/prod` | In `noorm -c prod run build`, `-c` means `--cwd` | `noorm run build -c prod` |
| `Unknown command help` | There is no `noorm help` | `noorm db create --help` |
| `db create --name foo` creates nothing named `foo` | `db create` has no `--name`. The config names the database | `noorm config import dev-config.json`, then `noorm db create -c dev` |
| `Unknown command` from `noorm sql "…"` | The `sql query` rewrite needs the query to start with a SQL verb, so a leading comment defeats it | `noorm sql query "…"` |
| `Error: noorm init requires an interactive terminal.` | No terminal, no `--yes` | `noorm identity init …`, then `noorm init --yes` |
| `--dry-run` leaves files in `tmp/` | It renders SQL there with secrets resolved, and `tmp/` is not gitignored | Delete `tmp/`, or use `noorm run preview <path>` |


## Why does the database refuse or misbehave?


Each server sends one error for a wrong password and an unknown account. noorm rewords it, and the server's own text is in `.noorm/state/noorm.log` (`connection:error`, fields `serverCode` and `serverMessage`).

| Message | Also sent for |
|---|---|
| `Login failed for user …` (SQL Server) | Unknown login, login denied `CONNECT SQL`, Windows-only authentication |
| `Password authentication failed for user …` (PostgreSQL) | Unknown role, password past `VALID UNTIL` |
| `Access denied for user …` (MySQL) | Unknown user, no account for this client host, `REQUIRE SSL` account |

| Symptom | Cause | Fix |
|---|---|---|
| `The server's TLS certificate was rejected (…)` | The server's certificate is signed by an authority noorm does not trust | Set `ssl.caFile` to the CA certificate, or `NODE_EXTRA_CA_CERTS` for the whole process. To keep encryption without validation, set `ssl.rejectUnauthorized: false` ([details](/guide/environments/configs#how-do-i-connect-to-a-server-with-a-private-ca)) |
| `The server's TLS certificate was issued for a different hostname (…)` | The host you dial is not a name on the certificate | Set `tlsServerName` to a name the certificate carries, or dial that name |
| `Cannot read ssl.caFile '…': ENOENT` | The path does not exist, or it resolves from another directory | Use an absolute or `~/` path, or a path relative to the project root. The CLI and TUI resolve it from the project root, the SDK from `projectRoot` |
| `ssl.caFile '…' is not a PEM file` (also `certFile`, `keyFile`) | The file holds no `-----BEGIN` block, as with a DER-encoded certificate | Convert it to PEM: `openssl x509 -inform der -in ca.der -out ca.pem` for a certificate, `openssl pkey -inform der -in key.der -out key.pem` for a key |
| `ssl.caFile '…' is larger than 1 MiB` (also `certFile`, `keyFile`) | The path points at a file that is not a certificate or key, such as a data file or an archive. A CA bundle under 1 MiB is fine | Point it at the certificate, CA bundle or key |
| A right password fails from `NOORM_CONNECTION_PASSWORD` | The compiled binary does not read `.env` files | Export the variable, or set it in CI |
| An MSSQL procedure's `DEFAULT` is not applied | The SDK sends `undefined` as `NULL`, and MSSQL applies a `DEFAULT` only to an omitted parameter | `.default(value)` in the Zod schema, or omit the key ([details](/reference/sdk#parameter-handling-and-null-semantics)) |


## Next


- [CLI flag conventions](/cli/flags): where each flag goes
- [Non-interactive operation](/guide/automation/non-interactive): `--yes` and what still refuses
