---
description: Proposed pipeline invocation from preflight through execution, audit finalization, and caller response.
---

<ignatius-breadcrumb>

↑ [Flows](../index.md) · [Noorm internal schema](../../index.md)

</ignatius-breadcrumb>

<ignatius-index scope="flow-diagram" path="flows/pipeline-execution" count="4" depth="2" digest="sha256:9b65202b6714d3b64ccfd6e98681816c49698b4e06ca6e10d879db4444f650d5">

| Name | Kind | Description | Go |
|---|---|---|---|
| Execute-Workflow | process | Execute prepared steps in order under the selected transaction policy and capture the observed outcome. | [Execute-Workflow](Execute-Workflow.md) |
| Finalize-Run | process | Record observed workflow outcomes outside the workflow transaction, release the owned lock, and report the result. | [Finalize-Run](Finalize-Run.md) |
| Prepare-Pipeline | process | Validate and prepare a fresh invocation or return a preview or rejection without creating history. | [Prepare-Pipeline](Prepare-Pipeline.md) |
| Reserve-Run | process | Acquire the pipeline-scoped lock and persist the intended run and step audit before execution. | [Reserve-Run](Reserve-Run.md) |

</ignatius-index>
