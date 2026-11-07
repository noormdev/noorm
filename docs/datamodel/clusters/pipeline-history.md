---
label: Pipeline history
description: Independent pipeline run and declaration-level execution evidence.
entities: [pipeline_run, pipeline_step]
---

[[pipeline_run]] and its [[pipeline_step]] records describe one admitted invocation together. Persist intent and observed outcomes outside workflow transactions so rollback does not erase audit. No change-history record is involved. This is proposed behavior, not implemented orchestration.
