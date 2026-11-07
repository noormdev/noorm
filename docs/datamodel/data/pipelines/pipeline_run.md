---
entity: pipeline_run
group: pipelines
description: "Proposed pipeline-specific run record sharing its change identity."
pk:
  - id
columns:
  id:
    type: integer
    desc: "Shared identity and mandatory foreign key to change.id; no separate run identifier is generated."
  slug:
    type: text
    desc: "Pipeline manifest slug."
  manifest_checksum:
    type: text
    desc: "Checksum of the manifest used for this run."
  transaction_policy:
    type: text
    desc: "Transaction scope selected for the pipeline, such as pipeline or step."
  status:
    type: text
    desc: "Authoritative pipeline run status."
  transaction_outcome:
    type: text
    desc: "Recorded outcome of the workflow transactions."
  started_at:
    type: timestamp
    nullable: true
    desc: "When execution began; null until the run starts."
  finished_at:
    type: timestamp
    nullable: true
    desc: "When the run resolved; null until resolution."
relationships:
  - target: change
    on:
      id: id
    predicate: { fwd: is extended by, rev: extends }
examples:
  - { id: 1042, slug: refresh-reporting, manifest_checksum: "cccccccc", transaction_policy: pipeline, status: failed, transaction_outcome: rolled_back, started_at: '2026-01-10T10:00:00Z', finished_at: '2026-01-10T10:02:00Z' }
  - { id: 1043, slug: refresh-reporting, manifest_checksum: "eeeeeeee", transaction_policy: step, status: partial, transaction_outcome: partial, started_at: '2026-01-11T10:00:00Z', finished_at: '2026-01-11T10:02:00Z' }
  - { id: 1044, slug: refresh-reporting, manifest_checksum: "cccccccc", transaction_policy: pipeline, status: success, transaction_outcome: committed, started_at: '2026-01-12T10:00:00Z', finished_at: '2026-01-12T10:03:00Z' }
  - { id: 1045, slug: refresh-reporting, manifest_checksum: "cccccccc", transaction_policy: pipeline, status: failed, transaction_outcome: rolled_back, started_at: '2026-01-13T10:00:00Z', finished_at: '2026-01-13T10:01:00Z' }
  - { id: 1046, slug: refresh-reporting, manifest_checksum: "eeeeeeee", transaction_policy: step, status: success, transaction_outcome: committed, started_at: '2026-01-14T10:00:00Z', finished_at: '2026-01-14T10:03:00Z' }
  - { id: 1047, slug: refresh-reporting, manifest_checksum: "eeeeeeee", transaction_policy: step, status: failed, transaction_outcome: rolled_back, started_at: '2026-01-15T10:00:00Z', finished_at: '2026-01-15T10:01:00Z' }
  - { id: 1048, slug: refresh-reporting, manifest_checksum: "ffffffff", transaction_policy: none, status: success, transaction_outcome: committed, started_at: '2026-01-16T10:00:00Z', finished_at: '2026-01-16T10:03:00Z' }
  - { id: 1049, slug: refresh-reporting, manifest_checksum: "ffffffff", transaction_policy: none, status: partial, transaction_outcome: partial, started_at: '2026-01-17T10:00:00Z', finished_at: '2026-01-17T10:01:00Z' }
  - { id: 1050, slug: refresh-reporting, manifest_checksum: "ffffffff", transaction_policy: none, status: partial, transaction_outcome: partial, started_at: '2026-01-18T10:00:00Z', finished_at: '2026-01-18T10:02:00Z' }
  - { id: 1051, slug: refresh-reporting, manifest_checksum: "cccccccc", transaction_policy: pipeline, status: pending, transaction_outcome: pending, started_at: null, finished_at: null }
  - { id: 1052, slug: refresh-reporting, manifest_checksum: "cccccccc", transaction_policy: pipeline, status: running, transaction_outcome: pending, started_at: '2026-01-20T10:00:00Z', finished_at: null }
  - { id: 1053, slug: refresh-reporting, manifest_checksum: "cccccccc", transaction_policy: pipeline, status: interrupted, transaction_outcome: rolled_back, started_at: '2026-01-21T10:00:00Z', finished_at: '2026-01-21T10:02:00Z' }
  - { id: 1054, slug: refresh-reporting, manifest_checksum: "cccccccc", transaction_policy: pipeline, status: unknown, transaction_outcome: unknown, started_at: '2026-01-22T10:00:00Z', finished_at: '2026-01-22T10:03:00Z' }
  - { id: 1055, slug: refresh-reporting, manifest_checksum: "cccccccc", transaction_policy: pipeline, status: pending, transaction_outcome: unknown, started_at: '2026-01-23T10:00:00Z', finished_at: null }
  - { id: 1056, slug: refresh-reporting, manifest_checksum: "cccccccc", transaction_policy: pipeline, status: success, transaction_outcome: committed, started_at: '2026-01-24T10:00:00Z', finished_at: '2026-01-24T10:03:00Z' }
  - { id: 1057, slug: refresh-reporting, manifest_checksum: "cccccccc", transaction_policy: pipeline, status: unknown, transaction_outcome: unknown, started_at: '2026-01-25T10:00:00Z', finished_at: '2026-01-25T10:02:00Z' }
  - { id: 1058, slug: refresh-reporting, manifest_checksum: "dddddddd", transaction_policy: pipeline, status: success, transaction_outcome: committed, started_at: '2026-01-26T10:00:00Z', finished_at: '2026-01-26T10:03:00Z' }
  - { id: 1059, slug: refresh-reporting, manifest_checksum: "ffffffff", transaction_policy: none, status: failed, transaction_outcome: no_effects, started_at: '2026-01-27T10:00:00Z', finished_at: '2026-01-27T10:01:00Z' }
