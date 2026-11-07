<ignatius-breadcrumb>

↑ [Noorm internal schema](../index.md)

</ignatius-breadcrumb>

<ignatius-index scope="stores" path="stores" count="4" depth="1" digest="sha256:5f0c2166a59efff091feefe28f2d52f8dc583dcdb7a11dfd0cdf939d16590c9e">

| Name | Kind | Description | Go |
|---|---|---|---|
| active-runs | store | Ephemeral run identity and ordered execution context for an invocation in progress. | [active-runs](active-runs.md) |
| execution-outcomes | store | Ephemeral workflow results awaiting audit finalization and caller response. | [execution-outcomes](execution-outcomes.md) |
| pipeline-definitions | store | Versioned manifest definitions and ordered SQL file references for proposed pipeline invocations. | [pipeline-definitions](pipeline-definitions.md) |
| prepared-invocations | store | Ephemeral preflighted non-dry-run invocation context awaiting execution. | [prepared-invocations](prepared-invocations.md) |

</ignatius-index>
