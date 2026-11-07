<ignatius-breadcrumb>

↑ [Data](../index.md) · [Noorm internal schema](../../index.md)

</ignatius-breadcrumb>

<ignatius-index scope="entity-group" path="data/existing" count="6" depth="2" digest="sha256:6d21f739f2548a98e6f3ed6bc0e5631d2e0b98a9d14aa1d09e49437b97d74f86">

| Name | Kind | Description | Go |
|---|---|---|---|
| change | Independent | Operation batches for builds, runs, and changes. | [change](change.md) |
| executions | Independent | Individual file execution results within operation batches. | [executions](executions.md) |
| identities | Independent | Team-discovery identities and encrypted vault-key access. | [identities](identities.md) |
| lock | Independent | Configuration-scoped locks against concurrent operations. | [lock](lock.md) |
| vault | Independent | Encrypted shared secret values indexed by secret name. | [vault](vault.md) |
| version | Independent | Installed CLI and internal schema versions. | [version](version.md) |

</ignatius-index>
