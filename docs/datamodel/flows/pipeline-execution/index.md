---
description: Proposed pipeline invocation from preflight through execution, audit finalization, and caller response.
---

<ignatius-breadcrumb>

↑ [Flows](../index.md) · [Noorm internal schema](../../index.md)

</ignatius-breadcrumb>

<ignatius-index scope="flow-diagram" path="flows/pipeline-execution" count="4" depth="2" digest="sha256:f3f28f036897bc741947eea2230ee0bfc3a3cff888d81e1a6adc5cc676596260">

| Name | Kind | Description | Go |
|---|---|---|---|
| Execute-Workflow | process | Schedule prepared linear or graph steps under their transaction policy and capture observed outcomes. | [Execute-Workflow](Execute-Workflow.md) |
| Finalize-Run | process | Persist direct workflow evidence outside the workflow transaction, release any owned guard, and report the result. | [Finalize-Run](Finalize-Run.md) |
| Prepare-Pipeline | process | Validate and prepare a fresh invocation or return a preview or rejection without creating history. | [Prepare-Pipeline](Prepare-Pipeline.md) |
| Reserve-Run | process | Admit a fresh run and persist intended steps, optionally coordinating single-run protection. | [Reserve-Run](Reserve-Run.md) |

</ignatius-index>
