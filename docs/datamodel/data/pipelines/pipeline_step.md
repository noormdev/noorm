---
entity: pipeline_step
group: pipelines
description: "Proposed ordered pipeline step linked to its unique execution audit record."
pk:
  - pipeline_run_id
  - step_no
columns:
  pipeline_run_id:
    type: integer
    desc: "Mandatory foreign key to the owning pipeline_run.id."
  step_no:
    type: integer
    desc: "One-based manifest position and step identity within the run."
  execution_id:
    type: integer
    desc: "Mandatory, globally unique foreign key to executions.id."
  name:
    type: text
    desc: "Readable manifest step label, unique within the run."
  status:
    type: text
    desc: "Authoritative pipeline step status."
  transaction_outcome:
    type: text
    desc: "Outcome of the workflow transaction affecting the step."
  started_at:
    type: timestamp
    nullable: true
    desc: "When the step began; null until it starts."
  finished_at:
    type: timestamp
    nullable: true
    desc: "When the step resolved; null until resolution."
ak:
  - rule: pipeline_step_execution_unique
    columns: [execution_id]
  - rule: pipeline_step_name_per_run_unique
    columns: [pipeline_run_id, name]
relationships:
  - target: pipeline_run
    on:
      pipeline_run_id: id
    predicate: { fwd: contains, rev: is a step of }
  - target: executions
    on:
      execution_id: id
    predicate: { fwd: records, rev: is recorded by }
