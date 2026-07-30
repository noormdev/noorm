---
"@noormdev/cli": major
"@noormdev/sdk": major
---

## Operations no longer report success over lost, duplicated or unwritten data

### Fixed

* `fix(transfer)!:` export and db-to-db transfer paginate by primary key instead of bare `LIMIT/OFFSET`. With no `ORDER BY`, a source being written to during a 50,000-row export produced 14,149 missing and 13,387 duplicated rows while reporting `rowsExported: 50000` and exiting 0. Tables with no primary key now take a single-statement snapshot rather than corrupting silently.
* `fix(dt)!:` a malformed row or a dead worker no longer hangs the pipeline forever. The error branch never decremented the in-flight count, `request()` never settled on worker death, and `worker:exit` had no subscribers — a four-byte bad payload wedged `db transfer --import` indefinitely. Three busy-wait loops are replaced with real settlement.
* `fix(transfer)!:` the postgres same-server path no longer copies the destination into itself. It ignored the source database entirely and could only ever emit `INSERT INTO t SELECT ... FROM t`.
* `fix(dt):` decompression is bounded on import. An unbounded `gunzip` inflated 398 KB to 400 MB (1029:1), and because it runs in a compute worker the resulting OOM triggered the hang above.
* `fix(transfer):` reported counts reflect reality — `onConflict: 'skip'` no longer counts no-ops as inserted, and the same-server path reports affected rows instead of a postgres `reltuples` estimate.
* `fix(transfer):` `db transfer --export` with no `--tables` exports every table, as its own flag description promised. It exported nothing, printed `success: true` and exited 0.
* `fix(transfer):` cross-dialect transfer works. The planner probed the destination with the *source* dialect, so every cross-dialect transfer aborted and roughly 400 lines of streaming conversion were unreachable — while the docs claimed the feature worked.
* `fix(teardown)!:` `truncate` qualifies statements with the table's schema. It discarded the schema, emptied 12 tables and then aborted — partial irreversible loss, reported as a failure.
* `fix(state)!:` `state.enc` writes are atomic and reconciled. Ten concurrent `noorm secret set` runs left five secrets, all exiting 0. Writes now stage-and-rename with an exclusive lock, three-way reconcile against a changed file, and keep a `.bak` generation.
* `fix(state):` reads stopped rewriting state. `needsMigration` tested a field the migration never writes, so it was always true and every command — including `config list` — re-encrypted and rewrote `state.enc`, turning reads into writes and amplifying the loss above.
* `fix(runner):` `.sql.tmpl` dedup works. The stored checksum was the raw file hash while the comparison used the rendered hash, so templates re-executed on every build and failed on non-idempotent DDL.
* `fix(runner):` SQLite executes every statement in a multi-statement file instead of silently running the first and reporting success.
