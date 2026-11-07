---
label: Pipeline history
description: Linked operation and file audit with authoritative pipeline run and step outcomes.
entities: [change, executions, pipeline_run, pipeline_step]
---

[[change]], [[executions]], [[pipeline_run]], and [[pipeline_step]] describe one invocation together. Persist intent and resolved workflow outcomes as coherent bookkeeping transactions outside workflow transactions. A step uses its run and sequence number as its identity. This is proposed behavior, not implemented orchestration.
