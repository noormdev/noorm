---
description: Proposed pipeline invocation from preflight through execution, audit finalization, and caller response.
---

<ignatius-breadcrumb>

↑ [Flows](../index.md) · [Noorm internal schema](../../index.md)

</ignatius-breadcrumb>

<ignatius-index scope="flow-diagram" path="flows/pipeline-execution" count="4" depth="2" digest="sha256:5ef7abbe7abb0dae7b69e4f2937667fc6d01820e40a8f06518a2e0837c391c7e">

| Name | Kind | Description | Go |
|---|---|---|---|
| Execute-Workflow | process | Execute prepared steps in order under the selected transaction policy and capture the observed outcome. | [Execute-Workflow](Execute-Workflow.md) |
| Finalize-Run | process | Record observed workflow outcomes outside the workflow transaction, release the owned lock, and report the result. | [Finalize-Run](Finalize-Run.md) |
| Prepare-Pipeline | process | Validate and prepare a fresh invocation or return a preview or rejection without creating history. | [Prepare-Pipeline](Prepare-Pipeline.md) |
| Reserve-Run | process | Acquire the configuration lock and persist the intended run and step audit before execution. | [Reserve-Run](Reserve-Run.md) |

</ignatius-index>
