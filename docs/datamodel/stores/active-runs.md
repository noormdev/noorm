---
kind: cache
title: Active Runs
description: Ephemeral admitted run identity and prepared scheduling context.
---

After durable audit intent, this in-memory handoff associates run ID, slug, config, executing identity, CLI version, policy, manifest checksum, `single_run`, the run row's nullable `active_key`, order mode, concurrency cap, immutable resolved input, and declared steps (`step_no`, name, filepath, rendered checksum, prepared SQL and numeric `needs`). It is not a table or resume checkpoint. Input and prepared SQL are sensitive and excluded from history and normal responses; only prepared SQL reaches the database engine. Samples describe in-flight context, not final snapshots; checksums are abbreviated.

## Sample values

| run_id | slug | config_name | transaction_policy | single_run | scheduling context |
| --- | --- | --- | --- | --- | --- |
| 1060 | refresh-reporting | dev | pipeline | false | linear collect `[]`, summarize `[1]`, publish `[2]`; checksum `bbbbbbbb` |
| 1061 | refresh-reporting | dev | pipeline | false | same declarations; overlaps 1060 |
| 1063 | load-erp | dev | pipeline | false | graph diamond `[]`, `[1]`, `[1]`, `[2,3]`; one session and effective cap one |
| 1064 | load-erp | dev | step | false | same numeric graph; independent ready steps may run concurrently |