examples:
  - { pipeline_run_id: 1042, step_no: 1, execution_id: 8201, name: collect, status: success, transaction_outcome: rolled_back, started_at: '2026-01-10T10:00:00Z', finished_at: '2026-01-10T10:01:00Z' }
  - { pipeline_run_id: 1042, step_no: 2, execution_id: 8202, name: summarize, status: failed, transaction_outcome: rolled_back, started_at: '2026-01-10T10:01:00Z', finished_at: '2026-01-10T10:02:00Z' }
  - { pipeline_run_id: 1042, step_no: 3, execution_id: 8203, name: publish, status: skipped, transaction_outcome: not_started, started_at: null, finished_at: null }
  - { pipeline_run_id: 1043, step_no: 1, execution_id: 8204, name: collect, status: success, transaction_outcome: committed, started_at: '2026-01-11T10:00:00Z', finished_at: '2026-01-11T10:01:00Z' }
  - { pipeline_run_id: 1043, step_no: 2, execution_id: 8205, name: summarize, status: failed, transaction_outcome: rolled_back, started_at: '2026-01-11T10:01:00Z', finished_at: '2026-01-11T10:02:00Z' }
  - { pipeline_run_id: 1043, step_no: 3, execution_id: 8206, name: publish, status: skipped, transaction_outcome: not_started, started_at: null, finished_at: null }
  - { pipeline_run_id: 1044, step_no: 1, execution_id: 8207, name: collect, status: success, transaction_outcome: committed, started_at: '2026-01-12T10:00:00Z', finished_at: '2026-01-12T10:01:00Z' }
  - { pipeline_run_id: 1044, step_no: 2, execution_id: 8208, name: summarize, status: success, transaction_outcome: committed, started_at: '2026-01-12T10:01:00Z', finished_at: '2026-01-12T10:02:00Z' }
  - { pipeline_run_id: 1044, step_no: 3, execution_id: 8209, name: publish, status: success, transaction_outcome: committed, started_at: '2026-01-12T10:02:00Z', finished_at: '2026-01-12T10:03:00Z' }
  - { pipeline_run_id: 1045, step_no: 1, execution_id: 8210, name: collect, status: failed, transaction_outcome: rolled_back, started_at: '2026-01-13T10:00:00Z', finished_at: '2026-01-13T10:01:00Z' }
  - { pipeline_run_id: 1045, step_no: 2, execution_id: 8211, name: summarize, status: skipped, transaction_outcome: not_started, started_at: null, finished_at: null }
  - { pipeline_run_id: 1045, step_no: 3, execution_id: 8212, name: publish, status: skipped, transaction_outcome: not_started, started_at: null, finished_at: null }
  - { pipeline_run_id: 1046, step_no: 1, execution_id: 8213, name: collect, status: success, transaction_outcome: committed, started_at: '2026-01-14T10:00:00Z', finished_at: '2026-01-14T10:01:00Z' }
  - { pipeline_run_id: 1046, step_no: 2, execution_id: 8214, name: summarize, status: success, transaction_outcome: committed, started_at: '2026-01-14T10:01:00Z', finished_at: '2026-01-14T10:02:00Z' }
  - { pipeline_run_id: 1046, step_no: 3, execution_id: 8215, name: publish, status: success, transaction_outcome: committed, started_at: '2026-01-14T10:02:00Z', finished_at: '2026-01-14T10:03:00Z' }
  - { pipeline_run_id: 1047, step_no: 1, execution_id: 8216, name: collect, status: failed, transaction_outcome: rolled_back, started_at: '2026-01-15T10:00:00Z', finished_at: '2026-01-15T10:01:00Z' }
  - { pipeline_run_id: 1047, step_no: 2, execution_id: 8217, name: summarize, status: skipped, transaction_outcome: not_started, started_at: null, finished_at: null }
  - { pipeline_run_id: 1047, step_no: 3, execution_id: 8218, name: publish, status: skipped, transaction_outcome: not_started, started_at: null, finished_at: null }
  - { pipeline_run_id: 1048, step_no: 1, execution_id: 8219, name: collect, status: success, transaction_outcome: committed, started_at: '2026-01-16T10:00:00Z', finished_at: '2026-01-16T10:01:00Z' }
  - { pipeline_run_id: 1048, step_no: 2, execution_id: 8220, name: summarize, status: success, transaction_outcome: committed, started_at: '2026-01-16T10:01:00Z', finished_at: '2026-01-16T10:02:00Z' }
  - { pipeline_run_id: 1048, step_no: 3, execution_id: 8221, name: publish, status: success, transaction_outcome: committed, started_at: '2026-01-16T10:02:00Z', finished_at: '2026-01-16T10:03:00Z' }
  - { pipeline_run_id: 1049, step_no: 1, execution_id: 8222, name: collect, status: failed, transaction_outcome: partial, started_at: '2026-01-17T10:00:00Z', finished_at: '2026-01-17T10:01:00Z' }
  - { pipeline_run_id: 1049, step_no: 2, execution_id: 8223, name: summarize, status: skipped, transaction_outcome: not_started, started_at: null, finished_at: null }
  - { pipeline_run_id: 1049, step_no: 3, execution_id: 8224, name: publish, status: skipped, transaction_outcome: not_started, started_at: null, finished_at: null }
  - { pipeline_run_id: 1050, step_no: 1, execution_id: 8225, name: collect, status: success, transaction_outcome: committed, started_at: '2026-01-18T10:00:00Z', finished_at: '2026-01-18T10:01:00Z' }
  - { pipeline_run_id: 1050, step_no: 2, execution_id: 8226, name: summarize, status: failed, transaction_outcome: no_effects, started_at: '2026-01-18T10:01:00Z', finished_at: '2026-01-18T10:02:00Z' }
  - { pipeline_run_id: 1050, step_no: 3, execution_id: 8227, name: publish, status: skipped, transaction_outcome: not_started, started_at: null, finished_at: null }
  - { pipeline_run_id: 1051, step_no: 1, execution_id: 8228, name: collect, status: pending, transaction_outcome: pending, started_at: null, finished_at: null }
  - { pipeline_run_id: 1051, step_no: 2, execution_id: 8229, name: summarize, status: pending, transaction_outcome: pending, started_at: null, finished_at: null }
  - { pipeline_run_id: 1051, step_no: 3, execution_id: 8230, name: publish, status: pending, transaction_outcome: pending, started_at: null, finished_at: null }
  - { pipeline_run_id: 1052, step_no: 1, execution_id: 8231, name: collect, status: success, transaction_outcome: pending, started_at: '2026-01-20T10:00:00Z', finished_at: '2026-01-20T10:01:00Z' }
  - { pipeline_run_id: 1052, step_no: 2, execution_id: 8232, name: summarize, status: running, transaction_outcome: pending, started_at: '2026-01-20T10:01:00Z', finished_at: null }
  - { pipeline_run_id: 1052, step_no: 3, execution_id: 8233, name: publish, status: pending, transaction_outcome: pending, started_at: null, finished_at: null }
  - { pipeline_run_id: 1053, step_no: 1, execution_id: 8234, name: collect, status: success, transaction_outcome: rolled_back, started_at: '2026-01-21T10:00:00Z', finished_at: '2026-01-21T10:01:00Z' }
  - { pipeline_run_id: 1053, step_no: 2, execution_id: 8235, name: summarize, status: interrupted, transaction_outcome: rolled_back, started_at: '2026-01-21T10:01:00Z', finished_at: '2026-01-21T10:02:00Z' }
  - { pipeline_run_id: 1053, step_no: 3, execution_id: 8236, name: publish, status: skipped, transaction_outcome: not_started, started_at: null, finished_at: null }
  - { pipeline_run_id: 1054, step_no: 1, execution_id: 8237, name: collect, status: success, transaction_outcome: unknown, started_at: '2026-01-22T10:00:00Z', finished_at: '2026-01-22T10:01:00Z' }
  - { pipeline_run_id: 1054, step_no: 2, execution_id: 8238, name: summarize, status: success, transaction_outcome: unknown, started_at: '2026-01-22T10:01:00Z', finished_at: '2026-01-22T10:02:00Z' }
  - { pipeline_run_id: 1054, step_no: 3, execution_id: 8239, name: publish, status: success, transaction_outcome: unknown, started_at: '2026-01-22T10:02:00Z', finished_at: '2026-01-22T10:03:00Z' }
  - { pipeline_run_id: 1055, step_no: 1, execution_id: 8240, name: collect, status: success, transaction_outcome: unknown, started_at: '2026-01-23T10:00:00Z', finished_at: '2026-01-23T10:01:00Z' }
  - { pipeline_run_id: 1055, step_no: 2, execution_id: 8241, name: summarize, status: success, transaction_outcome: unknown, started_at: '2026-01-23T10:01:00Z', finished_at: '2026-01-23T10:02:00Z' }
  - { pipeline_run_id: 1055, step_no: 3, execution_id: 8242, name: publish, status: success, transaction_outcome: unknown, started_at: '2026-01-23T10:02:00Z', finished_at: '2026-01-23T10:03:00Z' }
  - { pipeline_run_id: 1056, step_no: 1, execution_id: 8243, name: collect, status: success, transaction_outcome: committed, started_at: '2026-01-24T10:00:00Z', finished_at: '2026-01-24T10:01:00Z' }
  - { pipeline_run_id: 1056, step_no: 2, execution_id: 8244, name: summarize, status: success, transaction_outcome: committed, started_at: '2026-01-24T10:01:00Z', finished_at: '2026-01-24T10:02:00Z' }
  - { pipeline_run_id: 1056, step_no: 3, execution_id: 8245, name: publish, status: success, transaction_outcome: committed, started_at: '2026-01-24T10:02:00Z', finished_at: '2026-01-24T10:03:00Z' }
  - { pipeline_run_id: 1057, step_no: 1, execution_id: 8246, name: collect, status: success, transaction_outcome: unknown, started_at: '2026-01-25T10:00:00Z', finished_at: '2026-01-25T10:01:00Z' }
  - { pipeline_run_id: 1057, step_no: 2, execution_id: 8247, name: summarize, status: failed, transaction_outcome: unknown, started_at: '2026-01-25T10:01:00Z', finished_at: '2026-01-25T10:02:00Z' }
  - { pipeline_run_id: 1057, step_no: 3, execution_id: 8248, name: publish, status: skipped, transaction_outcome: not_started, started_at: null, finished_at: null }
  - { pipeline_run_id: 1058, step_no: 1, execution_id: 8249, name: collect, status: success, transaction_outcome: committed, started_at: '2026-01-26T10:00:00Z', finished_at: '2026-01-26T10:01:00Z' }
  - { pipeline_run_id: 1058, step_no: 2, execution_id: 8250, name: collect-again, status: success, transaction_outcome: committed, started_at: '2026-01-26T10:01:00Z', finished_at: '2026-01-26T10:02:00Z' }
  - { pipeline_run_id: 1058, step_no: 3, execution_id: 8251, name: publish, status: success, transaction_outcome: committed, started_at: '2026-01-26T10:02:00Z', finished_at: '2026-01-26T10:03:00Z' }
  - { pipeline_run_id: 1059, step_no: 1, execution_id: 8252, name: collect, status: failed, transaction_outcome: no_effects, started_at: '2026-01-27T10:00:00Z', finished_at: '2026-01-27T10:01:00Z' }
  - { pipeline_run_id: 1059, step_no: 2, execution_id: 8253, name: summarize, status: skipped, transaction_outcome: not_started, started_at: null, finished_at: null }
  - { pipeline_run_id: 1059, step_no: 3, execution_id: 8254, name: publish, status: skipped, transaction_outcome: not_started, started_at: null, finished_at: null }
