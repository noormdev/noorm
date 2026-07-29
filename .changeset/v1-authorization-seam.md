---
"@noormdev/cli": major
"@noormdev/sdk": major
---

## Authorization is now enforced at the core seam

Policy was re-implemented per surface, and several cells were simply empty — the CLI would perform operations the TUI correctly refused, and two whole domains had no permission to check against.

### Fixed

* `fix(policy)!:` the SQL classifier no longer routes writes as reads. `EXPLAIN (ANALYZE) DELETE FROM t` classified as `read` and deleted rows under a `viewer` role — through the CLI and over a live MCP session. Two independent causes are fixed: the keyword fallback treated `EXPLAIN` as terminally read-only, and on the parser path `EXPLAIN` inherited nothing from the statement it wraps while the write-signal scan had no DDL node types. An `EXPLAIN` now inherits its wrapped statement's classification.
* `fix(policy)!:` statement splitting is dialect-aware. It tracked only `'`, so an MSSQL bracket-quoted identifier (`SELECT 1 AS [a'b]; DROP TABLE x`) split wrong and the tail ran unclassified. `"`, backticks, `[…]`, `$tag$…$tag$` and all three comment forms are now modelled.
* `fix(policy)!:` a statement with no leading word character used to classify as `read`, so a leading NUL byte carried `DROP TABLE` past the gate. It now fails closed.
* `feat(policy)!:` added the permissions that did not exist — `vault:*`, `secret:*`, `config:write`, `db:truncate`, `db:teardown`, `transfer:plan`, `lock:force`, `debug:*`. Operations in those domains had nothing to gate against and shipped ungated.
* `fix(vault)!:` vault and secret operations are gated at the core seam, so SDK, CLI and TUI inherit one check. A `viewer` config that was denied `run build` could still run `vault set`, `vault rm`, `vault propagate` and `secret set`.
* `fix(db)!:` `db create` is gated. The matrix denied `db:create` to `viewer` and the TUI enforced it; the CLI created the database anyway.
* `fix(db)!:` `db truncate` and `db teardown` require confirmation. `--yes`/`--force` were declared arguments that neither command read, so `noorm db teardown < /dev/null` dropped 63 objects and exited 0 — against documentation promising the CLI refuses.
* `fix(debug)!:` the debug screens' delete paths are gated. They removed rows from `noorm.vault` and `noorm.identities` with no authorization check at all.
* `fix(lock)!:` `lock force` is gated and requires `--yes`, names the holder it evicts, and returns a distinct exit code when there was nothing to release.
* `fix(config)!:` `config import --force` is gated on `config:write`. It rewrote a config's `access` with no check, escalating a `viewer` config to full delete rights in one command.
* `fix(transfer):` `getTransferPlan` is gated, matching the invariant its own comment claimed. `--dry-run` leaked destination table names, row estimates and the FK graph to a denied caller.
