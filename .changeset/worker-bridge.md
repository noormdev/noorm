---
"@noormdev/cli": minor
"@noormdev/sdk": minor
---

### Added

* `feat(worker-bridge):` Worker thread infrastructure for parallel DT export/import. WorkerBridge class (ObserverRelay subclass), WorkerPool with round-robin dispatch, OrderBuffer for index-ordered reassembly.
* `feat(workers):` Persistent Connection Worker (Kysely-backed DB operations) and stateless Compute Worker (serialize/deserialize) as standalone entry points.
* `feat(dt):` Export and import pipelines now run through worker threads — Connection Worker handles DB queries, Compute Pool parallelizes CPU-bound serialization across N cores.
* `feat(dt):` Three-tier progress events (`loaded`/`processed`/`saved`) for both export and import, enabling granular TUI progress display.
* `feat(connection):` ConnectionManager tracks WorkerBridge instances alongside direct Kysely connections for coordinated shutdown.
* `feat(cli):` `noorm dev/test-workers` diagnostic command for verifying worker thread infrastructure across execution contexts.
* `build:` Worker entry points included in `bun build --compile` for single binary support.
