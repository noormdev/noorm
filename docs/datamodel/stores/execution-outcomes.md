---
kind: cache
title: Execution Outcomes
description: Ephemeral workflow results awaiting audit finalization and caller response.
---

Execution buffers run identity, config, `single_run` and conditional guard ownership, run status, transaction outcome, timing, duration and error, plus declared step number, name, status, outcome, timing, duration, error and skip reason. Errors include workflow and boundary failures. This in-memory handoff is neither a persistent table nor a resume checkpoint; [[pipeline_run]] and [[pipeline_step]] are the independent audit authorities. Separate workflow and audit transactions mean incomplete audit cannot establish whether workflow committed. Samples omit timing and other fields carried by the full contract.

Protected finalization also receives evidence that workflow SQL and transaction activity have settled. Ownership alone cannot authorize release. If database activity may still be running, carry that uncertainty so finalization retains protection for reconciliation. This evidence is transient execution context, not an added pipeline-table column.

## Sample values

| run_id | config_name | status | transaction_outcome | observed steps |
| --- | --- | --- | --- | --- |
| 1042 | dev | failed | rolled_back | collect success but rolled back; summarize failed and rolled back; publish skipped |
| 1043 | dev | partial | partial | collect committed; summarize failed and rolled back; publish skipped |
| 1054 | dev | unknown | unknown | execution succeeded but commit acknowledgement lost |
| 1064 | dev | partial | partial | stage-api committed; clean-accounts failed and rolled back; in-flight clean-invoices committed; aggregate skipped |
| 1066 | staging | success | committed | all three steps finished and commit acknowledged; settled activity permits owned-guard release |
