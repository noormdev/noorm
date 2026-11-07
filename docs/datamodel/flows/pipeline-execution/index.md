---
description: Proposed pipeline invocation from preflight through execution, audit finalization, and caller response.
---

<ignatius-breadcrumb>

↑ [Flows](../index.md) · [Noorm internal schema](../../index.md)

</ignatius-breadcrumb>

<ignatius-index scope="flow-diagram" path="flows/pipeline-execution" count="4" depth="2" digest="sha256:3bbf5f02ea1e0a2c76771dee8d8ace1e984a01f6a7e3263907dce602b4b1a147">

| Name | Kind | Description | Go |
|---|---|---|---|
| Execute-Workflow | process | Execute prepared steps in order under the selected transaction policy and capture the observed outcome. | [Execute-Workflow](Execute-Workflow.md) |
| Finalize-Run | process | Record observed workflow outcomes outside the workflow transaction, release the owned lock, and report the result. | [Finalize-Run](Finalize-Run.md) |
| Prepare-Pipeline | process | Validate and prepare a fresh invocation or return a preview or rejection without creating history. | [Prepare-Pipeline](Prepare-Pipeline.md) |
| Reserve-Run | process | Acquire the pipeline-scoped lock and persist the intended run and step audit before execution. | [Reserve-Run](Reserve-Run.md) |

</ignatius-index>
