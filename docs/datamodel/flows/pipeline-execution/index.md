---
description: Pipeline invocation from preflight through execution, audit finalization, and caller response.
---

<ignatius-breadcrumb>

↑ [Flows](../index.md) · [Noorm internal schema](../../index.md)

</ignatius-breadcrumb>

<ignatius-index scope="flow-diagram" path="flows/pipeline-execution" count="4" depth="2" digest="sha256:b0fd37ef4370d028efdd9ff58d44a83bbf9756458e36a248564c29574d5e2b9d">

| Name | Kind | Description | Go |
|---|---|---|---|
| Execute-Workflow | process | Schedule prepared linear or graph steps under their transaction policy and capture observed outcomes. | [Execute-Workflow](Execute-Workflow.md) |
| Finalize-Run | process | Persist settled workflow evidence independently, retain uncertain ownership, and report the result. | [Finalize-Run](Finalize-Run.md) |
| Prepare-Pipeline | process | Validate and prepare a fresh invocation or return a preview or rejection without creating history. | [Prepare-Pipeline](Prepare-Pipeline.md) |
| Reserve-Run | process | Admit a fresh run and persist intended steps, optionally coordinating single-run protection. | [Reserve-Run](Reserve-Run.md) |

</ignatius-index>
