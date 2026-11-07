---
kind: cache
title: Execution Outcomes
description: Ephemeral workflow results awaiting audit finalization and caller response.
---

The execution process buffers the run ID, configuration, authoritative run status, transaction outcome, ordered step results (`step_no`, `name`, `status`, `transaction_outcome`, `started_at`, and `finished_at`), and sanitized errors here for finalization. This in-memory handoff is not a persistent table or a resume checkpoint; [[pipeline_run]], [[pipeline_step]], [[change]], and [[executions]] hold the durable audit. The workflow and audit transactions are separate, so an absent or incomplete final audit cannot establish whether a workflow committed. Samples are synthetic.

## Sample values

| run_id | config_name | status | transaction_outcome | steps | errors |
| --- | --- | --- | --- | --- | --- |
| 1042 | dev | failed | rolled_back | `[{step_no: 1, name: collect, status: success, transaction_outcome: rolled_back, started_at: 2026-01-10T10:00:00Z, finished_at: 2026-01-10T10:01:00Z}, {step_no: 2, name: summarize, status: failed, transaction_outcome: rolled_back, started_at: 2026-01-10T10:01:00Z, finished_at: 2026-01-10T10:02:00Z}, {step_no: 3, name: publish, status: skipped, transaction_outcome: not_started, started_at: null, finished_at: null}]` | `[Step execution failed]` |
| 1043 | dev | partial | partial | `[{step_no: 1, name: collect, status: success, transaction_outcome: committed, started_at: 2026-01-11T10:00:00Z, finished_at: 2026-01-11T10:01:00Z}, {step_no: 2, name: summarize, status: failed, transaction_outcome: rolled_back, started_at: 2026-01-11T10:01:00Z, finished_at: 2026-01-11T10:02:00Z}, {step_no: 3, name: publish, status: skipped, transaction_outcome: not_started, started_at: null, finished_at: null}]` | `[Step execution failed]` |
| 1054 | dev | unknown | unknown | `[{step_no: 1, name: collect, status: success, transaction_outcome: unknown, started_at: 2026-01-22T10:00:00Z, finished_at: 2026-01-22T10:01:00Z}, {step_no: 2, name: summarize, status: success, transaction_outcome: unknown, started_at: 2026-01-22T10:01:00Z, finished_at: 2026-01-22T10:02:00Z}, {step_no: 3, name: publish, status: success, transaction_outcome: unknown, started_at: 2026-01-22T10:02:00Z, finished_at: 2026-01-22T10:03:00Z}]` | `[Transaction outcome unknown]` |