---

# pipeline_run

**Proposal, not an existing database table.** A pipeline run extends one [[change]] with manifest and pipeline-specific execution state. Its primary key is the same identity as the mandatory parent; a second generated run ID is unnecessary.

## Business rules

- Every parent [[change]] must have `change_type = pipeline`; the shared-key foreign key alone does not enforce that discriminator. Source: requested pipeline model.
- Pipeline statuses are authoritative; generic summaries are derived from pipeline state, not a competing source of truth. The related [[pipeline_step]] records preserve individual step outcomes.
- `transaction_policy` describes the workflow transaction scope. Audit records are buffered and persisted in a separate audit transaction outside the workflow transaction, so workflow rollback does not erase its audit trail.
- The manifest checksum records the manifest used; it does not imply hidden resume behavior or checksum-based skipping. These behaviors are not part of this proposal.
- `started_at` remains null until execution starts; `finished_at` remains null until the run resolves. Source: requested pipeline model.

## Illustrative examples

These synthetic, independent snapshots are not production data or a time-series of updates. Each run has a matching [[change]] and three matching [[pipeline_step|steps]], including unreached positions. Run 1056 is a fresh invocation of the same manifest as 1044, not a resume; 1058 uses a distinct manifest checksum. The table identifies each case without adding schema columns.

| Run | Policy | Scenario |
| --- | --- | --- |
| 1042 | `pipeline` | Later failure; the whole pipeline transaction rolls back. |
| 1043 | `step` | Later failure; collect commits, summarize rolls back. |
| 1044 | `pipeline` | Pipeline transaction succeeds and commits all steps. |
| 1045 | `pipeline` | First step fails; pipeline transaction rolls back. |
| 1046 | `step` | Every step transaction commits. |
| 1047 | `step` | First step transaction fails and rolls back. |
| 1048 | `none` | All steps succeed without a wrapping transaction. |
| 1049 | `none` | First step fails after confirmed partial effects were committed. |
| 1050 | `none` | Later step fails with confirmed no effects of its own; the prior step remains committed. |
| 1051 | `pipeline` | Persisted before execution; no step has started. |
| 1052 | `pipeline` | Collect succeeded, but its enclosing transaction has not resolved; summarize is running. |
| 1053 | `pipeline` | Interruption followed by confirmed rollback. |
| 1054 | `pipeline` | Commit acknowledgement was lost; commit versus rollback is unknown. |
| 1055 | `pipeline` | Audit finalization gap: transaction outcome is not yet established in the audit snapshot. |
| 1056 | `pipeline` | Fresh rerun with the same slug, manifest checksum, and file sequence as 1044. |
| 1057 | `pipeline` | Later failure followed by rollback failure; transaction outcome is unknown. |
| 1058 | `pipeline` | Distinct manifest declares collect.sql twice under different names; both execute. |
| 1059 | `none` | First step fails with confirmed no effects; later steps are unreached. |

`pending` means work or finalization remains unresolved; `running` means execution is active; `partial` means confirmed effects survive alongside failure; `interrupted` means execution stopped before normal completion; `unknown` means the transaction result cannot be established. Outcomes `pending`, `committed`, `rolled_back`, `partial`, `no_effects`, and `unknown` describe transaction certainty rather than merely the step result. `no_effects` means no effects survived, not that a rollback occurred: policy `none` has no wrapping workflow transaction to roll back. A finalization gap (1055) must not be represented as a confirmed commit or rollback. The generic [[change]] status projects pending/running to pending, success to success, and failed/partial/interrupted/unknown to failed.

Preflight failure, policy denial, lock contention, and dry-run happen without a persisted pipeline invocation in this scenario set, so no pipeline rows are fabricated for them.
