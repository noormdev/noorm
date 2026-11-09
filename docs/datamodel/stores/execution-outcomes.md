---
kind: cache
title: Execution Outcomes
description: Ephemeral workflow results awaiting audit finalization and caller response.
---

Execution buffers run identity, config, `single_run`, nullable run-owned `active_key`, `workflow_settled`, run status, transaction outcome, timing, duration and safe error, plus declared step number, name, status, outcome, timing, duration, error and skip reason. Primary and secondary errors are preserved in the result. This in-memory handoff is neither a persistent table nor a resume checkpoint; [[pipeline_run]] and [[pipeline_step]] are the independent audit authorities. It contains neither invocation input nor rendered SQL.

Finalization flushes buffered outcomes only after workflow activity quiesces. Protected release compares both run ID and key, and requires settled SQL and transaction activity even during audit failure cleanup. If activity may still be running, retain the key and pending durable intent for reconciliation; pending does not mean unstarted. `workflow_settled` is transient evidence, not a pipeline-table column. Samples omit timing and other fields carried by the full contract.

## Sample values

| run_id | config_name | status | transaction_outcome | observed steps |
| --- | --- | --- | --- | --- |
| 1042 | dev | failed | rolled_back | collect success but rolled back; summarize failed and rolled back; publish skipped |
| 1043 | dev | partial | partial | collect committed; summarize failed and rolled back; publish skipped |
| 1054 | dev | unknown | unknown | execution succeeded but commit acknowledgement lost |
| 1064 | dev | partial | partial | stage-api committed; clean-accounts failed and rolled back; in-flight clean-invoices committed; aggregate skipped |
| 1066 | staging | success | committed | all three steps finished and commit acknowledged; settled activity permits run-owned key release |
| 1062 | dev | unknown | unknown | rollback cleanup uncertain; key retained and protected rerun busy; business commit not asserted |
