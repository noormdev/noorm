<ignatius-breadcrumb>

↑ [Noorm internal schema](../index.md)

</ignatius-breadcrumb>

<ignatius-index scope="stores" path="stores" count="4" depth="1" digest="sha256:1ac52da3ca164a48b4aa7194eaf3148bd06d3cae26b1acb4c5ff4755d613ff1a">

| Name | Kind | Description | Go |
|---|---|---|---|
| active-runs | store | Ephemeral admitted run identity and prepared scheduling context. | [active-runs](active-runs.md) |
| execution-outcomes | store | Ephemeral workflow results awaiting audit finalization and caller response. | [execution-outcomes](execution-outcomes.md) |
| pipeline-definitions | store | Manifest declarations, SQL files, and local template inputs for pipeline preparation. | [pipeline-definitions](pipeline-definitions.md) |
| prepared-invocations | store | Ephemeral preflighted non-dry-run invocation context awaiting admission. | [prepared-invocations](prepared-invocations.md) |

</ignatius-index>
