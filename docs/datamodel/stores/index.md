<ignatius-breadcrumb>

↑ [Noorm internal schema](../index.md)

</ignatius-breadcrumb>

<ignatius-index scope="stores" path="stores" count="5" depth="1" digest="sha256:45a51ecad6967b04cbca194e5e704f0f972ca2357435c4e8853fa03def8aefac">

| Name | Kind | Description | Go |
|---|---|---|---|
| active-runs | store | Ephemeral admitted run identity and prepared scheduling context. | [active-runs](active-runs.md) |
| execution-outcomes | store | Ephemeral workflow results awaiting audit finalization and caller response. | [execution-outcomes](execution-outcomes.md) |
| pipeline-definitions | store | Manifest declarations, SQL files, and local template inputs for pipeline preparation. | [pipeline-definitions](pipeline-definitions.md) |
| prepared-invocations | store | Ephemeral preflighted non-dry-run invocation context awaiting admission. | [prepared-invocations](prepared-invocations.md) |
| single-run-guard | store | Abstract optional coordination for protected admission and ownership recovery. | [single-run-guard](single-run-guard.md) |

</ignatius-index>