---

# pipeline_step

**Proposal, not an existing database table.** Each step of a [[pipeline_run]] is identified by its one-based manifest position within that run and links to one unique [[executions|execution]] audit record. There is no surrogate step ID or separate position column.

## Business rules

- `step_no` must be at least one; `(pipeline_run_id, step_no)` is the complete primary key. The readable manifest label `name` is also unique within a run, and `execution_id` is unique across steps. Source: requested pipeline model.
- Proposed database invariant: the linked [[executions|execution]] must satisfy `execution.change_id = pipeline_run_id`, tying the audit record to the same [[change]] that the run extends. The two foreign keys alone do not enforce this parent coherence; an additional database constraint mechanism is required without introducing extra columns.
- Pipeline step statuses are authoritative; generic summaries are derived rather than maintained as a competing authority. A successful step can have `rolled_back` transaction outcome when a later step fails under a whole-pipeline transaction.
- Audit is buffered separately and persisted in an audit transaction outside the workflow transaction. No hidden resume or checksum-based skipping is implied by this proposal.
- `started_at` is null until the step starts and `finished_at` is null until it resolves. Source: requested pipeline model.

## Illustrative examples

These synthetic snapshots correspond to all cases in [[pipeline_run]]: each run has consecutive positions 1–3, and every step references a distinct [[executions|execution]] whose `change_id` is that run’s ID. The usual names are collect, summarize, and publish; run 1058 instead uses collect, collect-again, and publish. Unreached steps have null start and finish times; they are recorded as skipped with outcome `not_started`, not silently omitted. Pending steps have not started; a running step has no finish time. Under the pipeline transaction, an already successful step can still have a `pending`, `rolled_back`, or `unknown` outcome. Under no wrapping transaction, `partial` on a failed step means confirmed effects survived, while `no_effects` means that failed step left none; this is not a claim that a workflow transaction rolled back. Run 1058 intentionally executes `collect.sql` twice under distinct step numbers and names; paths do not determine step identity. All statuses and outcomes here describe proposed pipeline records, while the linked execution status records the file execution rather than transaction outcome.
