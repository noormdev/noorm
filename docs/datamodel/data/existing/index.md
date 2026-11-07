<ignatius-breadcrumb>

↑ [Data](../index.md) · [Noorm internal schema](../../index.md)

</ignatius-breadcrumb>

<ignatius-index scope="entity-group" path="data/existing" count="6" depth="2" digest="sha256:300768c91798b1be8464aa86f275c53bc622659161dab353cc710d4119b5c1c0">

| Name | Kind | Description | Go |
|---|---|---|---|
| change | Independent | Operation batches for builds, runs, and changes. | [change](change.md) |
| executions | Independent | Individual file execution results within operation batches. | [executions](executions.md) |
| identities | Independent | Team-discovery identities and encrypted vault-key access. | [identities](identities.md) |
| lock | Independent | Configuration-scoped locks against concurrent operations. | [lock](lock.md) |
| vault | Independent | Encrypted shared secret values indexed by secret name. | [vault](vault.md) |
| version | Independent | Installed CLI and internal schema versions. | [version](version.md) |

</ignatius-index>
