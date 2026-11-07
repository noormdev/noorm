---
kind: cache
title: Active Runs
description: Ephemeral admitted run identity and prepared scheduling context.
---

After durable audit intent, this in-memory handoff associates run ID, slug, config, executing identity, CLI version, policy, manifest checksum, `single_run`, conditional guard ownership, order mode, concurrency cap, and declared steps (`step_no`, name, filepath, rendered checksum, prepared SQL and graph `needs`). It is not a table or resume checkpoint. Prepared SQL is execution-only and excluded from normal history and responses. Samples describe in-flight context, not final snapshots; checksums are abbreviated.

## Sample values

| run_id | slug | config_name | transaction_policy | single_run | scheduling context |
| --- | --- | --- | --- | --- | --- |
| 1060 | refresh-reporting | dev | pipeline | false | linear collect, summarize, publish; checksum `bbbbbbbb` |
| 1061 | refresh-reporting | dev | pipeline | false | same declarations; overlaps 1060 |
| 1063 | load-erp | dev | pipeline | false | graph diamond, one session and effective cap one |
| 1064 | load-erp | dev | step | false | graph diamond, independent ready steps may run concurrently |
