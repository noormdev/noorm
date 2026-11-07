---
external: Caller
description: An operator or application requests a pipeline invocation or reads its history.
---

The actor is a CLI operator or SDK application, not a row in the identity registry. Both interfaces are proposals.

## What Caller does

- Sends a slug, selected config, identity/policy context and dry-run choice.
- Receives a preview, rejection, or a run ID with ordered results and errors.
- Requests history by slug or a run ID and receives stored outcomes.

## Expectations

Each invocation is fresh. Execution status is distinguished from confirmed commit, rollback, and uncertainty. Rendered SQL and secrets are not returned in normal results.
